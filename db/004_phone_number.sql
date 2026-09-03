-- CampusHop: a number to ring when someone is standing at the wrong gate.
--
-- Run this once in the Supabase dashboard: SQL Editor -> New query -> Run.
--
-- Numbers are only ever shown between a driver and a rider whose request
-- has been accepted. Browsing the board never reveals one — the API
-- decides that, not the client.

alter table profiles
  add column if not exists phone text;

-- Accounts created before this column existed have no number on file.
-- The app prompts them for one; this lists who is still missing it.
--
--   select id, name from profiles where phone is null or phone = '';
