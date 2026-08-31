-- Lightweight trip records so Calliad can fire time-boxed prep nudges (IDP,
-- mail holds, notify the bank, airport transport, pet boarding …) as a
-- departure approaches. Flights themselves still come from the iCloud calendar;
-- this is just the anchor + per-task "already nudged" state.

create table trips (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references auth.users not null,
  destination  text not null,
  start_date   date not null,
  end_date     date,
  home_airport text,                       -- e.g. SEA — enables airport-transport advice
  has_pet      boolean not null default false,
  notes        text,
  status       text not null default 'planned' check (status in ('planned', 'active', 'done', 'cancelled')),
  prep_state   jsonb not null default '{}'::jsonb,   -- { taskKey: 'sent' } so each nudge fires once
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index idx_trips_user on trips (user_id, status, start_date);
alter table trips enable row level security;
grant select, insert, update, delete on trips to service_role;
