import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { adminClient } from '@/lib/supabase.server';
import { listUnsubscribes } from '@/lib/mail/unsubscribes';

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
  return NextResponse.json({ items: await listUnsubscribes(user.id) });
}

// POST { sender_name, sender_domain }
export async function POST(req: NextRequest) {
  const user = await requireUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { sender_name?: string; sender_domain?: string };
  if (!b.sender_domain?.trim()) return NextResponse.json({ error: 'sender_domain required' }, { status: 400 });
  await adminClient.from('unsubscribes').upsert(
    {
      user_id: user.id,
      sender_name: (b.sender_name || b.sender_domain).trim(),
      sender_domain: b.sender_domain.trim().toLowerCase(),
      source: 'manual',
    },
    { onConflict: 'user_id,sender_domain', ignoreDuplicates: true },
  );
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const user = await requireUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  await adminClient.from('unsubscribes').delete().eq('user_id', user.id).eq('id', id);
  return NextResponse.json({ ok: true });
}
