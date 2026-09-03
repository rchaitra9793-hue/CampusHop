-- CampusHop: one request per rider, per ride.
--
-- Run this once in the Supabase dashboard: SQL Editor -> New query -> Run.
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
