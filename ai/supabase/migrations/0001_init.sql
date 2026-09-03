-- Samurai Meet AI service — initial schema.
-- Apply with the Supabase SQL editor or `supabase db push`.
--
-- Scope: AI-adjacent data only. The Go backend keeps its own authoritative
-- users / chat tables. `users.external_id` is the join key for later.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
create table if not exists users (
  id           uuid primary key default gen_random_uuid(),
  external_id  text unique,                       -- Go backend user id
  display_name text,
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
create table if not exists requests (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid references users(id) on delete set null,
  activity         text not null,                 -- "What would you like to do?"
  where_text       text,                          -- "Where"
  category         text check (category in ('Food','Places','Activity','Other')),
  keywords         text[] not null default '{}',
  location_name    text,
  location_source  text check (location_source in ('poi','station','neighborhood','ward')),
  moderation_level text not null default 'none'
                   check (moderation_level in ('none','low','high')),
  created_at       timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
create table if not exists messages (
  id               uuid primary key default gen_random_uuid(),
  request_id       uuid references requests(id) on delete cascade,
  sender_user_id   uuid references users(id) on delete set null,
  body             text not null,
  moderation_level text not null default 'none'
                   check (moderation_level in ('none','low','high')),
  created_at       timestamptz not null default now()
);
create index if not exists messages_request_idx on messages (request_id, created_at);

-- ---------------------------------------------------------------------------
create table if not exists translations (
  id              uuid primary key default gen_random_uuid(),
  message_id      uuid not null references messages(id) on delete cascade,
  target_language text not null check (target_language in ('ja','en')),
  source_language text,
  translated_text text not null,
  created_at      timestamptz not null default now(),
  unique (message_id, target_language)
);

-- ---------------------------------------------------------------------------
create table if not exists monster_images (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references users(id) on delete cascade,
  image_url      text not null,
  seed_hash      text not null,
  prompt_version text not null default 'v1',
  regen_count    int  not null default 0,
  created_at     timestamptz not null default now()
);
create index if not exists monster_images_user_idx on monster_images (user_id, created_at desc);
create index if not exists monster_images_seed_idx on monster_images (user_id, seed_hash);

-- ---------------------------------------------------------------------------
-- RLS: on, with NO policies. While there is no end-user auth, only the
-- service-role key (used by the Next.js route handlers) may read/write. Add
-- per-user policies when Supabase Auth / Go JWS verification lands.
alter table users          enable row level security;
alter table requests       enable row level security;
alter table messages       enable row level security;
alter table translations   enable row level security;
alter table monster_images enable row level security;

-- ---------------------------------------------------------------------------
-- Storage: create a public-read bucket named `monsters` for generated images.
-- Run once (bucket creation is not transactional DDL):
--   insert into storage.buckets (id, name, public) values ('monsters','monsters', true)
--   on conflict (id) do nothing;
