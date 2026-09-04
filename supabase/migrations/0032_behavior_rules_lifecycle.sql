-- Rule lifecycle. Learned rules were append-only and unweighted; now they carry
-- a confidence weight that the nightly sweep raises when it sees the rule
-- respected and lowers when Calliad follows it and Noah still pushes back. A
-- rule that bottoms out or goes stale is parked as 'dormant' (out of the prompt,
-- reactivated if the pattern recurs) instead of living forever.

alter table behavior_rules add column if not exists weight int not null default 3;      -- 1..5 confidence
alter table behavior_rules add column if not exists reinforced_at timestamptz;          -- last time the sweep saw it respected
alter table behavior_rules add column if not exists last_conflict_at timestamptz;       -- last time it was followed but Noah re-corrected

alter table behavior_rules drop constraint if exists behavior_rules_status_check;
alter table behavior_rules add constraint behavior_rules_status_check
  check (status in ('active', 'paused', 'dismissed', 'dormant'));
