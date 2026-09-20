-- CampusHop: a ride stops existing when it leaves.
--
-- Run this once in the Supabase dashboard: SQL Editor -> New query -> Run.
--
-- Until now nothing in the database knew when a ride was over. The board
-- was every row in `rides`, so a commute posted for last Tuesday sat on
-- "closest first" forever, and a rider could still ask for a seat in a car
-- that left three days ago.
--
-- The trouble is that a ride's departure was only ever stored as the two
-- halves a human types: a `date` and a `time`, in the driver's own wall
-- clock. Two text-ish columns cannot be compared against `now()`, cannot be
-- indexed as an instant, and give every layer of the app its own chance to
-- get the comparison subtly wrong. So the first thing here is a real
-- timestamp, kept in step by a trigger, and everything else — the view, the
-- index, the cleanup — is written against that one column.
--
-- What this adds:
--
--   departs_at            the moment the ride leaves, as an instant
--   campushop_timezone()  the campus's wall clock, in one place
--   active_rides          the view that defines "still joinable"
--   delete_expired_rides  the sweeper, safe to run as often as you like


-- ============================================================
-- The campus's clock
-- ============================================================
--
-- `date` and `time` are what the driver typed, which is local time — the
-- 8am they meant is 8am where they are standing, not 8am UTC. Turning that
-- into an instant needs to know which zone "local" is, and a campus app is
-- the rare case where that is genuinely one fixed answer.
--
-- Change the zone here if the campus is not in India. It is a function
-- rather than a constant so there is exactly one place to change, and so
-- the trigger and the sweeper below cannot drift apart.

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
-- Every ride, with the instant it leaves and whether it is still on the
-- board. `departs_at` should be filled in on every row that has a date.
--
--   select id, date, time, departs_at,
--          departs_at >= now() as on_the_board,
--          trip_status
--   from rides
--   order by departs_at desc nulls last;
--
-- What the sweeper would remove, without removing it:
--
--   select r.id, r.date, r.time, r.trip_status
--   from rides r
--   where r.departs_at < now() - interval '180 minutes'
--     and not exists (select 1 from trip_requests tr where tr.ride_id = r.id);
--
-- And to run it now:
--
--   select delete_expired_rides();
