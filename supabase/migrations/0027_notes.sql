-- Phase 4 — personal knowledge base. "Note that X" stores a note (embedded);
-- "what did I say about X / when did I / did I ever" runs a semantic search.

create extension if not exists vector;

create table notes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references auth.users not null,
  content    text not null,
  kind       text not null default 'note',    -- 'note' | 'chat' | 'doc'
  source     text not null default 'chat',
  meta       jsonb not null default '{}'::jsonb,
  embedding  vector(768),
  created_at timestamptz not null default now()
);
create index idx_notes_user on notes (user_id, created_at desc);
create index idx_notes_embedding on notes using hnsw (embedding vector_cosine_ops);
alter table notes enable row level security;
grant select, insert, update, delete on notes to service_role;

-- Cosine-similarity search, scoped to one user. Server calls this via adminClient.
create or replace function match_notes(
  query_embedding vector(768),
  match_user_id uuid,
  match_count int default 6
)
returns table (id uuid, content text, kind text, created_at timestamptz, similarity float)
language sql
stable
set search_path = public
as $$
  select n.id, n.content, n.kind, n.created_at,
         1 - (n.embedding <=> query_embedding) as similarity
  from notes n
  where n.user_id = match_user_id
    and n.embedding is not null
  order by n.embedding <=> query_embedding
  limit match_count;
$$;
grant execute on function match_notes(vector, uuid, int) to service_role;
