-- Option 1 of "self-improve": when a chat turn shows Noah asking for something
-- Calliad has no way to do, the gap gets drafted into a spec and filed as a
-- GitHub issue on noaht425/calliad instead of just evaporating. Repeat asks
-- bump hit_count/last_seen_at rather than filing duplicate issues.

create extension if not exists vector;

create table capability_gaps (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid references auth.users not null,
  title           text not null,           -- short handle, used for dedupe (like open_loops.title)
  description     text not null,           -- drafted spec: what was asked, why it wasn't possible, a rough approach
  example_text    text,                    -- Noah's actual message, for reference
  embedding       vector(768),             -- of `title`, for semantic dedupe ("book an Uber" ~ "order a rideshare")
  github_issue_number int,
  github_issue_url    text,
  hit_count       int not null default 1,
  status          text not null default 'open' check (status in ('open', 'filed', 'dismissed', 'done')),
  first_seen_at   timestamptz not null default now(),
  last_seen_at    timestamptz not null default now(),
  created_at      timestamptz not null default now()
);
create index idx_capability_gaps_user on capability_gaps (user_id, status, last_seen_at desc);
create index idx_capability_gaps_embedding on capability_gaps using hnsw (embedding vector_cosine_ops);
alter table capability_gaps enable row level security;
grant select, insert, update, delete on capability_gaps to service_role;

-- Cosine-similarity search over open/filed gaps for one user, mirrors match_notes (0027).
create or replace function match_capability_gaps(
  query_embedding vector(768),
  match_user_id uuid,
  match_count int default 5
)
returns table (id uuid, title text, hit_count int, similarity float)
language sql
stable
set search_path = public, extensions
as $$
  select g.id, g.title, g.hit_count, 1 - (g.embedding <=> query_embedding) as similarity
  from capability_gaps g
  where g.user_id = match_user_id
    and g.embedding is not null
    and g.status in ('open', 'filed')
  order by g.embedding <=> query_embedding
  limit match_count;
$$;
grant execute on function match_capability_gaps(vector, uuid, int) to service_role;
