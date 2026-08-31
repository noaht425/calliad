-- Phase 1 — frictionless capture (pattern K + M). Send a link → filed with a
-- NEUTRAL descriptor (subject + scope, never the thesis/conclusion).
create table list_items (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references auth.users not null,
  kind       text not null default 'reading',   -- 'reading' | 'watch' | 'link'
  title      text,
  url        text not null,
  descriptor text,                               -- one neutral sentence
  site       text,                               -- e.g. "The Atlantic", "YouTube"
  source     text not null default 'chat',       -- 'chat' | 'share'
  status     text not null default 'unread' check (status in ('unread','done','archived')),
  created_at timestamptz not null default now(),
  unique (user_id, url)
);
create index idx_list_items_user_kind on list_items (user_id, kind, status, created_at desc);
alter table list_items enable row level security;
grant select, insert, update, delete on list_items to service_role;
