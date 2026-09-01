-- Trip intelligence (email-parsed itineraries + gap cards) and the unsubscribe
-- tracker. Both consume email_items via targeted Gmail queries.

alter table trips add column if not exists travelers text[] not null default '{}';
alter table email_items add column if not exists travel_checked boolean not null default false;

create table trip_items (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid references auth.users not null,
  trip_id             uuid references trips(id) on delete cascade not null,
  kind                text not null check (kind in ('flight', 'hotel', 'car', 'train', 'activity')),
  title               text not null,
  start_at            timestamptz,
  end_at              timestamptz,
  location            text,
  confirmation_number text,
  detail              jsonb not null default '{}'::jsonb,
  source_email_id     uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index idx_trip_items_trip on trip_items (trip_id, start_at);
create unique index idx_trip_items_dedupe on trip_items (trip_id, kind, coalesce(confirmation_number, ''), coalesce(title, ''));
alter table trip_items enable row level security;
grant select, insert, update, delete on trip_items to service_role;

create table trip_sources (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references auth.users not null,
  trip_id       uuid references trips(id) on delete cascade not null,
  email_item_id uuid,
  subject       text,
  received_at   timestamptz,
  created_at    timestamptz not null default now(),
  unique (trip_id, email_item_id)
);
alter table trip_sources enable row level security;
grant select, insert, update, delete on trip_sources to service_role;

create table curation_cards (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid references auth.users not null,
  kind            text not null,                -- 'trip_gap'
  subject         text not null,               -- the question shown to Noah
  trip_id         uuid references trips(id) on delete cascade,
  options         text[] not null default '{}',
  executor        text,                         -- 'check_gmail'
  executor_params jsonb not null default '{}'::jsonb,
  anomaly_key     text not null,                -- de-dupe: one open card per anomaly
  status          text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  created_at      timestamptz not null default now()
);
create unique index idx_curation_open on curation_cards (user_id, anomaly_key) where status = 'open';
alter table curation_cards enable row level security;
grant select, insert, update, delete on curation_cards to service_role;

create table unsubscribes (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid references auth.users not null,
  sender_name      text not null,
  sender_domain    text not null,
  unsubscribed_at  date not null default current_date,
  last_marketing_at date,
  watch_days       integer not null default 10,
  status           text not null default 'pending' check (status in ('pending', 'confirmed', 'still_coming')),
  source           text not null default 'email',
  created_at       timestamptz not null default now(),
  unique (user_id, sender_domain)
);
create index idx_unsubscribes_user on unsubscribes (user_id, status);
alter table unsubscribes enable row level security;
grant select, insert, update, delete on unsubscribes to service_role;
