-- Daily medication check-in. Noah takes a daily med and never ticks the Apple
-- Reminders checkbox, so Calliad does an active check-in instead (persona +
-- profile). One row per day: was it asked, was it confirmed taken.

create table med_log (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references auth.users not null,
  day          date not null,
  sent_count   int not null default 0,        -- check-ins pushed today (cap ~2)
  last_sent_at timestamptz,
  taken        boolean not null default false,
  taken_at     timestamptz,
  note         text,                          -- e.g. "not yet", "forgot"
  updated_at   timestamptz not null default now(),
  unique (user_id, day)
);
create index idx_med_log_user_day on med_log (user_id, day desc);
alter table med_log enable row level security;
grant select, insert, update, delete on med_log to service_role;
