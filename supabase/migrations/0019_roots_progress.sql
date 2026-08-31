-- Per-root history for the roots quiz: cycle through all roots before repeating,
-- and resurface the ones Noah keeps missing.
create table roots_progress (
  user_id    uuid references auth.users not null,
  root       text not null,
  seen_count integer not null default 0,
  miss_count integer not null default 0,
  last_seen  timestamptz,
  primary key (user_id, root)
);
alter table roots_progress enable row level security;
grant select, insert, update, delete on roots_progress to service_role;
