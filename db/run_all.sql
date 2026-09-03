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
-- Check it worked
-- ============================================================
--
-- Should list: vehicle_number, phone, and the seven ride columns.

select table_name, column_name
from information_schema.columns
where (table_name = 'profiles' and column_name in ('vehicle_number', 'phone'))
   or (table_name = 'rides' and column_name in (
        'pickup_lat', 'pickup_lng', 'dropoff_lat', 'dropoff_lng',
        'route_geometry', 'distance_meters', 'duration_seconds',
        'live_lat', 'live_lng', 'live_heading', 'live_at', 'trip_status'))
order by table_name, column_name;
