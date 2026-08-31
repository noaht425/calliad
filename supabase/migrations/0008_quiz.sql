-- Phase 2 — spaced-repetition quiz over Noah's own study material (pattern N).
create table quiz_items (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references auth.users not null,
  lang       text not null default 'lat',   -- 'lat' | 'grc' | 'ita' | ...
  kind       text not null default 'vocab', -- 'vocab' | 'form' | 'other'
  prompt     text not null,                 -- what Noah is shown
  answer     text not null,                 -- expected answer (| separated = alternatives ok)
  notes      text,
  box        int not null default 0,        -- Leitner box 0..5
  due_at     timestamptz not null default now(),
  last_seen  timestamptz,
  streak     int not null default 0,
  created_at timestamptz not null default now(),
  unique (user_id, lang, prompt)
);
create index idx_quiz_due on quiz_items (user_id, due_at);
alter table quiz_items enable row level security;
grant select, insert, update, delete on quiz_items to service_role;

-- per-conversation scratch state for modes (quiz uses { currentItemId })
alter table conversations add column if not exists mode_state jsonb not null default '{}';
