import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { adminClient } from '@/lib/supabase.server';
import { listSubscriptions, monthlyTotalCents, upsertSubscription, type Cadence } from '@/lib/money/subscriptions';

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
  const items = await listSubscriptions(user.id);
  return NextResponse.json({ items, monthlyTotalCents: monthlyTotalCents(items) });
}

// POST { name, amount (dollars), cadence, next_charge?, category? }
export async function POST(req: NextRequest) {
  const user = await requireUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { name?: string; amount?: number; cadence?: string; next_charge?: string | null; category?: string | null };
  const cadences = ['weekly', 'monthly', 'quarterly', 'yearly'];
  if (!b.name?.trim() || !b.amount || b.amount <= 0 || !cadences.includes(b.cadence ?? '')) {
    return NextResponse.json({ error: 'name, amount, cadence required' }, { status: 400 });
  }
  const how = await upsertSubscription(user.id, {
    name: b.name.trim(),
    amount_cents: Math.round(b.amount * 100),
    cadence: b.cadence as Cadence,
    next_charge: b.next_charge ? b.next_charge.slice(0, 10) : null,
    category: b.category?.trim() || null,
  });
  return NextResponse.json({ ok: true, result: how });
}

export async function DELETE(req: NextRequest) {
  const user = await requireUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  await adminClient.from('subscriptions').update({ active: false, updated_at: new Date().toISOString() }).eq('user_id', user.id).eq('id', id);
  return NextResponse.json({ ok: true });
}
