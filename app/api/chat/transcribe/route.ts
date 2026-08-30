import { NextRequest, NextResponse } from 'next/server';
import Groq from 'groq-sdk';
import { supabase } from '@/lib/supabase';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const formData = await req.formData();
  const audio = formData.get('audio') as File | null;
  if (!audio) return NextResponse.json({ error: 'audio required' }, { status: 400 });

  const mimeType = audio.type || 'audio/mp4';
  const ext = mimeType.includes('webm') ? 'webm' : 'mp4';
  const arrayBuffer = await audio.arrayBuffer();

  if (arrayBuffer.byteLength < 4096) {
    return NextResponse.json({ error: 'Audio too short' }, { status: 400 });
  }

  try {
    const transcription = await groq.audio.transcriptions.create({
      file: new File([arrayBuffer], `audio.${ext}`, { type: mimeType }),
      model: 'whisper-large-v3-turbo',
    });
    const transcript = (transcription.text ?? '').trim();
    return NextResponse.json({ transcript });
  } catch (err) {
    console.error('[chat/transcribe] Groq error:', err);
    return NextResponse.json({ error: 'Transcription failed' }, { status: 500 });
  }
}
