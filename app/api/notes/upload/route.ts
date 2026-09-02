import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { ingestDocument } from '@/lib/memory/notes';
import { t1Text, t1Available } from '@/lib/llm/gemini';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_BYTES = 8 * 1024 * 1024;

async function requireUser(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return null;
  const { data: { user } } = await supabase.auth.getUser(token);
  return user ?? null;
}

// multipart { file, title? }  OR  json { title, text }
export async function POST(req: NextRequest) {
  const user = await requireUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const ct = req.headers.get('content-type') ?? '';
  let title = 'Untitled';
  let text = '';

  if (ct.includes('multipart/form-data')) {
    const form = await req.formData().catch(() => null);
    const file = form?.get('file');
    title = (form?.get('title') as string) || (file instanceof File ? file.name.replace(/\.[a-z0-9]+$/i, '') : 'Untitled');
    if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: 'file required' }, { status: 400 });
    if (file.size > MAX_BYTES) return NextResponse.json({ error: 'file too large (8 MB max)' }, { status: 413 });

    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    if (isPdf) {
      if (!t1Available()) return NextResponse.json({ error: 'PDF text extraction needs GOOGLE_AI_KEY' }, { status: 503 });
      const b64 = Buffer.from(await file.arrayBuffer()).toString('base64');
      const extracted = await t1Text(
        'note_pdf_extract',
        'Extract all the readable text from this document as plain text, keeping headings and list structure. Output only the text — no preamble.',
        [{ inlineData: { mimeType: 'application/pdf', data: b64 } }],
        { maxOutputTokens: 8000 },
      );
      text = extracted ?? '';
    } else {
      text = await file.text();
    }
  } else {
    const b = (await req.json().catch(() => ({}))) as { title?: string; text?: string };
    title = b.title?.trim() || 'Untitled';
    text = b.text ?? '';
  }

  if (!text.trim()) return NextResponse.json({ error: 'no readable text found' }, { status: 422 });
  const { chunks } = await ingestDocument(user.id, title, text.slice(0, 200_000));
  return NextResponse.json({ ok: true, chunks, title });
}
