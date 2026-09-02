import { NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';
import { adminClient } from '@/lib/supabase.server';
import { transcribe, sttAvailable } from '@/lib/llm/groq';
import { audit } from '@/lib/hub/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BYTES = 12 * 1024 * 1024; // ~12 MB — a minute or two of compressed audio

function json(obj: unknown, status: number) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}

// POST multipart: audio=<file>, conversationId?=<uuid>  →  { transcript }
export async function POST(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return json({ error: 'Unauthorized' }, 401);
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return json({ error: 'Unauthorized' }, 401);

  if (!sttAvailable()) return json({ error: 'Voice not configured (GROQ_API_KEY unset).' }, 503);

  let form: FormData;
  try { form = await req.formData(); } catch { return json({ error: 'Expected multipart form data' }, 400); }

  const audio = form.get('audio');
  const conversationId = (form.get('conversationId') as string) || null;
  if (!(audio instanceof Blob) || audio.size === 0) return json({ error: 'audio file required' }, 400);
  if (audio.size > MAX_BYTES) return json({ error: 'Audio too long — keep voice notes under ~2 minutes.' }, 413);

  const name = (audio instanceof File && audio.name) || 'note.m4a';

  // Pin the language. A language-practice / Italian-tutor conversation wins;
  // otherwise default to English. (Auto-detect on a short clip sends Whisper
  // wandering into Icelandic etc. — Noah speaks English by default.)
  const explicit = (form.get('language') as string) || '';
  let language = /^(it|en|es|fr|de|pt|nl|la|el|grc?)$/i.test(explicit) ? explicit.toLowerCase() : undefined;
  if (!language && conversationId) {
    const { data } = await adminClient.from('conversations').select('mode, mode_state').eq('id', conversationId).maybeSingle();
    const pl = (data?.mode_state as { practiceLang?: { code?: string } } | null)?.practiceLang?.code;
    if (pl && /^[a-z]{2}$/.test(pl)) language = pl;
    else if (data?.mode === 'italian-tutor') language = 'it';
  }
  if (!language) language = 'en';

  try {
    const { text, durationSec, costUsd } = await transcribe(audio, name, { conversationId, language });
    await audit.log('tool_call', 'calliad', conversationId, {
      tool: 'transcribe', chars: text.length, duration_s: Math.round(durationSec), cost_usd: costUsd,
    });
    if (!text.trim()) return json({ error: "Didn't catch that — hold the mic, speak, then release." }, 422);
    return json({ transcript: text }, 200);
  } catch (err) {
    await audit.log('error', 'system', conversationId, { where: 'transcribe', message: String(err) });
    return json({ error: 'Transcription failed — try again.' }, 502);
  }
}
