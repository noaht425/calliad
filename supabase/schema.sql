-- Run this in the Supabase SQL editor (Project → SQL Editor → New query)

-- Enable pgvector for semantic search
create extension if not exists vector;

-- Folders — lightweight groupings for captures
create table folders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  name text not null,
  color text not null default 'stone',
  icon text not null default '◐',
  created_at timestamptz not null default now()
);

alter table folders enable row level security;
create policy "Users access own folders" on folders
  for all using (auth.uid() = user_id);

-- Captures — the atomic unit of Calliad
create table captures (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  raw_audio_url text,
  transcript text not null default '',
  summary text,
  tags text[] not null default '{}',
  folder_id uuid references folders(id) on delete set null,
  source text not null check (source in ('pwa_button','back_tap','widget','share','alexa','manual','email','sent_email','voice','chat','assistant','action')),
  location_lat double precision,
  location_lng double precision,
  location_label text,
  status text not null default 'inbox' check (status in ('inbox','archived','tasked','folder')),
  embedding vector(768),     -- gemini-embedding-001 with outputDimensionality:768
  transcription_status text not null default 'pending' check (transcription_status in ('pending','processing','done','error')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table captures enable row level security;
create policy "Users access own captures" on captures
  for all using (auth.uid() = user_id);

-- Full-text index over transcript + summary
create index captures_fts_idx on captures
  using gin (to_tsvector('english', transcript || ' ' || coalesce(summary, '')));

-- Vector similarity index (cosine)
create index captures_embedding_idx on captures
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

-- Auto-update updated_at
create or replace function update_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger captures_updated_at
  before update on captures
  for each row execute function update_updated_at();

-- Grant table-level access to service_role (needed for adminClient to bypass RLS)
grant select, insert, update, delete on public.folders to service_role;
grant select, insert, update, delete on public.captures to service_role;

-- Supabase Storage bucket for audio files
-- Run this separately or via the Supabase dashboard:
-- Storage → New bucket → name: "audio" → Private
insert into storage.buckets (id, name, public) values ('audio', 'audio', false)
  on conflict do nothing;

create policy "Users access own audio" on storage.objects
  for all using (
    bucket_id = 'audio' and
    auth.uid()::text = (storage.foldername(name))[1]
  );

-- Semantic search function (called from /api/search)
create or replace function search_captures(
  query_embedding vector(768),
  query_user_id uuid,
  match_count int default 20
)
returns table (
  id uuid,
  transcript text,
  summary text,
  tags text[],
  status text,
  source text,
  folder_id uuid,
  created_at timestamptz,
  similarity float
)
language sql stable as $$
  select
    id, transcript, summary, tags, status, source, folder_id, created_at,
    1 - (embedding <=> query_embedding) as similarity
  from captures
  where user_id = query_user_id
    and transcription_status = 'done'
    and embedding is not null
  order by embedding <=> query_embedding
  limit match_count;
$$;
