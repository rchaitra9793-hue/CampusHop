-- ============================================================
-- 010 — rating the person you travelled with
-- ============================================================
--
-- Run this once in the Supabase dashboard: SQL Editor -> New query -> Run.
--
-- The app has had two ways of saying how a trip went, and both are blunt.
-- A safety report is for when something was wrong enough to tell the
-- campus about, which is rare and should stay rare. The other is the
-- accepted-ride count already shown on every ride card and already worth
-- 15% of the match score — but that only counts how many times somebody
-- turned up, not whether anyone was glad they did.
--
-- This is the middle: five stars and an optional sentence, from each side
-- of a trip about the other. It is the signal a rider actually wants when
-- choosing between two cars leaving at the same time.
--
-- What this adds:
--
--   trip_ratings     one rating, by one person, about the other
--   profile_ratings  the average and the count, per person


-- ============================================================
-- The ratings
-- ============================================================
--
-- Like safety_reports in 007, a rating outlives the trip it is about. The
-- trip row is deleted a week after it finishes (TRIP_HISTORY_DAYS) and the
-- ride is swept once it has departed, but "this driver has four stars from
-- eleven people" has to survive both or the number resets every week.
--
-- So the two trip references are `on delete set null` and the two people
-- cascade: a rating about somebody who deleted their account is not about
-- anybody any more.

create table if not exists trip_ratings (
  id         uuid primary key default gen_random_uuid(),

  -- Which trip. Null once the trip has been cleaned up; the rating stands.
  request_id uuid references trip_requests (id) on delete set null,
  ride_id    uuid references rides (id) on delete set null,

  rater_id   uuid not null references profiles (id) on delete cascade,
  subject_id uuid not null references profiles (id) on delete cascade,

  -- Five stars, whole numbers. A check rather than an enum for the same
  -- reason 007 gave: a constraint is cheap to read and cheap to change.
  stars      smallint not null check (stars between 1 and 5),

  -- Optional. Most people will leave it empty, and a rating with no words
  -- is still worth having.
  comment    text,

  created_at timestamptz not null default now(),

  -- Rating yourself would be the first thing anybody tried.
  constraint trip_ratings_not_self check (rater_id <> subject_id)
);

-- "What is this person's rating" — the question every ride card asks, and
-- the one the view below is built on.
create index if not exists trip_ratings_subject
  on trip_ratings (subject_id);

-- "What have I rated", for showing somebody their own history.
create index if not exists trip_ratings_rater
  on trip_ratings (rater_id, created_at desc);

-- One rating per person, per trip. A second thought about the same ride is
-- an edit, not a second rating — the API updates this row rather than
-- inserting another, and this is what makes that upsert possible.
--
-- Deliberately NOT a partial index. The obvious way to write this is
-- `where request_id is not null`, to stop one person's ratings of
-- cleaned-up trips colliding once that column goes null. But Postgres will
-- only infer a partial index in ON CONFLICT if the statement restates the
-- predicate, which PostgREST's upsert has no way to express — so the
-- partial version turns every rating into a 42P10 error.
--
-- It is also unnecessary. A plain unique index treats nulls as distinct,
-- so rows whose request_id has gone null never conflict with each other
-- anyway. That is exactly the property the `where` was reaching for.
create unique index if not exists trip_ratings_one_per_trip
  on trip_ratings (rater_id, request_id);


-- ============================================================
-- The average, per person
-- ============================================================
--
-- A view rather than a pair of columns kept up to date by a trigger. The
-- board reads this for every driver on it at once, which is one query
-- against a table with one row per rating — on a single campus that stays
-- small for a very long time. A trigger would be faster and is the thing
-- to reach for if it ever stops being small, but it also means an average
-- that can drift out of step with the ratings it is derived from, and
-- there is no reason to accept that yet.

create or replace view profile_ratings as
  select subject_id,
         round(avg(stars)::numeric, 2) as rating_avg,
         count(*)::int                 as rating_count
    from trip_ratings
   group by subject_id;

-- Read through the API under the service-role key, like everything else
-- here, but granted explicitly so the view is not the one thing that
-- behaves differently if the key ever changes.
grant select on profile_ratings to anon, authenticated, service_role;


-- ============================================================
-- Check it worked
-- ============================================================
--
--   select * from profile_ratings order by rating_avg desc;
--
-- And the ratings themselves, with names on:
--
--   select r.created_at, r.stars, r.comment,
--          rater.name   as by,
--          subject.name as about
--     from trip_ratings r
--     left join profiles rater   on rater.id   = r.rater_id
--     left join profiles subject on subject.id = r.subject_id
--    order by r.created_at desc;
