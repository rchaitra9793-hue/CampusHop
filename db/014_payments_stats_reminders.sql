-- CampusHop: paying for a ride, lifetime member stats, departure-day reminders.
--
-- Run this once in the Supabase dashboard: SQL Editor -> New query -> Run.
-- Safe to run more than once.

-- 1. Paying after the ride -------------------------------------------------
--
-- The driver's UPI ID, so a rider can pay them straight from their UPI app.
alter table profiles add column if not exists upi_id text;

-- How each seat was settled.
--   payment_status: unpaid -> paid (rider says they paid) -> confirmed (driver received it)
--   payment_method: upi | cash
alter table trip_requests add column if not exists payment_status text not null default 'unpaid';
alter table trip_requests add column if not exists payment_method text;
alter table trip_requests add column if not exists paid_at timestamptz;
alter table trip_requests add column if not exists payment_confirmed_at timestamptz;

-- 2. Lifetime stats ---------------------------------------------------------
--
-- Kept as counters on the profile, because finished trips are deleted after
-- a week (TRIP_HISTORY_DAYS) and a count worked out from them would shrink.
alter table profiles add column if not exists rides_given integer not null default 0;
alter table profiles add column if not exists rides_taken integer not null default 0;
alter table profiles add column if not exists km_shared numeric(12, 1) not null default 0;

-- So a trip is only ever counted once, however many times it is marked done.
alter table rides add column if not exists stats_counted_at timestamptz;

-- Backfill from the completed trips still in the database.
with done as (
  select r.id, r.driver_id, coalesce(r.distance_meters, 0) / 1000.0 as km
  from rides r
  where r.trip_status = 'completed'
    and r.stats_counted_at is null
    and exists (
      select 1 from trip_requests q where q.ride_id = r.id and q.status = 'accepted'
    )
),
driver_totals as (
  select driver_id, count(*) as n, sum(km) as km from done group by driver_id
),
rider_totals as (
  select q.rider_id, count(*) as n, sum(d.km) as km
  from trip_requests q
  join done d on d.id = q.ride_id
  where q.status = 'accepted'
  group by q.rider_id
),
totals as (
  select coalesce(dt.driver_id, rt.rider_id) as id,
         coalesce(dt.n, 0) as given,
         coalesce(rt.n, 0) as taken,
         coalesce(dt.km, 0) + coalesce(rt.km, 0) as km
  from driver_totals dt
  full outer join rider_totals rt on rt.rider_id = dt.driver_id
)
update profiles p
set rides_given = p.rides_given + t.given,
    rides_taken = p.rides_taken + t.taken,
    km_shared   = p.km_shared + t.km
from totals t
where p.id = t.id;

update rides r
set stats_counted_at = now()
where r.trip_status = 'completed'
  and r.stats_counted_at is null
  and exists (select 1 from trip_requests q where q.ride_id = r.id and q.status = 'accepted');

-- Campus-wide totals that outlive deleted rides.
create table if not exists campus_stats (
  id          smallint primary key default 1 check (id = 1),
  rides_completed integer not null default 0,
  km_travelled    numeric(14, 1) not null default 0,
  riders_carried  integer not null default 0,
  updated_at  timestamptz not null default now()
);

insert into campus_stats (id, rides_completed, km_travelled, riders_carried)
select 1,
       coalesce(sum(rides_given), 0),
       0,
       coalesce(sum(rides_taken), 0)
from profiles
on conflict (id) do nothing;

-- Distance actually driven on completed trips (once per ride, not per seat).
update campus_stats
set km_travelled = (
  select coalesce(sum(coalesce(r.distance_meters, 0)) / 1000.0, 0)
  from rides r
  where r.trip_status = 'completed' and r.stats_counted_at is not null
)
where id = 1 and km_travelled = 0;

-- 3. Departure-day reminders -----------------------------------------------
alter table trip_requests add column if not exists reminder_sent_at timestamptz;
alter table rides add column if not exists reminder_sent_at timestamptz;

notify pgrst, 'reload schema';
