-- CampusHop social layer: ride vibes, campus wall and course identity.
alter table profiles add column if not exists course text;
alter table rides add column if not exists vibe text;

create table if not exists campus_wall_posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references profiles(id) on delete cascade,
  body text not null check (char_length(trim(body)) between 1 and 280),
  created_at timestamptz not null default now()
);
create index if not exists campus_wall_recent on campus_wall_posts(created_at desc);

-- Make the new table/columns visible to PostgREST immediately after this
-- migration is run from the Supabase SQL editor.
notify pgrst, 'reload schema';
