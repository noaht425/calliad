-- Run this in the Supabase SQL editor (Project → SQL Editor → New query)

-- Push subscriptions — one row per user/device/browser combination
create table push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

alter table push_subscriptions enable row level security;
create policy "Users access own push subscriptions" on push_subscriptions
  for all using (auth.uid() = user_id);
