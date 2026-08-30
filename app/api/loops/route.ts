import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { allOpenLoops, upsertLoop, setLoopStatus } from '@/lib/memory/loops';

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
  return NextResponse.json({ loops: await allOpenLoops(user.id) });
}

// POST { title, body?, due_at?, tags? } → manual add
export async function POST(req: NextRequest) {
  const user = await requireUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { title?: string; body?: string; due_at?: string; tags?: string[] };
  if (!b.title?.trim()) return NextResponse.json({ error: 'title required' }, { status: 400 });
  const r = await upsertLoop(user.id, { title: b.title, body: b.body, due_at: b.due_at ?? null, tags: b.tags, source: 'manual' });
  return NextResponse.json({ ok: true, result: r });
}

// PATCH { id, status: 'done' | 'dropped' }
export async function PATCH(req: NextRequest) {
  const user = await requireUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { id?: string; status?: string };
  if (!b.id || (b.status !== 'done' && b.status !== 'dropped')) {
    return NextResponse.json({ error: 'id and status (done|dropped) required' }, { status: 400 });
  }
  await setLoopStatus(user.id, b.id, b.status);
  return NextResponse.json({ ok: true });
}
