-- Phase B — learned behavior rules. Calliad notices when Noah corrects *how it
-- behaves* and, after a repeat, offers to make it a standing rule. Rules are
-- injected into the system prompt and editable in Settings.

create table behavior_rules (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users not null,
  rule_text   text not null,
  source      text not null default 'explicit' check (source in ('explicit', 'learned')),
  status      text not null default 'active' check (status in ('active', 'paused', 'dismissed')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index idx_behavior_rules_user on behavior_rules (user_id, status);
alter table behavior_rules enable row level security;
grant select, insert, update, delete on behavior_rules to service_role;

-- Candidate patterns tracked across reflection runs; promoted to a rule at
-- frequency >= 2 (then 'proposed' until Noah says yes/no in chat).
create table correction_candidates (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid references auth.users not null,
  pattern_key         text not null,
  pattern_description text not null,
  proposed_rule       text not null,
  frequency           int not null default 1,
  status              text not null default 'tracking' check (status in ('tracking', 'proposed', 'promoted', 'dismissed')),
  last_seen_at        timestamptz not null default now(),
  created_at          timestamptz not null default now()
);
create unique index idx_correction_candidates_key
  on correction_candidates (user_id, pattern_key) where status in ('tracking', 'proposed');
alter table correction_candidates enable row level security;
grant select, insert, update, delete on correction_candidates to service_role;
