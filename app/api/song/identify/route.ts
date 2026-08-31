import { NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';
import { identifySong, songIdAvailable } from '@/lib/tools/song';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BYTES = 12 * 1024 * 1024;

function json(obj: unknown, status: number) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}

// POST multipart: audio=<file>  →  { block }  (formatted markdown, rendered inline)
export async function POST(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return json({ error: 'Unauthorized' }, 401);
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return json({ error: 'Unauthorized' }, 401);

  if (!songIdAvailable()) return json({ error: 'Song ID not configured (AUDD_API_TOKEN unset).' }, 503);

  let form: FormData;
  try { form = await req.formData(); } catch { return json({ error: 'Expected multipart form data' }, 400); }
  const audio = form.get('audio');
  if (!(audio instanceof Blob) || audio.size === 0) return json({ error: 'audio file required' }, 400);
  if (audio.size > MAX_BYTES) return json({ error: 'Snippet too long — a few seconds is enough.' }, 413);

  const name = (audio instanceof File && audio.name) || 'snippet.m4a';
  const block = await identifySong(audio, name);
  return json({ block }, 200);
}
