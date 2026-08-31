-- Apple Reminders (iCloud CalDAV VTODO) mirrored locally, same pattern as
-- calendar_events: a sync job pulls, the brain/brief read the table.
-- Design: PLAN.md §8 (decision #3 spike), specs/phase-4.md.

create table reminders (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references auth.users not null,
  uid        text not null,                 -- iCal UID
  url        text,                          -- CalDAV object href (for completion writes)
  list_name  text,
  title      text not null,
  due_at     timestamptz,                   -- null = no due date
  completed  boolean not null default false,
  priority   int,                           -- iCal 1 (high) – 9 (low), null = none
  notes      text,
  source     text not null default 'icloud',-- icloud | calliad
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, uid)
);
create index idx_reminders_user_open on reminders (user_id, completed, due_at);
alter table reminders enable row level security;
grant select, insert, update, delete on reminders to service_role;
