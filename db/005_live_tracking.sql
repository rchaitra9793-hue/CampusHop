-- CampusHop: where the driver is, and how far along the trip is.
--
-- Run this once in the Supabase dashboard: SQL Editor -> New query -> Run.
--
-- A rider waiting at a kerb wants to watch the car approach, not refresh
-- a list. The driver's position is written here as they move and read
-- back by the riders they have accepted — the browser never reads it
-- directly, so the API can enforce who is allowed to see whom.

alter table rides
  add column if not exists live_lat     double precision,
  add column if not exists live_lng     double precision,
  add column if not exists live_heading double precision,
  add column if not exists live_at      timestamptz,

  -- scheduled -> to_pickup -> arrived -> started -> completed
  add column if not exists trip_status  text default 'scheduled';

-- Reading a ride's live position is keyed on the ride itself, which is
-- already the primary key, so no extra index is needed. This one keeps
-- "which of my rides are running" cheap.
create index if not exists rides_driver_trip_status
  on rides (driver_id, trip_status);
