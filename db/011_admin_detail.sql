-- ============================================================
-- 011 — the decision, on the report it was about
-- ============================================================
--
-- Run this once in the Supabase dashboard: SQL Editor -> New query -> Run.
--
-- 009 gave administrators a way to move a report along and wrote every
-- move to admin_actions. That is the right place for "who did what, and
-- when", and the wrong place for "what was decided about this report":
-- answering the second question meant scanning an audit log for rows whose
-- target happened to be this report and reading the outcome out of a note
-- that also contained the reason.
--
-- So the decision lives on the report now. The audit row still gets
-- written — it is the history, and nothing rewrites history — but the
-- current state of a report is readable from the report.
--
-- What this adds:
--
--   safety_reports.resolution   what was decided, in words
--   safety_reports.resolved_at  when it stopped being open
--   safety_reports.resolved_by  which administrator decided
--   safety_reports_queue        the index the queue is actually read by


alter table safety_reports
  add column if not exists resolution text;

alter table safety_reports
  add column if not exists resolved_at timestamptz;

-- No cascade: if an administrator's own profile is removed, the decision
-- they made still stands and still has an author.
alter table safety_reports
  add column if not exists resolved_by uuid references profiles (id) on delete set null;


-- The queue is read as "the open ones, oldest first" on every visit to
-- the dashboard, and that read had no index behind it at all — 007 built
-- one for "reports about this person" and one for "reports I filed",
-- which are the other two questions.
create index if not exists safety_reports_queue
  on safety_reports (status, created_at);


-- ============================================================
-- Rides, for the admin board
-- ============================================================
--
-- Administration needs to list rides by driver and by recency, which is
-- not what the board reads them by. The board asks "what has not left
-- yet", ordered by departure; the dashboard asks "what has this person
-- posted", newest first.

create index if not exists rides_driver_recent
  on rides (driver_id, created_at desc);


-- ============================================================
-- Check it worked
-- ============================================================
--
--   select r.created_at, r.category, r.status, r.resolution,
--          r.resolved_at, decider.name as decided_by
--     from safety_reports r
--     left join profiles decider on decider.id = r.resolved_by
--    order by r.created_at desc;
