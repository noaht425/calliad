-- Phase 3 — Location. iOS Shortcuts "personal automations" (arrive at / leave a
-- place) POST here; the only background-geofence path a web app gets on iOS.
-- Rules in lib/location/rules.ts react immediately; the brain gets a
-- "where Noah is" line for context.

create table location_events (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references auth.users not null,
  place      text not null,                       -- name as sent ('home', 'work', 'pharmacy', …)
  event      text not null check (event in ('arrive', 'leave')),
  lat        double precision,
  lon        double precision,
  at         timestamptz not null default now(),
  handled    boolean not null default false,      -- rules evaluated
  created_at timestamptz not null default now()
);
create index idx_location_events_user_at on location_events (user_id, at desc);
alter table location_events enable row level security;
grant select, insert, update, delete on location_events to service_role;
