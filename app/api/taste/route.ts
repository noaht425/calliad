import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { adminClient } from '@/lib/supabase.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function requireUser(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return null;
  const { data: { user } } = await supabase.auth.getUser(token);
  return user ?? null;
}

export async function GET(req: NextRequest) {
  const user = await requireUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { data } = await adminClient
    .from('taste_log').select('id, title, kind, verdict, why')
    .eq('user_id', user.id).order('created_at', { ascending: false });
  return NextResponse.json({ items: data ?? [] });
}

// POST { title, kind, verdict, why?, dated? }
export async function POST(req: NextRequest) {
  const user = await requireUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  if (!b.title?.trim() || !b.verdict?.trim()) return NextResponse.json({ error: 'title and verdict required' }, { status: 400 });
  await adminClient.from('taste_log').insert({
    user_id: user.id, title: b.title.trim(), kind: b.kind ?? 'other',
    verdict: b.verdict.trim(), why: b.why ?? null, dated: b.dated ?? null,
  });
  return NextResponse.json({ ok: true });
}

// PATCH { id, verdict?, why? }
export async function PATCH(req: NextRequest) {
  const user = await requireUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  if (!b.id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const patch: Record<string, unknown> = {};
  if (b.verdict) patch.verdict = b.verdict;
  if (b.why !== undefined) patch.why = b.why;
  await adminClient.from('taste_log').update(patch).eq('user_id', user.id).eq('id', b.id);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const user = await requireUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  await adminClient.from('taste_log').delete().eq('user_id', user.id).eq('id', id);
  return NextResponse.json({ ok: true });
}
