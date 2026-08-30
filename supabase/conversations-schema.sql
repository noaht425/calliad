-- Persistent conversation memory for Calliad
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS conversations (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users NOT NULL,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS conversations_user_id_created_at_idx
  ON conversations(user_id, created_at DESC);

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can access own conversations"
  ON conversations FOR ALL
  USING (auth.uid() = user_id);
