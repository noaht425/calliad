import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { allOpenLoops, upsertLoop, setLoopStatus, setLoopDue } from '@/lib/memory/loops';
import { detectLoopsFromTurn } from '@/lib/memory/detect';
import { t1Available } from '@/lib/llm/gemini';

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

// POST { title, ... }  → manual add
// POST { probe: "..." } → run T1 detection synchronously on that text + report
export async function POST(req: NextRequest) {
  const user = await requireUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { title?: string; body?: string; due_at?: string; tags?: string[]; probe?: string };

  if (b.probe?.trim()) {
    const before = (await allOpenLoops(user.id)).length;
    await detectLoopsFromTurn(user.id, b.probe.trim(), '(diagnostic run)', null);
    const after = await allOpenLoops(user.id);
    return NextResponse.json({
      ok: true,
      t1Available: t1Available(),
      filed: after.length - before,
      loops: after.map((l) => l.title),
    });
  }

  if (!b.title?.trim()) return NextResponse.json({ error: 'title required' }, { status: 400 });
  const r = await upsertLoop(user.id, { title: b.title, body: b.body, due_at: b.due_at ?? null, tags: b.tags, source: 'manual' });
  return NextResponse.json({ ok: true, result: r });
}

// PATCH { id, status: 'done' | 'dropped' }  or  { id, due_at: ISO | null }
export async function PATCH(req: NextRequest) {
  const user = await requireUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { id?: string; status?: string; due_at?: string | null };
  if (!b.id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  if (b.due_at !== undefined) {
    await setLoopDue(user.id, b.id, b.due_at);
    return NextResponse.json({ ok: true });
  }
  if (b.status === 'done' || b.status === 'dropped') {
    await setLoopStatus(user.id, b.id, b.status);
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: 'status (done|dropped) or due_at required' }, { status: 400 });
}
