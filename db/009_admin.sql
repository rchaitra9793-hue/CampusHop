-- ============================================================
-- 009 — administration
-- ============================================================
--
-- Run this once in the Supabase dashboard: SQL Editor -> New query -> Run.
--
-- 007 built the half of safety reporting that a user sees: either side of
-- a trip can file one, and the table has carried a `status` column with a
-- documented lifecycle — open -> reviewing -> resolved | dismissed — since
-- the day it was created. Nothing has ever been able to move it. This is
-- the other half: the people who read that queue, and what they may do
-- about it.
--
-- What this adds:
--
--   profiles.is_admin     the privilege, separate from the display role
--   profiles.suspended_at an account that may no longer sign in
--   admin_actions         a record of everything an admin did


-- ============================================================
-- The privilege
-- ============================================================
--
-- Deliberately NOT the existing `role` column. That one is picked by the
-- user on the signup form and means "student" or "faculty" — it is a label
-- shown next to their name, and it arrives in a request body. A privilege
-- that can be named in a request body is not a privilege.
--
-- `is_admin` has no write path in the API at all: PATCH /api/profile
-- updates a fixed list of fields that does not include it, and the signup
-- upsert writes only id, name, role and email. It is set here, by hand, by
-- somebody who already has database access.

alter table profiles
  add column if not exists is_admin boolean not null default false;

-- Listing the administrators is rare, but it is the one question whose
-- answer must never be slow or wrong. Partial, because the index is only
-- ever asked for the true rows.
create index if not exists profiles_admin_idx
  on profiles (id) where is_admin;


-- ============================================================
-- Suspension
-- ============================================================
--
-- The outcome a report can lead to. A timestamp rather than a boolean so
-- the record says *when*, which is the first thing anyone asks when a
-- suspension is appealed. Null means an account in good standing.
--
-- Checked by the API on every authenticated request, so a suspension takes
-- effect within the token cache window rather than at next sign-in.

alter table profiles
  add column if not exists suspended_at timestamptz;

-- Why, in the words of the admin who did it. Shown to the user when they
-- are turned away, so "contact the campus office" is not the only thing
-- they are told.
alter table profiles
  add column if not exists suspended_reason text;


-- ============================================================
-- What the admins did
-- ============================================================
--
-- Powers with no record of their use are the part that becomes impossible
-- to reason about later: a suspended account with nothing saying who
-- suspended it, or why, cannot be reviewed by anyone. Every state change
-- an admin makes writes one row here, and nothing ever deletes one.
--
-- The admin reference does not cascade. If an administrator's own profile
-- is removed, what they did still happened.

create table if not exists admin_actions (
  id         uuid primary key default gen_random_uuid(),

  admin_id   uuid not null references profiles (id) on delete restrict,

  -- 'report.status', 'user.suspend', 'user.reinstate', 'report.thread_read'.
  -- Text with no check constraint: unlike a report category, this list
  -- grows with every feature, and a migration per audit verb is friction
  -- in exactly the wrong place.
  action     text not null,

  -- The report or profile it was about. No foreign key: a report may be
  -- deleted later, and the audit row has to outlive it.
  target_id  uuid,

  -- Free text. For a status move, what it moved to and why.
  note       text,

  created_at timestamptz not null default now()
);

-- The audit log is read as "most recent first", and occasionally as
-- "everything about this target".
create index if not exists admin_actions_recent
  on admin_actions (created_at desc);

create index if not exists admin_actions_target
  on admin_actions (target_id, created_at desc);


-- ============================================================
-- Making the first administrator
-- ============================================================
--
-- There is no endpoint for this, on purpose. An API that can grant
-- administrator is an API that can be made to grant administrator; the
-- only safe place to create the first one is here, with the credentials
-- the Supabase dashboard already asked you for.
--
-- Uncomment, put in your own address, and run:
--
--   update profiles set is_admin = true where email = 'you@college.edu';
--
-- Check it took:
--
--   select name, email, is_admin from profiles where is_admin;
