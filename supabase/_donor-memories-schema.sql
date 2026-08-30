-- Long-term memory store for Calliad
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS memories (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users NOT NULL,
  category text NOT NULL, -- home, travel, food, people, preferences, routines, places, health, general
  key text NOT NULL,       -- short slug, e.g. "second_home_location"
  value text NOT NULL,     -- the fact to remember
  source text DEFAULT 'chat', -- chat | manual
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS memories_user_category_key_idx ON memories(user_id, category, key);
CREATE INDEX IF NOT EXISTS memories_user_id_idx ON memories(user_id);

ALTER TABLE memories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can access own memories"
  ON memories FOR ALL
  USING (auth.uid() = user_id);
