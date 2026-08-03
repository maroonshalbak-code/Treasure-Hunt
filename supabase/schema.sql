-- ============================================================
-- Treasure Hunt App — Supabase Schema
-- Run this in: Supabase Dashboard > SQL Editor > New query
-- ============================================================

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- ============================================================
-- TABLES
-- ============================================================

-- Player profiles (linked to auth.users)
create table public.profiles (
  id uuid references auth.users on delete cascade primary key,
  username text unique not null,
  avatar_url text,
  is_admin boolean default false,
  created_at timestamptz default now()
);

-- Treasure hunts
create table public.hunts (
  id uuid primary key default uuid_generate_v4(),
  title text not null,
  description text,
  cover_image_url text,
  created_by uuid references public.profiles(id) on delete set null,
  is_active boolean default true,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz default now()
);

-- Clues (all visible at once — open world)
create table public.clues (
  id uuid primary key default uuid_generate_v4(),
  hunt_id uuid references public.hunts(id) on delete cascade not null,
  title text not null,
  riddle text not null,               -- The text hint / riddle
  clue_type text not null check (clue_type in ('text', 'gps', 'photo', 'qr')),
  -- For text type: correct answer (lowercased for comparison)
  answer text,
  -- For GPS type: target coordinates + tolerance in meters
  lat double precision,
  lng double precision,
  gps_radius_meters int default 50,
  -- For QR type: secret token embedded in QR code
  qr_token text default uuid_generate_v4()::text,
  -- Ordering hint (display order in open world)
  display_order int default 0,
  points int default 10,
  created_at timestamptz default now()
);

-- Player progress per clue
create table public.player_progress (
  id uuid primary key default uuid_generate_v4(),
  player_id uuid references public.profiles(id) on delete cascade not null,
  hunt_id uuid references public.hunts(id) on delete cascade not null,
  clue_id uuid references public.clues(id) on delete cascade not null,
  photo_url text,                     -- For photo-type clues
  completed_at timestamptz default now(),
  unique(player_id, clue_id)          -- Can only complete a clue once
);

-- ============================================================
-- INDEXES
-- ============================================================
create index on public.clues(hunt_id);
create index on public.player_progress(player_id, hunt_id);
create index on public.player_progress(clue_id);

-- ============================================================
-- STORAGE BUCKET (for photo proof uploads)
-- ============================================================
-- Run this separately or via Supabase Storage UI:
-- Create a bucket named "clue-photos" with public access OFF

insert into storage.buckets (id, name, public)
values ('clue-photos', 'clue-photos', false)
on conflict do nothing;

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table public.profiles enable row level security;
alter table public.hunts enable row level security;
alter table public.clues enable row level security;
alter table public.player_progress enable row level security;

-- Profiles: users can read all, only update their own
create policy "Profiles are viewable by everyone" on public.profiles
  for select using (true);

create policy "Users can insert their own profile" on public.profiles
  for insert with check (auth.uid() = id);

create policy "Users can update their own profile" on public.profiles
  for update using (auth.uid() = id);

-- Hunts: everyone can read active hunts; only admins can write
create policy "Anyone can view active hunts" on public.hunts
  for select using (is_active = true);

create policy "Admins can manage hunts" on public.hunts
  for all using (
    exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
  );

-- Clues: everyone can read clues for active hunts
create policy "Anyone can view clues" on public.clues
  for select using (
    exists (select 1 from public.hunts where id = hunt_id and is_active = true)
  );

create policy "Admins can manage clues" on public.clues
  for all using (
    exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
  );

-- Player progress: players see all progress (for leaderboard), insert/update own
create policy "Progress is public for leaderboard" on public.player_progress
  for select using (true);

create policy "Players can insert their own progress" on public.player_progress
  for insert with check (auth.uid() = player_id);

-- Storage: authenticated users can upload to clue-photos
create policy "Authenticated users can upload photos" on storage.objects
  for insert with check (bucket_id = 'clue-photos' and auth.role() = 'authenticated');

create policy "Anyone can view clue photos" on storage.objects
  for select using (bucket_id = 'clue-photos');

-- ============================================================
-- TRIGGER: Auto-create profile on signup
-- ============================================================
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, username)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1))
  );
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ============================================================
-- LEADERBOARD VIEW (optional helper)
-- ============================================================
create or replace view public.leaderboard as
select
  p.id as player_id,
  p.username,
  p.avatar_url,
  pp.hunt_id,
  count(pp.id) as clues_found,
  sum(c.points) as total_points,
  max(pp.completed_at) as last_found_at
from public.profiles p
join public.player_progress pp on pp.player_id = p.id
join public.clues c on c.id = pp.clue_id
group by p.id, p.username, p.avatar_url, pp.hunt_id
order by total_points desc, last_found_at asc;
