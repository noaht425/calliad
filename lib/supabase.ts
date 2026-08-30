import { createClient } from '@supabase/supabase-js';

// Fall back to a syntactically-valid placeholder so `next build` (which evaluates
// route modules) never hard-fails on a missing env var. Real values must be set
// in the environment for the app to actually work; routes surface that at runtime
// (e.g. /api/health returns 503).
const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key';

if (!process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NODE_ENV === 'production') {
  console.warn('[supabase] NEXT_PUBLIC_SUPABASE_URL is not set — using placeholder; requests will fail.');
}

// Anon client — safe in both client and server code (used for auth token checks).
export const supabase = createClient(url, anonKey);
