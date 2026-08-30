-- Phase 1 — read-only integrations: Gmail (one label) + iCloud calendar (CalDAV).
-- Design: specs/reconciliation.md §2, PLAN.md §9. All access via the service_role
-- client from server routes; RLS enabled with no anon/authenticated policies.

-- ─────────────────────────────────────────────────────────────────────────────
-- connected_services — one row per user×external service, secrets + config.
-- gmail: access_token/refresh_token + metadata.email/label/last_scanned_at
-- icloud_calendar: access_token = app-specific password; metadata.apple_id /
--   calendar_url / calendar_name / last_synced_at
-- ─────────────────────────────────────────────────────────────────────────────
create table connected_services (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid references auth.users not null,
  service          text not null,                -- 'gmail' | 'icloud_calendar'
  access_token     text,
  refresh_token    text,
  token_expires_at timestamptz,
  metadata         jsonb not null default '{}',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (user_id, service)
);
alter table connected_services enable row level security;
grant select, insert, update, delete on connected_services to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- calendar_events — synced from iCloud CalDAV (7 days back → 365 forward).
-- ─────────────────────────────────────────────────────────────────────────────
create table calendar_events (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references auth.users not null,
  uid           text not null,                   -- iCal UID
  calendar_url  text,
  calendar_name text,
  title         text,
  start_at      timestamptz,
  end_at        timestamptz,
  all_day       boolean not null default false,
  location      text,
  description   text,
  raw_ical      text,
  source        text not null default 'icloud',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (user_id, uid)
);
create index idx_calendar_events_user_start on calendar_events (user_id, start_at);
alter table calendar_events enable row level security;
grant select, insert, update, delete on calendar_events to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- email_items — messages pulled from the watched Gmail label. Lean: enough to
-- reason over in the brief, not a full mail store.
-- ─────────────────────────────────────────────────────────────────────────────
create table email_items (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid references auth.users not null,
  gmail_message_id text not null,
  gmail_thread_id  text,
  label            text,
  from_addr        text,
  subject          text,
  snippet          text,
  body_text        text,
  received_at      timestamptz,
  created_at       timestamptz not null default now(),
  unique (user_id, gmail_message_id)
);
create index idx_email_items_user_received on email_items (user_id, received_at desc);
alter table email_items enable row level security;
grant select, insert, update, delete on email_items to service_role;
