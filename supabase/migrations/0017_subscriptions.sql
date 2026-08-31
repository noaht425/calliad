-- Recurring charges Noah tells Calliad about ("I pay $12/mo for Spotify"). Feeds
-- a monthly-total view + "renews soon" lines in the brief.
create table subscriptions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references auth.users not null,
  name         text not null,
  amount_cents integer not null,
  currency     text not null default 'USD',
  cadence      text not null check (cadence in ('weekly', 'monthly', 'quarterly', 'yearly')),
  next_charge  date,
  category     text,
  source       text not null default 'chat',
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index idx_subscriptions_user_name on subscriptions (user_id, lower(name));
create index idx_subscriptions_user on subscriptions (user_id, active, next_charge);
alter table subscriptions enable row level security;
grant select, insert, update, delete on subscriptions to service_role;
