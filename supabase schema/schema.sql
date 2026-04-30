-- ============================================================
-- MUAD'FILM — Supabase Schema
-- Run this entire file in Supabase SQL Editor
-- ============================================================

create extension if not exists "uuid-ossp";

-- ============================================================
-- PROFILES
-- Auto-created on signup via trigger.
-- Mirrors auth.users but stores app-specific data.
-- ============================================================
create table public.profiles (
  id            uuid references auth.users(id) on delete cascade primary key,
  display_name  text,
  email         text,
  avatar_url    text,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

-- ============================================================
-- TASTE GRAPHS
-- One row per user. Updated continuously by the algorithm.
-- Stored as JSONB so the frontend can read/write the full
-- graph object without schema changes as the algo evolves.
-- ============================================================
create table public.taste_graphs (
  id          uuid default uuid_generate_v4() primary key,
  user_id     uuid references public.profiles(id) on delete cascade unique not null,
  graph       jsonb not null default '{}'::jsonb,
  onboarding_done boolean default false,
  confidence  float default 0.1,
  updated_at  timestamptz default now()
);

-- ============================================================
-- WATCHLIST
-- ============================================================
create table public.watchlist (
  id          uuid default uuid_generate_v4() primary key,
  user_id     uuid references public.profiles(id) on delete cascade not null,
  tmdb_id     integer not null,
  media_type  text not null default 'movie',
  snapshot    jsonb default '{}'::jsonb,  -- poster, title, genre_ids etc
  added_at    timestamptz default now(),
  unique(user_id, tmdb_id)
);

-- ============================================================
-- WATCHED
-- ============================================================
create table public.watched (
  id          uuid default uuid_generate_v4() primary key,
  user_id     uuid references public.profiles(id) on delete cascade not null,
  tmdb_id     integer not null,
  media_type  text not null default 'movie',
  reaction    text check (reaction in ('loved','liked','mid','abandoned')),
  snapshot    jsonb default '{}'::jsonb,
  watched_at  timestamptz default now(),
  unique(user_id, tmdb_id)
);

-- ============================================================
-- FAVOURITES
-- Fixed 3 slots per user.
-- ============================================================
create table public.favourites (
  id          uuid default uuid_generate_v4() primary key,
  user_id     uuid references public.profiles(id) on delete cascade unique not null,
  slot_0      jsonb,  -- film snapshot or null
  slot_1      jsonb,
  slot_2      jsonb,
  updated_at  timestamptz default now()
);

-- ============================================================
-- WATCH EVENTS (signal log)
-- Raw event stream — used by the periodic reinforcement loop
-- and for analytics later.
-- ============================================================
create table public.watch_events (
  id              uuid default uuid_generate_v4() primary key,
  user_id         uuid references public.profiles(id) on delete cascade not null,
  tmdb_id         integer not null,
  media_type      text not null default 'movie',
  event_type      text not null,
  completion_pct  float,
  watch_hour      integer,
  watch_dow       integer,  -- day of week 0-6
  content_meta    jsonb default '{}'::jsonb,
  created_at      timestamptz default now()
);

-- ============================================================
-- INDEXES
-- ============================================================
create index watchlist_user_idx    on public.watchlist(user_id);
create index watched_user_idx      on public.watched(user_id);
create index watch_events_user_idx on public.watch_events(user_id);
create index watch_events_time_idx on public.watch_events(created_at desc);

-- ============================================================
-- ROW LEVEL SECURITY
-- Every table: users can only see and modify their own rows.
-- ============================================================
alter table public.profiles    enable row level security;
alter table public.taste_graphs enable row level security;
alter table public.watchlist   enable row level security;
alter table public.watched     enable row level security;
alter table public.favourites  enable row level security;
alter table public.watch_events enable row level security;

-- profiles
create policy "Own profile" on public.profiles
  for all using (auth.uid() = id);

-- taste_graphs
create policy "Own taste graph" on public.taste_graphs
  for all using (auth.uid() = user_id);

-- watchlist
create policy "Own watchlist" on public.watchlist
  for all using (auth.uid() = user_id);

-- watched
create policy "Own watched" on public.watched
  for all using (auth.uid() = user_id);

-- favourites
create policy "Own favourites" on public.favourites
  for all using (auth.uid() = user_id);

-- watch_events
create policy "Own watch events" on public.watch_events
  for all using (auth.uid() = user_id);

-- ============================================================
-- AUTO-UPDATE updated_at
-- ============================================================
create or replace function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.handle_updated_at();

create trigger taste_graphs_updated_at
  before update on public.taste_graphs
  for each row execute function public.handle_updated_at();

create trigger favourites_updated_at
  before update on public.favourites
  for each row execute function public.handle_updated_at();

-- ============================================================
-- AUTO-CREATE profile + taste_graph + favourites ON SIGNUP
-- Fires after a new row is inserted into auth.users
-- ============================================================
create or replace function public.handle_new_user()
returns trigger as $$
begin
  -- Create profile
  insert into public.profiles (id, display_name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'displayName', split_part(new.email, '@', 1)),
    new.email
  );

  -- Create empty taste graph
  insert into public.taste_graphs (user_id, graph, onboarding_done)
  values (new.id, '{}'::jsonb, false);

  -- Create empty favourites row
  insert into public.favourites (user_id)
  values (new.id);

  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

