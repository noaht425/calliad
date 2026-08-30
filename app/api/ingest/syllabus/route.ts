import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { adminClient } from '@/lib/supabase.server';
import { ingestSyllabus } from '@/lib/ingest/syllabus';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

async function requireUser(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return null;
  const { data: { user } } = await supabase.auth.getUser(token);
  return user ?? null;
}

// GET → list ingested syllabi + their extracts.
export async function GET(req: NextRequest) {
  const user = await requireUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { data } = await adminClient
    .from('documents')
    .select('id, filename, course, extracted, created_at')
    .eq('user_id', user.id)
    .eq('kind', 'syllabus')
    .order('created_at', { ascending: false });
  return NextResponse.json({ documents: data ?? [] });
}

// POST — multipart with `file` (PDF), or JSON { text, filename? }.
export async function POST(req: NextRequest) {
  const user = await requireUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const ct = req.headers.get('content-type') ?? '';
  let result;
  if (ct.includes('multipart/form-data')) {
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return NextResponse.json({ error: 'file required' }, { status: 400 });
    const buf = Buffer.from(await file.arrayBuffer());
    if (buf.length > 15 * 1024 * 1024) return NextResponse.json({ error: 'file too large (15MB max)' }, { status: 400 });
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    result = await ingestSyllabus(user.id, {
      filename: file.name || 'syllabus.pdf',
      mime: file.type,
      bytesBase64: isPdf ? buf.toString('base64') : undefined,
      text: isPdf ? undefined : buf.toString('utf-8'),
    });
  } else {
    const b = (await req.json().catch(() => ({}))) as { text?: string; filename?: string };
    if (!b.text?.trim()) return NextResponse.json({ error: 'text required' }, { status: 400 });
    result = await ingestSyllabus(user.id, { filename: b.filename ?? 'syllabus.txt', text: b.text });
  }

  if (!result.ok) return NextResponse.json(result, { status: 422 });
  return NextResponse.json(result);
}
