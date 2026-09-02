-- Phase 2 — Watchers. A generic "check this on a schedule, ping me when it
-- changes" framework. The tick worker (/api/cron/tick) runs the due ones and
-- enqueues a notification on a meaningful change.
--
-- kind:  'page'          — a web page; spec {url, for?}, last_state {hash,len}
--        'weather_event' — rain/snow over a calendar event; spec {days},
--                          last_state {notified:{<eventKey>:date}}
--        (later: 'flight', 'package', 'price')

create table watchers (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid references auth.users not null,
  kind            text not null,
  label           text not null,                       -- human-readable, used in lists + nudges
  spec            jsonb not null default '{}'::jsonb,  -- kind-specific config
  last_state      jsonb,                               -- last observation, for change detection
  status          text not null default 'active' check (status in ('active', 'paused', 'done')),
  interval_min    integer not null default 60,
  next_check_at   timestamptz not null default now(),
  last_checked_at timestamptz,
  last_change_at  timestamptz,
  created_at      timestamptz not null default now()
);
create index idx_watchers_due on watchers (next_check_at) where status = 'active';
create index idx_watchers_user on watchers (user_id, status);
alter table watchers enable row level security;
grant select, insert, update, delete on watchers to service_role;
