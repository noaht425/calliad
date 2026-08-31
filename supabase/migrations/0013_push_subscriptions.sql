-- Web-push subscriptions — one row per device/browser. The app only ever touches
-- this via the service_role admin client (subscribe route + sendPush), so it
-- needs the same explicit grants the other tables carry. (The old
-- _donor-push-schema.sql was never applied and omitted the grants, which is why
-- every /api/push/subscribe POST 404'd and no notifications ever sent.)

create table if not exists push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references auth.users not null,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_push_subscriptions_user on push_subscriptions (user_id);

alter table push_subscriptions enable row level security;
grant select, insert, update, delete on push_subscriptions to service_role;
