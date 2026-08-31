-- Contacts, synced from iCloud (CardDAV, same Apple ID as the calendar). The
-- vCard fields are refreshed on every sync; `relationship` / `relationship_note`
-- are Calliad-owned (set via chat confirm-then-edit or Settings) and preserved.

create table contacts (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid references auth.users not null,
  uid               text not null,             -- vCard UID
  name              text not null,
  first_name        text,
  last_name         text,
  emails            text[] not null default '{}',
  phones            text[] not null default '{}',
  org               text,
  birthday          text,                       -- MM-DD or YYYY-MM-DD
  groups            text[] not null default '{}',
  note              text,
  relationship      text check (relationship in ('family','friend','colleague','acquaintance')),
  relationship_note text,                       -- "niece", "college roommate", "manager"
  source            text not null default 'icloud',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (user_id, uid)
);
create index idx_contacts_user_name on contacts (user_id, lower(name));
alter table contacts enable row level security;
grant select, insert, update, delete on contacts to service_role;
