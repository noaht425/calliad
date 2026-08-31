-- A short-lived changelog of calendar edits (non-recurring events only — a
-- recurring series churns instances every sync and would be noise). The morning
-- brief reads the last ~26h to say "your dentist moved / that flight got added".
create table calendar_changes (
  id      uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  uid     text not null,                       -- base iCal UID (no ::instance suffix)
  title   text,
  kind    text not null check (kind in ('added', 'moved', 'retitled', 'removed')),
  detail  text,
  at      timestamptz not null default now()
);
create index idx_calendar_changes_user_at on calendar_changes (user_id, at desc);
alter table calendar_changes enable row level security;
grant select, insert, update, delete on calendar_changes to service_role;
