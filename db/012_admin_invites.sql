-- ============================================================
-- 012 — appointing an administrator by invitation
-- ============================================================
--
-- Run this once in the Supabase dashboard: SQL Editor -> New query -> Run.
--
-- 011 and before could only appoint somebody who had already signed up on
-- a campus address, because the dashboard appointed by picking a row out
-- of `profiles`. That is the wrong shape for the job: the people who
-- administer a campus app are often not the people who commute on it —
-- an office account, somebody in the warden's office, a staff address on
-- a different domain entirely.
--
-- So an invitation instead. An existing administrator proposes an address,
-- any address, and the account is only appointed once a code sent to that
-- address comes back. That code is the whole point: it is what turns
-- "somebody typed this address" into "whoever reads that mailbox agreed".
--
-- What this adds:
--
--   admin_invites   a proposed administrator, and the code that confirms


create table if not exists admin_invites (
  id          uuid primary key default gen_random_uuid(),

  -- Stored lower-cased and trimmed by the API, because this is matched
  -- against what somebody types back in and two spellings of one address
  -- must not be two invitations.
  --
  -- Deliberately no domain check. The campus rule belongs on the signup
  -- form, where it stops strangers joining the ride board; an
  -- administrator is appointed by another administrator, which is a
  -- different gate entirely.
  email       text not null,

  -- Who proposed them, and why. No cascade: if that administrator's own
  -- profile is later removed, the invitation still happened.
  invited_by  uuid not null references profiles (id) on delete restrict,
  reason      text,

  -- The code is never stored. A six-digit number in a table is a six-
  -- digit number anybody with read access can use, and read access to
  -- this table is exactly what an attacker who got the service key has.
  -- Only a salted hash of it lives here; see hashCode() in the API.
  code_hash   text not null,

  -- Short, because the person is being read the code over a desk or
  -- forwarding it from their phone, not finding it next week.
  expires_at  timestamptz not null,

  -- Guessing a six-digit code takes a million tries on average and about
  -- fifteen with no limit and a bit of luck. This is the limit.
  attempts    smallint not null default 0,

  -- Set when the code came back and the appointment went through. A used
  -- invitation is kept rather than deleted: it is the record of how
  -- somebody became an administrator.
  accepted_at timestamptz,
  accepted_by uuid references profiles (id) on delete set null,

  created_at  timestamptz not null default now()
);

-- "Is there a live invitation for this address?" — asked on every send,
-- to refuse a second code while the first is still good, and on every
-- confirmation.
create index if not exists admin_invites_email
  on admin_invites (email, created_at desc);

-- The pending list the dashboard shows.
create index if not exists admin_invites_open
  on admin_invites (created_at desc) where accepted_at is null;


-- ============================================================
-- Check it worked
-- ============================================================
--
--   select i.email, i.created_at, i.expires_at, i.accepted_at,
--          i.attempts, inviter.name as invited_by, i.reason
--     from admin_invites i
--     left join profiles inviter on inviter.id = i.invited_by
--    order by i.created_at desc;
--
-- Clearing out invitations nobody ever confirmed, if the table grows:
--
--   delete from admin_invites
--    where accepted_at is null and expires_at < now() - interval '30 days';
