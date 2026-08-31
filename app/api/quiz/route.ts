import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { adminClient } from '@/lib/supabase.server';
import { addItem, counts } from '@/lib/quiz/items';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function requireUser(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return null;
  const { data: { user } } = await supabase.auth.getUser(token);
  return user ?? null;
}

// GET → counts + recent items
export async function GET(req: NextRequest) {
  const user = await requireUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const [c, { data: items }] = await Promise.all([
    counts(user.id),
    adminClient.from('quiz_items')
      .select('id, lang, kind, prompt, answer, box, due_at')
      .eq('user_id', user.id).order('created_at', { ascending: false }).limit(50),
  ]);
  return NextResponse.json({ ...c, items: items ?? [] });
}

// POST { lang?, kind?, prompt, answer, notes? } — or { items: [...] } for bulk
export async function POST(req: NextRequest) {
  const user = await requireUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  const rows: { prompt: string; answer: string; lang?: string; kind?: string; notes?: string }[] =
    Array.isArray(b.items) ? b.items : [b];
  const results = [];
  for (const r of rows) {
    if (!r?.prompt || !r?.answer) { results.push('skipped'); continue; }
    results.push(await addItem(user.id, r));
  }
  return NextResponse.json({ ok: true, results });
}

// DELETE ?id=
export async function DELETE(req: NextRequest) {
  const user = await requireUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  await adminClient.from('quiz_items').delete().eq('user_id', user.id).eq('id', id);
  return NextResponse.json({ ok: true });
}
