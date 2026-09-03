-- CampusHop: record the vehicle a driver actually turns up in.
--
-- Run this once in the Supabase dashboard: SQL Editor -> New query -> Run.
--
-- A rider standing on a kerb needs to know which car is theirs. The
-- profile already said "car"; it never said which one.

alter table profiles
  add column if not exists vehicle_number text;

-- Drivers who signed up before this column existed have no number on
-- file. This lists them, if you want to prompt them to add one.
--
--   select id, name, vehicle
--   from profiles
--   where vehicle is not null
--     and vehicle <> 'none'
--     and (vehicle_number is null or vehicle_number = '');
