-- Phase 1 — nudge v1. One nudge per loop as it enters the deadline window.
alter table open_loops add column if not exists last_nudged_at timestamptz;
create index if not exists idx_open_loops_nudge on open_loops (user_id, status, due_at, last_nudged_at);
