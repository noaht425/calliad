-- Phase 1 — source ingestion (pattern C). Syllabi first; leases/tickets later.
create table documents (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references auth.users not null,
  kind       text not null default 'syllabus',   -- 'syllabus' | ...
  filename   text,
  course     text,                                -- course code, once known
  raw_text   text,                                -- extracted / provided text (nullable for PDFs)
  extracted  jsonb,                               -- the structured result
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_documents_user_kind on documents (user_id, kind, created_at desc);
alter table documents enable row level security;
grant select, insert, update, delete on documents to service_role;
