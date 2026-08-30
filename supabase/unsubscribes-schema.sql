-- Unsubscribe tracking — run in Supabase SQL Editor
-- Safe to run multiple times (idempotent)

CREATE TABLE IF NOT EXISTS unsubscribes (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 uuid REFERENCES auth.users NOT NULL,
  sender_name             text NOT NULL,
  sender_domain           text NOT NULL,
  sender_email            text,
  unsubscribed_at         date NOT NULL DEFAULT CURRENT_DATE,
  last_marketing_email_at timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE unsubscribes ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'unsubscribes' AND policyname = 'Users access own unsubscribes'
  ) THEN
    CREATE POLICY "Users access own unsubscribes" ON unsubscribes
      FOR ALL USING (auth.uid() = user_id);
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.unsubscribes TO service_role;
