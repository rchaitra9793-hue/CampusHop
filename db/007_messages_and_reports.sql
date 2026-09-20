-- CampusHop: talking to each other, and reporting when something is wrong.
--
-- Run this once in the Supabase dashboard: SQL Editor -> New query -> Run.
--
-- Two things a shared ride needs that a phone number does not cover.
--
-- Messages, because "I'm at the second gate, not the first" is the most
-- common thing anyone needs to say, and it should not require handing over
-- a personal number or leaving the app. A thread belongs to one accepted
-- request — the driver and that one rider — so it exists only between two
-- people who are actually travelling together.
--
-- Reports, because the alternative to a way of saying "this went wrong" is
-- someone quietly never using the app again. They are deliberately kept
-- even when the ride or request they refer to is deleted: a report about a
-- trip that has been cleaned up is exactly the one worth still having.

create table if not exists trip_messages (
  id         uuid primary key default gen_random_uuid(),

  -- The thread. One per accepted request, cascading: if the trip itself is
  -- removed there is nobody left who is allowed to read this.
  request_id uuid not null references trip_requests (id) on delete cascade,
  sender_id  uuid not null references profiles (id) on delete cascade,

  body       text not null,
  created_at timestamptz not null default now(),

  -- Set when the *other* person has loaded the thread. Drives the unread
  -- count, nothing more.
  read_at    timestamptz
);

-- Every read is "this thread, in order", which is exactly this index.
create index if not exists trip_messages_thread
  on trip_messages (request_id, created_at);

-- Counting what the other person has not read yet.
create index if not exists trip_messages_unread
  on trip_messages (request_id, sender_id) where read_at is null;

create table if not exists safety_reports (
  id          uuid primary key default gen_random_uuid(),

  -- Null rather than cascade: the trip may be gone, the report stands.
  request_id  uuid references trip_requests (id) on delete set null,
  ride_id     uuid references rides (id) on delete set null,

  reporter_id uuid not null references profiles (id) on delete cascade,

  -- Who it is about. Null is allowed for a report about the trip itself
  -- rather than about a person.
  subject_id  uuid references profiles (id) on delete set null,

  -- Kept as text with a check rather than an enum: adding a category to an
  -- enum needs a migration, and this list will grow.
  category    text not null check (category in (
    'unsafe_driving',
    'no_show',
    'wrong_vehicle',
    'harassment',
    'payment',
    'other'
  )),

  details     text,

  -- open -> reviewing -> resolved | dismissed. Moved by whoever handles
  -- these; the app only ever writes 'open'.
  status      text not null default 'open',

  created_at  timestamptz not null default now()
);

-- "What has been reported about this person" — the question that matters
-- when deciding whether an account should keep driving.
create index if not exists safety_reports_subject
  on safety_reports (subject_id, created_at desc);

-- "What have I reported", for showing someone their own history.
create index if not exists safety_reports_reporter
  on safety_reports (reporter_id, created_at desc);

-- One report per person, per trip, per category. A second click, or a
-- second tab, is not a second incident.
create unique index if not exists safety_reports_one_per_trip
  on safety_reports (reporter_id, request_id, category)
  where request_id is not null;

-- Note on row-level security: like the other tables here, these are
-- reached only through the API, which resolves the caller from a signed
-- token and decides who may read what. Nothing in the browser holds a key
-- that can touch them directly.
--
-- What has been reported, most recent first:
--
--   select r.created_at, r.category, r.status,
--          reporter.name as by, subject.name as about, r.details
--   from safety_reports r
--   left join profiles reporter on reporter.id = r.reporter_id
--   left join profiles subject  on subject.id  = r.subject_id
--   order by r.created_at desc;
