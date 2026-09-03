-- Kind-filtered semantic search over notes. Corrections ("Calliad said X;
-- correct: Y") live in `notes` with kind='correction'; the brain needs to pull
-- just those against the current turn, separately from Noah's own notes.

create or replace function match_notes_of_kind(
  query_embedding vector(768),
  match_user_id uuid,
  match_kind text,
  match_count int default 6
)
returns table (id uuid, content text, kind text, meta jsonb, created_at timestamptz, similarity float)
language sql
stable
set search_path = public, extensions
as $$
  select n.id, n.content, n.kind, n.meta, n.created_at,
         1 - (n.embedding <=> query_embedding) as similarity
  from notes n
  where n.user_id = match_user_id
    and n.kind = match_kind
    and n.embedding is not null
  order by n.embedding <=> query_embedding
  limit match_count;
$$;
grant execute on function match_notes_of_kind(vector, uuid, text, int) to service_role;
