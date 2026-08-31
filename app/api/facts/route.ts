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

// GET → confirmed + proposed facts Calliad has learned about Noah
export async function GET(req: NextRequest) {
  const user = await requireUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { data } = await adminClient
    .from('profile_facts').select('id, section, key, value, confirmed, source')
    .eq('user_id', user.id).order('section');
  return NextResponse.json({ items: data ?? [] });
}

// POST { section, key, value } → manual add (confirmed)
export async function POST(req: NextRequest) {
  const user = await requireUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  if (!b.section?.trim() || !b.key?.trim() || !b.value?.trim())
    return NextResponse.json({ error: 'section, key, value required' }, { status: 400 });
  await adminClient.from('profile_facts').upsert(
    { user_id: user.id, section: b.section.trim(), key: b.key.trim(), value: b.value.trim(), source: 'manual', confirmed: true, updated_at: new Date().toISOString() },
    { onConflict: 'user_id,section,key' },
  );
  return NextResponse.json({ ok: true });
}

// PATCH { id, confirmed?, value? }
export async function PATCH(req: NextRequest) {
  const user = await requireUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  if (!b.id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof b.confirmed === 'boolean') patch.confirmed = b.confirmed;
  if (b.value !== undefined) patch.value = b.value;
  await adminClient.from('profile_facts').update(patch).eq('user_id', user.id).eq('id', b.id);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const user = await requireUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  await adminClient.from('profile_facts').delete().eq('user_id', user.id).eq('id', id);
  return NextResponse.json({ ok: true });
}
