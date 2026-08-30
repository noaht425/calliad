import { createClient } from '@supabase/supabase-js';

// Service-role client — server-side only (API routes). Bypasses RLS; routes verify
// the caller's JWT / secret before using it.
// Placeholder fallbacks keep `next build` from hard-failing on missing env; real
// values are required at runtime (surfaced by /api/health → 503).
const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder-service-key';

if (!process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.NODE_ENV === 'production') {
  console.warn('[supabase.server] SUPABASE_SERVICE_ROLE_KEY is not set — using placeholder; DB writes will fail.');
}

export const adminClient = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
