-- Phase 1 — working memory. Design: PLAN.md §7, specs/system-prompt-assembly.md §4-5.
-- Service-role access from server routes; RLS on, no anon/authenticated policies.

-- ─────────────────────────────────────────────────────────────────────────────
-- open_loops — working state. "Latin midterm 10/16: indirect statement ✗".
-- "SF trip 9/12–15: flight ✓, hotel ✗." Written by chat/ingestion/triggers,
-- read by the brief, chat context, and (later) the nudge engine.
-- ─────────────────────────────────────────────────────────────────────────────
create table open_loops (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references auth.users not null,
  title      text not null,          -- short handle, used for dedupe
  body       text,                   -- detail / checklist / notes
  due_at     timestamptz,            -- null = no deadline
  status     text not null default 'open' check (status in ('open','done','dropped')),
  tags       text[] not null default '{}',
  source     text not null default 'chat',  -- chat | syllabus | trigger | manual
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_open_loops_user_status on open_loops (user_id, status, due_at);
alter table open_loops enable row level security;
grant select, insert, update, delete on open_loops to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- profile_facts — structured, confirmable facts about Noah. profile.md stays the
-- human-authoritative source; this is the propose→confirm layer + the slice input.
-- ─────────────────────────────────────────────────────────────────────────────
create table profile_facts (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references auth.users not null,
  section    text not null,          -- 'academics' | 'travel' | 'people' | ...
  key        text not null,
  value      text not null,
  source     text not null default 'chat',   -- chat | manual | import
  confirmed  boolean not null default false, -- Noah confirmed a proposed fact
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, section, key)
);
create index idx_profile_facts_user_section on profile_facts (user_id, section);
alter table profile_facts enable row level security;
grant select, insert, update, delete on profile_facts to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- taste_log — longitudinal reactions to books/shows/films → "would I like X?"
-- ─────────────────────────────────────────────────────────────────────────────
create table taste_log (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references auth.users not null,
  title      text not null,
  kind       text not null,          -- 'book' | 'show' | 'film' | 'game' | 'music' | ...
  verdict    text,                   -- 'loved' | 'liked' | 'ok' | 'disliked' | 'bailed'
  why        text,
  dated      date,                   -- when Noah engaged with it (approx ok)
  created_at timestamptz not null default now()
);
create index idx_taste_log_user_kind on taste_log (user_id, kind);
alter table taste_log enable row level security;
grant select, insert, update, delete on taste_log to service_role;
