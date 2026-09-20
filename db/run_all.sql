-- CampusHop: every migration, in order, in one run.
--
-- Paste this whole file into the Supabase SQL editor and run it once.
-- Every statement is idempotent, so running it again is harmless — use
-- it to bring a database up to date whatever state it is starting from.
--
-- The individual files (001 … 004) are kept alongside this one for
-- reference; this is only their contents concatenated.


-- ============================================================
-- 001 — store real road routes on each ride
-- ============================================================
--
-- The route is computed once, when a driver posts a ride, and saved here.
-- Browsing the ride board then costs zero routing API calls.

alter table rides
  add column if not exists pickup_lat       double precision,
  add column if not exists pickup_lng       double precision,
  add column if not exists dropoff_lat      double precision,
  add column if not exists dropoff_lng      double precision,
  add column if not exists route_geometry   jsonb,
  add column if not exists distance_meters  integer,
  add column if not exists duration_seconds integer;


-- ============================================================
-- 002 — one request per rider, per ride
-- ============================================================
--
-- The API already refuses a second request, but that check and the insert
-- are two separate round trips: two clicks landing at the same moment can
-- both pass it. This index is what actually makes it impossible.

-- Collapse any duplicates that already exist, keeping the earliest — the
-- request that genuinely came first. The index cannot be created while
-- duplicate rows are still present.
delete from trip_requests a
using trip_requests b
where a.ride_id = b.ride_id
  and a.rider_id = b.rider_id
  and a.created_at > b.created_at;

create unique index if not exists trip_requests_one_per_rider
  on trip_requests (ride_id, rider_id);

-- Requests are answered oldest-first, so the driver's queue is ordered by
-- arrival. This index keeps that read cheap.
create index if not exists trip_requests_ride_created
  on trip_requests (ride_id, created_at);


-- ============================================================
-- 003 — the vehicle a driver actually turns up in
-- ============================================================
--
-- A rider standing on a kerb needs to know which car is theirs. The
-- profile already said "car"; it never said which one.

alter table profiles
  add column if not exists vehicle_number text;


-- ============================================================
-- 004 — a number to ring
-- ============================================================
--
-- Only ever shown between a driver and a rider whose request has been
-- accepted. Browsing the board never reveals one.

alter table profiles
  add column if not exists phone text;


-- ============================================================
-- 005 — live tracking
-- ============================================================
--
-- Where the driver is, and how far along the trip is. Read back only by
-- the riders they have accepted; the API enforces that, not the client.

alter table rides
  add column if not exists live_lat     double precision,
  add column if not exists live_lng     double precision,
  add column if not exists live_heading double precision,
  add column if not exists live_at      timestamptz,

  -- scheduled -> to_pickup -> arrived -> started -> completed
  add column if not exists trip_status  text default 'scheduled';

create index if not exists rides_driver_trip_status
  on rides (driver_id, trip_status);


-- ============================================================
-- 006 — an address to notify people at
-- ============================================================
--
-- Notifications are about reaching the *other* person: the driver who is
-- not looking at the app when a seat is requested, the rider waiting on
-- an answer. The API can read the caller's own email from their token,
-- but never anybody else's, so each profile carries its owner's address.
-- It is written from the verified token, never the request body.

alter table profiles
  add column if not exists email text;

create index if not exists profiles_email_idx on profiles (email);

-- 007 — messages, and reporting a trip that went wrong
--
-- See 007_messages_and_reports.sql for the reasoning. Threads belong to an
-- accepted request, so they exist only between two people actually
-- travelling together; reports outlive the trip they refer to, because a
-- report about a deleted ride is exactly the one worth keeping.
 create if not exists trip_messages (
  id         uuid primary key default gen_random_uuid(),

  -- The thread. One per accepted request, cascading: if the trip itself is
  -- removed there is nobody left who is allowed to read this.
  request_id uuid not null references trip_requests (id) on delete cascade,
  sender_id  uuid not null references profiles (id) on delete cascade,

  body       text not null,
  created_at timestamptz not null default now(),

  -- Set when the *other* person has loaded the thread. Drives the unread
  -- count, nothing more.
  read_at    timestamptz
);

-- Every read is "this thread, in order", which is exactly this index.
create index if not exists trip_messages_thread
  on trip_messages (request_id, created_at);

-- Counting what the other person has not read yet.
create index if not exists trip_messages_unread
  on trip_messages (request_id, sender_id) where read_at is null;

create table if not exists safety_reports (
  id          uuid primary key default gen_random_uuid(),

  -- Null rather than cascade: the trip may be gone, the report stands.
  request_id  uuid references trip_requests (id) on delete set null,
  ride_id     uuid references rides (id) on delete set null,

  reporter_id uuid not null references profiles (id) on delete cascade,

  -- Who it is about. Null is allowed for a report about the trip itself
  -- rather than about a person.
  subject_id  uuid references profiles (id) on delete set null,

  -- Kept as text with a check rather than an enum: adding a category to an
  -- enum needs a migration, and this list will grow.
  category    text not null check (category in (
    'unsafe_driving',
    'no_show',
    'wrong_vehicle',
    'harassment',
    'payment',
    'other'
  )),

  details     text,

  -- open -> reviewing -> resolved | dismissed. Moved by whoever handles
  -- these; the app only ever writes 'open'.
  status      text not null default 'open',

  created_at  timestamptz not null default now()
);

-- "What has been reported about this person" — the question that matters
-- when deciding whether an account should keep driving.
create index if not exists safety_reports_subject
  on safety_reports (subject_id, created_at desc);

-- "What have I reported", for showing someone their own history.
create index if not exists safety_reports_reporter
  on safety_reports (reporter_id, created_at desc);

-- One report per person, per trip, per category. A second click, or a
-- second tab, is not a second incident.
create unique index if not exists safety_reports_one_per_trip
  on safety_reports (reporter_id, request_id, category)
  where request_id is not null;

-- Note on row-level security: like the other tables here, these are
-- reached only through the API, which resolves the caller from a signed
-- token and decides who may read what. Nothing in the browser holds a key
-- that can touch them directly.
--
-- What has been reported, most recent first:
--
--   select r.created_at, r.category, r.status,
--          reporter.name as by, subject.name as about, r.details
--   from safety_reports r
--   left join profiles reporter on reporter.id = r.reporter_id
--   left join profiles subject  on subject.id  = r.subject_id
--   order by r.created_at desc;


-- ============================================================
-- 008 — a ride stops existing when it leaves
-- ============================================================
--
-- A departure was only ever stored as the two halves a human types: a
-- date and a time, in the driver's own wall clock. Nothing could compare
-- that against now(), so the board was every row in the table and a ride
-- posted for last Tuesday stayed on it forever.
--
-- This stores the departure as a real instant, keeps it in step with a
-- trigger, indexes it, and adds the sweeper that clears out rides nothing
-- ever happened on.

create or replace function campushop_timezone()
  returns text
  language sql
  immutable
  parallel safe
as $$
  select 'Asia/Kolkata'::text;
$$;


-- ============================================================
-- date + time -> the instant it leaves
-- ============================================================
--
-- Takes text so it does not care whether `time` is stored as `time` or as
-- `text`, and whether it reads 08:00 or 08:00:00 — both are true of rides
-- already in this table.
--
-- A row whose date will not parse returns null, and null is treated
-- everywhere below as "we do not know when this leaves". Such a ride is
-- kept and shown rather than hidden or deleted: losing a real ride to a
-- parsing quirk is far worse than leaving one odd row on the board.
--
-- A missing time is read as 23:59 — the ride is assumed to be good until
-- the end of its day, so a half-filled row is never binned early.

create or replace function campushop_departs_at(d text, t text)
  returns timestamptz
  language plpgsql
  stable
  parallel safe
as $$
declare
  wall timestamp;
begin
  if d is null or btrim(d) = '' then
    return null;
  end if;

  begin
    wall := (btrim(d) || ' ' || coalesce(nullif(btrim(t), ''), '23:59'))::timestamp;
  exception
    when others then
      return null;
  end;

  -- Reads the wall clock as standing in the campus's zone, which is what
  -- makes it comparable with now().
  return wall at time zone campushop_timezone();
end;
$$;


-- ============================================================
-- The column, and the trigger that keeps it honest
-- ============================================================

alter table rides
  add column if not exists departs_at timestamptz;

-- Derived, never supplied. The API server does not write this column and
-- the browser has never been able to: whatever date and time end up on the
-- row, the instant matches them. That is the point of doing it in the
-- database rather than in whichever code path happened to do the insert.

create or replace function campushop_rides_set_departs_at()
  returns trigger
  language plpgsql
as $$
begin
  new.departs_at := campushop_departs_at(new.date::text, new.time::text);
  return new;
end;
$$;

drop trigger if exists rides_set_departs_at on rides;

create trigger rides_set_departs_at
  before insert or update of date, time
  on rides
  for each row
  execute function campushop_rides_set_departs_at();

-- Every ride already posted.
update rides
   set departs_at = campushop_departs_at(date::text, time::text)
 where departs_at is distinct from campushop_departs_at(date::text, time::text);

-- The board's one question — "what has not left yet" — asked on every
-- search and every poll.
create index if not exists rides_departs_at
  on rides (departs_at);


-- ============================================================
-- What "still joinable" means
-- ============================================================
--
-- One definition, in the database, so the API and the browser are agreeing
-- with something rather than each inventing their own answer.
--
-- Note what is *not* here: a ride does not stay joinable because its driver
-- is currently driving it. A trip already under way is no longer a seat
-- anybody can ask for, so it leaves the board at its departure time like
-- any other — it simply is not deleted while it runs. Being off the board
-- and being gone are two different things, and the sweeper below is the
-- one that decides the second.

create or replace view active_rides as
  select *
    from rides
   where departs_at is null
      or departs_at >= now();

comment on view active_rides is
  'Rides that have not departed yet - the ride board. Rides with an '
  'unparseable date are kept deliberately rather than hidden.';


-- ============================================================
-- The sweeper
-- ============================================================
--
-- Deleting a ride is not the same as taking it off the board, and this is
-- deliberately far more cautious than the view above.
--
-- A ride is only removed when both are true:
--
--   * it left more than the grace period ago, and
--   * nobody ever asked for a seat on it.
--
-- Which is to say: only the rides nothing ever happened on — posted,
-- ignored, and now over. That is the overwhelming majority of what piles
-- up, and none of it is anybody's history.
--
-- How far along the trip got is deliberately not part of this. It was, at
-- first, on the reasoning that a trip in progress must never be deleted —
-- but the grace period is what actually protects that, and hours after
-- departure a ride nobody ever requested has no passenger left to protect.
-- All the condition really did was keep every ride whose driver once
-- pressed "start", which on a test database is most of them.
--
-- The moment a request exists, the ride stops being deletable, whatever
-- became of that request. An accepted one is a trip somebody took: MyTrips
-- lists it, a safety report can point at it, and the driver's reliability
-- count is built from it. A declined one is still the rider's record of
-- having asked. Even an unanswered one is what the driver's queue shows as
-- missed. All three read the ride row for where the trip was going, so
-- deleting it would not tidy the table — it would blank out screens that
-- are still in use. Unanswered requests are swept separately a week later
-- (see purgeExpiredRequests in the API), and the ride becomes deletable
-- once they are gone.
--
-- The grace period covers the ride that is running late or running long.
-- A driver who set off at 08:00 and has not touched the app is still on
-- the road at 08:05, and a trip deleted out from under them mid-journey
-- would take the live map with it.
--
-- security definer so the sweep works whichever key the API server is
-- holding — the anon key is subject to row-level security, and a cleanup
-- job that silently deletes nothing is the worst of both worlds.

create or replace function delete_expired_rides(grace_minutes integer default 180)
  returns integer
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  removed integer;
begin
  delete from rides r
   where r.departs_at is not null
     and r.departs_at < now() - make_interval(mins => greatest(grace_minutes, 0))
     and not exists (
           select 1
             from trip_requests tr
            where tr.ride_id = r.id
         );

  get diagnostics removed = row_count;

  return removed;
end;
$$;

comment on function delete_expired_rides(integer) is
  'Removes departed rides that nobody ever requested and that never '
  'started. Rides with any request are history and are kept. Safe to run '
  'repeatedly; returns how many were removed.';

-- The API server calls this on boot and on a timer, so the cleanup happens
-- whether or not the database has a scheduler. If pg_cron is enabled the
-- job below runs it in the database too, which keeps the table tidy even
-- when no server is up.
grant execute on function delete_expired_rides(integer) to anon, authenticated, service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('campushop-expired-rides')
      where exists (select 1 from cron.job where jobname = 'campushop-expired-rides');

    perform cron.schedule(
      'campushop-expired-rides',
      '*/15 * * * *',
      'select delete_expired_rides();'
    );

    raise notice 'pg_cron: expired rides will be swept every 15 minutes.';
  else
    raise notice 'pg_cron is not enabled - the API server sweeps instead. That is fine.';
  end if;
exception
  when others then
    raise notice 'pg_cron scheduling skipped (%). The API server sweeps instead.', sqlerrm;
end;
$$;


-- ============================================================
-- Check it worked
-- ============================================================
--
-- Should list: vehicle_number, phone, email, and the ride columns.

select table_name, column_name
from information_schema.columns
where (table_name = 'profiles' and column_name in ('vehicle_number', 'phone', 'email'))
   or (table_name = 'rides' and column_name in (
        'pickup_lat', 'pickup_lng', 'dropoff_lat', 'dropoff_lng',
        'route_geometry', 'distance_meters', 'duration_seconds',
        'live_lat', 'live_lng', 'live_heading', 'live_at', 'trip_status',
        'departs_at'))
order by table_name, column_name;

-- And the two tables added in 007.

select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in ('trip_messages', 'safety_reports')
order by table_name;

-- Nothing on the board should have a departure in the past.

select count(*) filter (where departs_at >= now()) as on_the_board,
       count(*) filter (where departs_at <  now()) as departed,
       count(*) filter (where departs_at is null)  as undated
from rides;
