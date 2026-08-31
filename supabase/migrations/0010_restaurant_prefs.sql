-- Restaurant preferences, seeded from Beli screenshots (vision extract) and
-- chat. Feeds the restaurant hand-off tool + profile. Beli has no API, so the
-- flow is: Noah shares screenshots → extract → upsert here.

create table restaurant_prefs (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references auth.users not null,
  name       text not null,
  city       text,                       -- city or neighbourhood if shown
  score      numeric(3,1),               -- Beli score 0.0–10.0 (null = want-to-try)
  category   text,                       -- cuisine / type
  note       text,
  status     text not null default 'ranked' check (status in ('ranked','want')),
  source     text not null default 'beli',
  dedupe_key text not null,              -- lower(name)|lower(city)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, dedupe_key)
);
create index idx_restaurant_prefs_user on restaurant_prefs (user_id, status, score desc nulls last);
alter table restaurant_prefs enable row level security;
grant select, insert, update, delete on restaurant_prefs to service_role;
