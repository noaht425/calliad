import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { adminClient } from '@/lib/supabase.server';
import { listPrefs } from '@/lib/tools/beli';

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
  return NextResponse.json({ items: await listPrefs(user.id) });
}

// POST { name, city?, score?, category?, note?, status? } → manual add
export async function POST(req: NextRequest) {
  const user = await requireUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  if (!b.name?.trim()) return NextResponse.json({ error: 'name required' }, { status: 400 });
  const key = `${b.name.toLowerCase().trim()}|${(b.city ?? '').toLowerCase().trim()}`;
  await adminClient.from('restaurant_prefs').upsert(
    {
      user_id: user.id, name: b.name.trim(), city: b.city?.trim() || null,
      score: typeof b.score === 'number' ? b.score : null, category: b.category?.trim() || null,
      note: b.note?.trim() || null, status: b.status === 'want' ? 'want' : 'ranked',
      source: 'manual', dedupe_key: key, updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,dedupe_key' },
  );
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const user = await requireUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const id = req.nextUrl.searchParams.get('id');
  if (id === 'all') {
    await adminClient.from('restaurant_prefs').delete().eq('user_id', user.id);
    return NextResponse.json({ ok: true, cleared: true });
  }
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  await adminClient.from('restaurant_prefs').delete().eq('user_id', user.id).eq('id', id);
  return NextResponse.json({ ok: true });
}
