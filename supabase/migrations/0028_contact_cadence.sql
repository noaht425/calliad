-- Relationships & birthdays. anniversary + cadence tracking are Calliad-owned
-- (the contacts sync upsert doesn't touch these columns, so they're preserved).

alter table contacts add column if not exists anniversary text;                 -- MM-DD or YYYY-MM-DD
alter table contacts add column if not exists last_contact_at timestamptz;      -- when Noah last talked to them
alter table contacts add column if not exists contact_cadence text
  check (contact_cadence in ('weekly', 'biweekly', 'monthly', 'quarterly', 'yearly'));
alter table contacts add column if not exists cadence_nudged_at timestamptz;    -- last "you're overdue" ping
