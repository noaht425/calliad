import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import {
  listWatch, addToWatchList, setWatchStatus, setWatchRating, setSeasonState, removeWatch,
  type WatchStatus, type SeasonState,
} from '@/lib/tools/watchlist';

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
  return NextResponse.json({ items: await listWatch(user.id) });
}

// POST { title, status? }
export async function POST(req: NextRequest) {
  const user = await requireUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { title?: string; status?: WatchStatus };
  if (!b.title?.trim()) return NextResponse.json({ error: 'title required' }, { status: 400 });
  const r = await addToWatchList(user.id, b.title, b.status ?? 'want');
  return NextResponse.json(r);
}

// PATCH { id, status? } | { id, rating? } | { id, season, state }
export async function PATCH(req: NextRequest) {
  const user = await requireUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as {
    id?: string; status?: WatchStatus; rating?: number | null; season?: number; state?: SeasonState;
  };
  if (!b.id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  if (b.season != null && b.state) {
    const row = await setSeasonState(user.id, b.id, b.season, b.state);
    return NextResponse.json({ ok: true, row });
  }
  if (b.rating !== undefined) {
    await setWatchRating(user.id, b.id, b.rating);
    return NextResponse.json({ ok: true });
  }
  if (b.status) {
    await setWatchStatus(user.id, b.id, b.status);
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: 'nothing to update' }, { status: 400 });
}

export async function DELETE(req: NextRequest) {
  const user = await requireUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  await removeWatch(user.id, id);
  return NextResponse.json({ ok: true });
}
