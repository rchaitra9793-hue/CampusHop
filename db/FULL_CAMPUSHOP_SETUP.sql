-- ============================================================
-- CAMPUSHOP — FULL DATABASE SETUP / REPAIR
-- ============================================================
--
-- Run this ONE file in Supabase SQL Editor.
--
-- IMPORTANT:
-- The original/base CampusHop schema must already contain:
--   public.profiles
--   public.rides
--   public.trip_requests
--
-- This file applies every migration shipped with the current app in order,
-- repairs profiles that exist in Supabase Auth but not in public.profiles,
-- installs a trigger so new Auth accounts always get a profile row, and
-- reloads PostgREST's schema cache.
--
-- Safe to run more than once.
-- ============================================================

DO $$
BEGIN
  IF to_regclass('public.profiles') IS NULL THEN
    RAISE EXCEPTION
      'CampusHop base schema missing: public.profiles does not exist.';
  END IF;

  IF to_regclass('public.rides') IS NULL THEN
    RAISE EXCEPTION
      'CampusHop base schema missing: public.rides does not exist.';
  END IF;

  IF to_regclass('public.trip_requests') IS NULL THEN
    RAISE EXCEPTION
      'CampusHop base schema missing: public.trip_requests does not exist.';
  END IF;
END $$;


-- ============================================================
-- 001 ROUTE COLUMNS
-- ============================================================

ALTER TABLE public.rides
  ADD COLUMN IF NOT EXISTS pickup_lat       double precision,
  ADD COLUMN IF NOT EXISTS pickup_lng       double precision,
  ADD COLUMN IF NOT EXISTS dropoff_lat      double precision,
  ADD COLUMN IF NOT EXISTS dropoff_lng      double precision,
  ADD COLUMN IF NOT EXISTS route_geometry   jsonb,
  ADD COLUMN IF NOT EXISTS distance_meters  integer,
  ADD COLUMN IF NOT EXISTS duration_seconds integer;


-- ============================================================
-- 002 ONE REQUEST PER RIDER / RIDE
-- ============================================================

DELETE FROM public.trip_requests a
USING public.trip_requests b
WHERE a.ride_id = b.ride_id
  AND a.rider_id = b.rider_id
  AND a.created_at > b.created_at;

CREATE UNIQUE INDEX IF NOT EXISTS trip_requests_one_per_rider
  ON public.trip_requests (ride_id, rider_id);

CREATE INDEX IF NOT EXISTS trip_requests_ride_created
  ON public.trip_requests (ride_id, created_at);


-- ============================================================
-- 003 VEHICLE NUMBER
-- ============================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS vehicle_number text;


-- ============================================================
-- 004 PHONE
-- ============================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS phone text;


-- ============================================================
-- 005 LIVE TRACKING
-- ============================================================

ALTER TABLE public.rides
  ADD COLUMN IF NOT EXISTS live_lat      double precision,
  ADD COLUMN IF NOT EXISTS live_lng      double precision,
  ADD COLUMN IF NOT EXISTS live_heading  double precision,
  ADD COLUMN IF NOT EXISTS live_at       timestamptz,
  ADD COLUMN IF NOT EXISTS trip_status   text DEFAULT 'scheduled';

UPDATE public.rides
SET trip_status = 'scheduled'
WHERE trip_status IS NULL;

CREATE INDEX IF NOT EXISTS rides_driver_trip_status
  ON public.rides (driver_id, trip_status);


-- ============================================================
-- 006 PROFILE EMAIL
-- ============================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS email text;

CREATE INDEX IF NOT EXISTS profiles_email_idx
  ON public.profiles (email);


-- ============================================================
-- 007 CHAT + SAFETY REPORTS
-- ============================================================

CREATE TABLE IF NOT EXISTS public.trip_messages (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.trip_requests(id) ON DELETE CASCADE,
  sender_id  uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  body       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at    timestamptz
);

CREATE INDEX IF NOT EXISTS trip_messages_thread
  ON public.trip_messages (request_id, created_at);

CREATE INDEX IF NOT EXISTS trip_messages_unread
  ON public.trip_messages (request_id, sender_id)
  WHERE read_at IS NULL;

CREATE TABLE IF NOT EXISTS public.safety_reports (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id  uuid REFERENCES public.trip_requests(id) ON DELETE SET NULL,
  ride_id     uuid REFERENCES public.rides(id) ON DELETE SET NULL,
  reporter_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  subject_id  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  category    text NOT NULL CHECK (
    category IN (
      'unsafe_driving',
      'no_show',
      'wrong_vehicle',
      'harassment',
      'payment',
      'other'
    )
  ),
  details     text,
  status      text NOT NULL DEFAULT 'open',
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS safety_reports_subject
  ON public.safety_reports (subject_id, created_at DESC);

CREATE INDEX IF NOT EXISTS safety_reports_reporter
  ON public.safety_reports (reporter_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS safety_reports_one_per_trip
  ON public.safety_reports (reporter_id, request_id, category)
  WHERE request_id IS NOT NULL;


-- ============================================================
-- 008 RIDE EXPIRY
-- ============================================================

CREATE OR REPLACE FUNCTION public.campushop_timezone()
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT 'Asia/Kolkata'::text;
$$;

CREATE OR REPLACE FUNCTION public.campushop_departs_at(d text, t text)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
PARALLEL SAFE
AS $$
DECLARE
  wall timestamp;
BEGIN
  IF d IS NULL OR btrim(d) = '' THEN
    RETURN NULL;
  END IF;

  BEGIN
    wall := (
      btrim(d) || ' ' || coalesce(nullif(btrim(t), ''), '23:59')
    )::timestamp;
  EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
  END;

  RETURN wall AT TIME ZONE public.campushop_timezone();
END;
$$;

ALTER TABLE public.rides
  ADD COLUMN IF NOT EXISTS departs_at timestamptz;

CREATE OR REPLACE FUNCTION public.campushop_rides_set_departs_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.departs_at := public.campushop_departs_at(NEW.date::text, NEW.time::text);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS rides_set_departs_at ON public.rides;

CREATE TRIGGER rides_set_departs_at
BEFORE INSERT OR UPDATE OF date, time
ON public.rides
FOR EACH ROW
EXECUTE FUNCTION public.campushop_rides_set_departs_at();

UPDATE public.rides
SET departs_at = public.campushop_departs_at(date::text, time::text)
WHERE departs_at IS DISTINCT FROM public.campushop_departs_at(date::text, time::text);

CREATE INDEX IF NOT EXISTS rides_departs_at
  ON public.rides (departs_at);

CREATE OR REPLACE VIEW public.active_rides AS
SELECT *
FROM public.rides
WHERE departs_at IS NULL OR departs_at >= now();

CREATE OR REPLACE FUNCTION public.delete_expired_rides(grace_minutes integer DEFAULT 180)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  removed integer;
BEGIN
  DELETE FROM public.rides r
  WHERE r.departs_at IS NOT NULL
    AND r.departs_at < now() - make_interval(mins => greatest(grace_minutes, 0))
    AND NOT EXISTS (
      SELECT 1
      FROM public.trip_requests tr
      WHERE tr.ride_id = r.id
    );

  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_expired_rides(integer)
TO anon, authenticated, service_role;


-- ============================================================
-- 009 ADMIN
-- ============================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_admin boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS suspended_at timestamptz,
  ADD COLUMN IF NOT EXISTS suspended_reason text;

CREATE INDEX IF NOT EXISTS profiles_admin_idx
  ON public.profiles (id)
  WHERE is_admin;

CREATE TABLE IF NOT EXISTS public.admin_actions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id   uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  action     text NOT NULL,
  target_id  uuid,
  note       text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_actions_recent
  ON public.admin_actions (created_at DESC);

CREATE INDEX IF NOT EXISTS admin_actions_target
  ON public.admin_actions (target_id, created_at DESC);


-- ============================================================
-- 010 RATINGS
-- ============================================================

CREATE TABLE IF NOT EXISTS public.trip_ratings (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid REFERENCES public.trip_requests(id) ON DELETE SET NULL,
  ride_id    uuid REFERENCES public.rides(id) ON DELETE SET NULL,
  rater_id   uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  subject_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  stars      smallint NOT NULL CHECK (stars BETWEEN 1 AND 5),
  comment    text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT trip_ratings_not_self CHECK (rater_id <> subject_id)
);

CREATE INDEX IF NOT EXISTS trip_ratings_subject
  ON public.trip_ratings (subject_id);

CREATE INDEX IF NOT EXISTS trip_ratings_rater
  ON public.trip_ratings (rater_id, created_at DESC);

-- Collapse accidental duplicates before adding the unique index.
DELETE FROM public.trip_ratings a
USING public.trip_ratings b
WHERE a.rater_id = b.rater_id
  AND a.request_id = b.request_id
  AND a.request_id IS NOT NULL
  AND a.id <> b.id
  AND a.created_at > b.created_at;

CREATE UNIQUE INDEX IF NOT EXISTS trip_ratings_one_per_trip
  ON public.trip_ratings (rater_id, request_id);

CREATE OR REPLACE VIEW public.profile_ratings AS
SELECT
  subject_id,
  round(avg(stars)::numeric, 2) AS rating_avg,
  count(*)::int AS rating_count
FROM public.trip_ratings
GROUP BY subject_id;

GRANT SELECT ON public.profile_ratings
TO anon, authenticated, service_role;


-- ============================================================
-- 011 ADMIN DETAIL / REPORT RESOLUTION
-- ============================================================

ALTER TABLE public.safety_reports
  ADD COLUMN IF NOT EXISTS resolution text,
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS resolved_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS safety_reports_queue
  ON public.safety_reports (status, created_at);

CREATE INDEX IF NOT EXISTS rides_driver_recent
  ON public.rides (driver_id, created_at DESC);


-- ============================================================
-- 012 ADMIN INVITES
-- ============================================================

CREATE TABLE IF NOT EXISTS public.admin_invites (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email       text NOT NULL,
  invited_by  uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  reason      text,
  code_hash   text NOT NULL,
  expires_at  timestamptz NOT NULL,
  attempts    smallint NOT NULL DEFAULT 0,
  accepted_at timestamptz,
  accepted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_invites_email
  ON public.admin_invites (email, created_at DESC);

CREATE INDEX IF NOT EXISTS admin_invites_open
  ON public.admin_invites (created_at DESC)
  WHERE accepted_at IS NULL;


-- ============================================================
-- 013 CAMPUS SOCIAL
-- ============================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS course text;

ALTER TABLE public.rides
  ADD COLUMN IF NOT EXISTS vibe text;

ALTER TABLE public.rides
  DROP CONSTRAINT IF EXISTS rides_vibe_check;

ALTER TABLE public.rides
  ADD CONSTRAINT rides_vibe_check
  CHECK (vibe IS NULL OR vibe IN ('music', 'chatty', 'quiet', 'study', 'chai'));

CREATE TABLE IF NOT EXISTS public.campus_wall_posts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id  uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  body       text NOT NULL CHECK (char_length(trim(body)) BETWEEN 1 AND 280),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS campus_wall_recent
  ON public.campus_wall_posts (created_at DESC);

CREATE INDEX IF NOT EXISTS profiles_course_idx
  ON public.profiles (course);

CREATE INDEX IF NOT EXISTS rides_vibe_idx
  ON public.rides (vibe);


-- ============================================================
-- 014 PROFILE REPAIR / AUTO-CREATE
-- ============================================================
--
-- This fixes the exact PGRST116 problem where a Supabase Auth account exists
-- but public.profiles has no corresponding row.

INSERT INTO public.profiles (id, name, role, email)
SELECT
  u.id,
  COALESCE(NULLIF(u.raw_user_meta_data ->> 'name', ''), split_part(u.email, '@', 1), 'Rider'),
  CASE
    WHEN lower(COALESCE(u.raw_user_meta_data ->> 'role', 'student')) = 'faculty'
      THEN 'faculty'
    ELSE 'student'
  END,
  u.email
FROM auth.users u
LEFT JOIN public.profiles p ON p.id = u.id
WHERE p.id IS NULL;


CREATE OR REPLACE FUNCTION public.campushop_create_profile_for_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, name, role, email)
  VALUES (
    NEW.id,
    COALESCE(NULLIF(NEW.raw_user_meta_data ->> 'name', ''), split_part(NEW.email, '@', 1), 'Rider'),
    CASE
      WHEN lower(COALESCE(NEW.raw_user_meta_data ->> 'role', 'student')) = 'faculty'
        THEN 'faculty'
      ELSE 'student'
    END,
    NEW.email
  )
  ON CONFLICT (id) DO UPDATE
  SET email = COALESCE(EXCLUDED.email, public.profiles.email);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS campushop_create_profile ON auth.users;

CREATE TRIGGER campushop_create_profile
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.campushop_create_profile_for_auth_user();


-- ============================================================
-- FINAL SCHEMA CACHE RELOAD
-- ============================================================

NOTIFY pgrst, 'reload schema';


-- ============================================================
-- VERIFICATION
-- ============================================================

SELECT
  'profiles' AS object_name,
  to_regclass('public.profiles') IS NOT NULL AS exists
UNION ALL
SELECT 'rides', to_regclass('public.rides') IS NOT NULL
UNION ALL
SELECT 'trip_requests', to_regclass('public.trip_requests') IS NOT NULL
UNION ALL
SELECT 'trip_messages', to_regclass('public.trip_messages') IS NOT NULL
UNION ALL
SELECT 'safety_reports', to_regclass('public.safety_reports') IS NOT NULL
UNION ALL
SELECT 'trip_ratings', to_regclass('public.trip_ratings') IS NOT NULL
UNION ALL
SELECT 'profile_ratings', to_regclass('public.profile_ratings') IS NOT NULL
UNION ALL
SELECT 'campus_wall_posts', to_regclass('public.campus_wall_posts') IS NOT NULL
UNION ALL
SELECT 'admin_actions', to_regclass('public.admin_actions') IS NOT NULL
UNION ALL
SELECT 'admin_invites', to_regclass('public.admin_invites') IS NOT NULL;
