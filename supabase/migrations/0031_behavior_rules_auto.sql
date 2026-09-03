-- Learned rules can now activate on their own (narrow, low-risk ones) instead
-- of always waiting for a yes/no. Noah is told once and can veto with "stop
-- doing that". `pattern_key` links a rule back to the candidate that spawned it.

alter table behavior_rules add column if not exists auto_activated boolean not null default false;
alter table behavior_rules add column if not exists pattern_key text;
