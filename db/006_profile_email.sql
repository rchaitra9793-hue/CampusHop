-- ============================================================
-- 006 — an address to notify people at
-- ============================================================
--
-- Notifications are about reaching the *other* person: the driver who is
-- not looking at the app when a seat is requested, the rider waiting on
-- an answer. The API can read the caller's own email from their token,
-- but never anybody else's — auth.users is not readable without the
-- service-role key, and it should not have to be for this.
--
-- So each profile carries the address its owner signed up with. It is
-- written by the API from the verified token, never from the request
-- body, so nobody can point their notifications at someone else.

alter table profiles
  add column if not exists email text;

-- Used to look up who to write to. Not unique: Supabase Auth already
-- guarantees that, and a stale duplicate here should not block a signup.
create index if not exists profiles_email_idx on profiles (email);
