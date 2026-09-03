import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { synthesize, geminiTtsAvailable, GEMINI_VOICES } from '@/lib/voice/tts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function requireUser(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return null;
  const { data: { user } } = await supabase.auth.getUser(token);
  return user ?? null;
}

// GET → availability + voice list (for Settings)
export async function GET(req: NextRequest) {
  const user = await requireUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json({ available: geminiTtsAvailable(), voices: GEMINI_VOICES });
}

// POST { text, voice? } → audio/wav
export async function POST(req: NextRequest) {
  const user = await requireUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const b = (await req.json().catch(() => ({}))) as { text?: string; voice?: string };
  const text = (b.text ?? '').trim();
  if (!text) return NextResponse.json({ error: 'text required' }, { status: 400 });

  const wav = await synthesize(text, b.voice);
  if (!wav) return NextResponse.json({ error: 'synthesis failed' }, { status: 502 });

  return new NextResponse(new Uint8Array(wav), {
    headers: {
      'content-type': 'audio/wav',
      'cache-control': 'no-store',
      'content-length': String(wav.length),
    },
  });
}
