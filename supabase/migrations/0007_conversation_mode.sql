-- Phase 2 — sticky conversation mode (default | italian-tutor | study-coach | quiz | ...).
alter table conversations add column if not exists mode text not null default 'default';
