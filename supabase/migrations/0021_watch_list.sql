-- Watch list: TV shows / films with TMDB metadata, per-season progress, rating.
-- Separate from taste_log (the "would I like X" corpus) but a rating here can
-- also drop a verdict there.
create table watch_list (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references auth.users not null,
  tmdb_id       integer,
  media_type    text not null check (media_type in ('tv', 'movie')),
  title         text not null,
  year          integer,
  poster_path   text,
  overview      text,
  cast_names    text[] not null default '{}',
  streaming     text[] not null default '{}',      -- US flatrate provider names
  status        text not null default 'watching' check (status in ('watching', 'want', 'done')),
  rating        smallint check (rating between 1 and 5),
  air_status    text,                              -- 'Ended' | 'Returning Series' | 'Released' …
  next_air_date date,
  total_seasons integer,
  seasons       jsonb not null default '[]'::jsonb, -- [{season:int, episodes:int, state:'pending'|'watching'|'watched'}]
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (user_id, tmdb_id, media_type)
);
create index idx_watch_list_user on watch_list (user_id, status, updated_at desc);
alter table watch_list enable row level security;
grant select, insert, update, delete on watch_list to service_role;
