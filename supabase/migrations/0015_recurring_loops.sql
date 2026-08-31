-- Recurring tasks: when a loop with `recur` set is completed, Calliad spawns the
-- next occurrence instead of just closing it. Dropping it ends the series.
alter table open_loops
  add column if not exists recur text
    check (recur is null or recur in ('daily', 'weekdays', 'weekly', 'biweekly', 'monthly'));
