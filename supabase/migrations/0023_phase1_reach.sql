-- Phase 1 — Reach & heartbeat.
-- (1) telegram_links: maps a Telegram chat to the app user (single-user for now).
-- (2) notifications: the outbound delivery queue the tick worker drains, so
--     proactive messages survive quiet hours instead of being dropped.

create table telegram_links (
  user_id    uuid primary key references auth.users not null,
  chat_id    bigint not null unique,
  username   text,
  linked_at  timestamptz not null default now()
);
alter table telegram_links enable row level security;
grant select, insert, update, delete on telegram_links to service_role;

create table notifications (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references auth.users not null,
  kind          text not null,                       -- 'nudge' | 'watcher' | 'trip' | 'med' | …
  title         text not null,
  body          text not null,
  url           text,
  dedupe_key    text,                                -- skip if an unsent row already has this
  channels      text[] not null default '{telegram,push}',
  status        text not null default 'queued' check (status in ('queued', 'sent', 'held', 'failed')),
  scheduled_for timestamptz not null default now(),  -- held items get pushed to 07:00 local
  attempts      smallint not null default 0,
  sent_at       timestamptz,
  meta          jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);
create index idx_notifications_pending on notifications (scheduled_for) where status in ('queued', 'held');
create index idx_notifications_dedupe on notifications (user_id, dedupe_key) where status in ('queued', 'held');
alter table notifications enable row level security;
grant select, insert, update, delete on notifications to service_role;
