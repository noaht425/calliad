-- Run this in Supabase SQL Editor after schema.sql

-- User profile — personal context injected into every AI call
create table user_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null unique,
  full_name text,
  home_city text,
  home_airport text,           -- IATA code, e.g. 'SEA'
  timezone text not null default 'America/Los_Angeles',
  preferred_airlines text[] not null default '{}',
  preferred_hotel_chains text[] not null default '{}',
  preferred_car_rental text[] not null default '{}',
  dietary_preferences text[] not null default '{}',
  frequent_cities text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table user_profiles enable row level security;
create policy "Users access own profile" on user_profiles
  for all using (auth.uid() = user_id);
grant select, insert, update, delete on public.user_profiles to service_role;

create trigger user_profiles_updated_at
  before update on user_profiles
  for each row execute function update_updated_at();

-- Family members — who matters to you and how
create table family_members (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  name text not null,
  relationship text not null,  -- 'spouse', 'child', 'parent', 'sibling', 'friend'
  email text,
  location_city text,
  birthday date,
  anniversary date,            -- wedding anniversary if spouse, etc.
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table family_members enable row level security;
create policy "Users access own family members" on family_members
  for all using (auth.uid() = user_id);
grant select, insert, update, delete on public.family_members to service_role;

create trigger family_members_updated_at
  before update on family_members
  for each row execute function update_updated_at();

-- Connected third-party services (Amazon/Alexa, Google, etc.)
create table connected_services (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  service text not null,               -- 'amazon', 'google'
  access_token text not null,
  refresh_token text,
  token_expires_at timestamptz,
  service_user_id text,                -- Amazon user ID for reference
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, service)
);

alter table connected_services enable row level security;
create policy "Users access own connected services" on connected_services
  for all using (auth.uid() = user_id);
grant select, insert, update, delete on public.connected_services to service_role;

create trigger connected_services_updated_at
  before update on connected_services
  for each row execute function update_updated_at();
