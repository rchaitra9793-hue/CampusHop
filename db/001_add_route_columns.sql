-- CampusHop: store real road routes on each ride.
--
-- Run this once in the Supabase dashboard: SQL Editor -> New query -> Run.
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

-- Rides posted before this migration have no coordinates, so they render
-- without a map. This lists them if you want to re-post or clean them up.
--
--   select id, pickup, dropoff, created_at
--   from rides
--   where pickup_lat is null;
