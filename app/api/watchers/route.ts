import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import {
  listWatchers, createWatcher, removeWatcher, pauseWatcher,
  type WatcherKind,
} from '@/lib/watch/watchers';

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
  return NextResponse.json({ items: await listWatchers(user.id, true) });
}

// POST { kind, label?, url?, for?, days?, intervalMin? }
export async function POST(req: NextRequest) {
  const user = await requireUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as {
    kind?: WatcherKind; label?: string; url?: string; for?: string; days?: number; intervalMin?: number;
  };
  if (b.kind === 'page') {
    if (!b.url?.trim()) return NextResponse.json({ error: 'url required' }, { status: 400 });
    let host = b.url;
    try { host = new URL(b.url).hostname.replace(/^www\./, ''); } catch { /* keep */ }
    const label = b.label?.trim() || (b.for ? `${host} — ${b.for}` : `${host} (any change)`);
    const w = await createWatcher(user.id, {
      kind: 'page', label, spec: { url: b.url, ...(b.for ? { for: b.for } : {}) }, intervalMin: b.intervalMin ?? 60,
    });
    return NextResponse.json({ watcher: w, duplicate: !w });
  }
  if (b.kind === 'weather_event') {
    const days = Math.max(1, Math.min(14, b.days ?? 3));
    const w = await createWatcher(user.id, {
      kind: 'weather_event', label: b.label?.trim() || `Rain over the next ${days} days`, spec: { days }, intervalMin: b.intervalMin ?? 240,
    });
    return NextResponse.json({ watcher: w, duplicate: !w });
  }
  return NextResponse.json({ error: 'unknown kind' }, { status: 400 });
}

// PATCH { id, paused }
export async function PATCH(req: NextRequest) {
  const user = await requireUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { id?: string; paused?: boolean };
  if (!b.id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  await pauseWatcher(user.id, b.id, !!b.paused);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const user = await requireUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  await removeWatcher(user.id, id);
  return NextResponse.json({ ok: true });
}
