-- Projects as first-class entities — run this in Supabase SQL Editor
-- Safe to run multiple times (all statements are idempotent)

-- 1. Ensure folders has entity_type and parent_folder_id
ALTER TABLE folders
  ADD COLUMN IF NOT EXISTS entity_type text NOT NULL DEFAULT 'folder'
    CHECK (entity_type IN ('folder', 'project'));

ALTER TABLE folders
  ADD COLUMN IF NOT EXISTS parent_folder_id uuid REFERENCES folders(id) ON DELETE SET NULL;

-- 2. Create projects table (no-op if already exists)
CREATE TABLE IF NOT EXISTS projects (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid REFERENCES auth.users NOT NULL,
  folder_id    uuid REFERENCES folders(id) ON DELETE SET NULL,
  title        text NOT NULL,
  company      text,
  status       text NOT NULL DEFAULT 'active'
                 CHECK (status IN ('planning', 'active', 'completed', 'archived')),
  start_date   date,
  end_date     date,
  summary      text,
  milestones   jsonb NOT NULL DEFAULT '[]',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'projects' AND policyname = 'Users access own projects'
  ) THEN
    CREATE POLICY "Users access own projects" ON projects
      FOR ALL USING (auth.uid() = user_id);
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.projects TO service_role;

-- 3. Add project_id FK on captures (links a capture to a projects row)
ALTER TABLE captures
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES projects(id) ON DELETE SET NULL;

-- 4. Add trip_id FK on captures (links a capture to a trip)
ALTER TABLE captures
  ADD COLUMN IF NOT EXISTS trip_id uuid REFERENCES trips(id) ON DELETE SET NULL;

-- 5. Backfill: create projects rows from existing entity_type='project' folders
--    Skips folders that already have a matching projects row
INSERT INTO projects (user_id, folder_id, title, status, milestones, created_at, updated_at)
SELECT
  f.user_id,
  f.id        AS folder_id,
  f.name      AS title,
  'active'    AS status,
  '[]'::jsonb AS milestones,
  f.created_at,
  f.created_at AS updated_at
FROM folders f
WHERE f.entity_type = 'project'
  AND NOT EXISTS (
    SELECT 1 FROM projects p WHERE p.folder_id = f.id
  );

-- 6. Backfill captures: set project_id for captures already filed to project folders
UPDATE captures c
SET project_id = p.id
FROM projects p
WHERE p.folder_id = c.folder_id
  AND c.folder_id IS NOT NULL
  AND c.project_id IS NULL;

-- 7. Grant service_role access to trips (needed for trip_id FK and trip queries)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trips TO service_role;
