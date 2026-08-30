import { createClient } from '@supabase/supabase-js';

// Service role client — server-side only (API routes).
// Bypasses RLS; safe because routes always verify the JWT first and filter by user_id.
export const adminClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);
