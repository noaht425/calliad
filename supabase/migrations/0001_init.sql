-- Calliad hub — Phase 0 schema (draft, 2026-08-30)
-- Source of design: specs/hub-skeleton.md §3. Target: Supabase Postgres.
-- Drops into supabase/migrations/0001_init.sql of the fork.
--
-- Access model: all reads/writes go through server routes using the Supabase
-- service_role client (adminClient), same as Doug's app. RLS is ENABLED with no
-- anon/authenticated policies (deny by default); service_role is granted directly.
-- Multi-user (principle 10) is a later migration that adds user_id columns +
-- per-user RLS; Phase 0 is single-tenant (Noah).

-- ─────────────────────────────────────────────────────────────────────────────
-- config — runtime flags + spend counters. One row per key.
-- ─────────────────────────────────────────────────────────────────────────────
create table config (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);
alter table config enable row level security;
grant select, insert, update, delete on config to service_role;

-- Seed (also do this from code on first boot so a fresh DB self-heals):
insert into config (key, value) values
  ('killswitch_level',        'off'),
  ('spend_cap_usd_month',     '10'),
  ('spend_month',             to_char(now(), 'YYYY-MM')),
  ('spend_month_to_date_usd', '0')
on conflict (key) do nothing;

-- ─────────────────────────────────────────────────────────────────────────────
-- conversations / messages — chat threads + history
-- ─────────────────────────────────────────────────────────────────────────────
create table conversations (
  id         uuid primary key default gen_random_uuid(),
  surface    text not null,                 -- 'pwa' | 'cron' | 'webhook'
  started_at timestamptz not null default now(),
  last_at    timestamptz not null default now(),
  title      text
);
alter table conversations enable row level security;
grant select, insert, update, delete on conversations to service_role;

create table messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  role            text not null,            -- 'user' | 'assistant' | 'system'
  content         text not null,
  created_at      timestamptz not null default now()
);
create index idx_messages_conv on messages (conversation_id, created_at);
alter table messages enable row level security;
grant select, insert, update, delete on messages to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- audit_log — append-only. No UPDATE, no DELETE, ever. (Enforced by convention +
-- the revoke below; only INSERT/SELECT are granted.)
-- ─────────────────────────────────────────────────────────────────────────────
create table audit_log (
  id      bigint generated always as identity primary key,
  ts      timestamptz not null default now(),
  kind    text not null,   -- inbound_message | trigger_fired | route_decision |
                            -- model_call | tool_call | action_proposed |
                            -- action_decided | action_executed | outbound_message |
                            -- spend_cap | killswitch | error
  actor   text not null,   -- 'noah' | 'calliad' | 'system' | 'cron'
  ref     text,            -- conversation id / action id / job name
  payload jsonb not null
);
create index idx_audit_ts   on audit_log (ts);
create index idx_audit_kind on audit_log (kind, ts);
alter table audit_log enable row level security;
grant select, insert on audit_log to service_role;   -- deliberately no update/delete

-- ─────────────────────────────────────────────────────────────────────────────
-- model_calls — denormalized cost rows for easy summing (also present as an
-- audit_log 'model_call' entry).
-- ─────────────────────────────────────────────────────────────────────────────
create table model_calls (
  id                bigint generated always as identity primary key,
  ts                timestamptz not null default now(),
  conversation_id   uuid references conversations(id) on delete set null,
  purpose           text not null,   -- 'chat' | 'brief' | 'extract' | 'route' | ...
  tier              text not null,   -- 'T1' | 'T2' | 'T3'
  model             text not null,
  input_tokens      integer not null,
  cached_read_tokens integer not null default 0,
  cache_write_tokens integer not null default 0,
  output_tokens     integer not null,
  cost_usd          numeric(10,6) not null,
  latency_ms        integer
);
create index idx_model_calls_ts on model_calls (ts);
alter table model_calls enable row level security;
grant select, insert on model_calls to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- actions — pending world-changing actions. SCHEMA ONLY in Phase 0 (unused).
-- ─────────────────────────────────────────────────────────────────────────────
create table actions (
  id          uuid primary key default gen_random_uuid(),
  ts          timestamptz not null default now(),
  kind        text not null,   -- 'send_email' | 'create_event' | 'book' | 'merge_pr' | ...
  summary     text not null,   -- human-readable, shown to Noah for approval
  risk_tier   text not null,   -- 'silent' | 'confirm' | 'named_consequence'
  status      text not null default 'pending', -- pending|approved|rejected|done|failed
  payload     jsonb not null,
  created_by  text not null,   -- conversation id or job name
  decided_at  timestamptz,
  executed_at timestamptz,
  result      text
);
create index idx_actions_status on actions (status, ts);
alter table actions enable row level security;
grant select, insert, update on actions to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 1+ (NOT created here): profile_facts, open_loops, people,
-- people_observations, taste_log — plus pgvector embeddings on a retrieval table.
-- ─────────────────────────────────────────────────────────────────────────────
