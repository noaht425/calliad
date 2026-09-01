import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { runCurationChoice } from '@/lib/travel/trip-email';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function requireUser(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return null;
  const { data: { user } } = await supabase.auth.getUser(token);
  return user ?? null;
}

// POST { cardId, choice }
export async function POST(req: NextRequest) {
  const user = await requireUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { cardId?: string; choice?: string };
  if (!b.cardId || !b.choice) return NextResponse.json({ error: 'cardId + choice required' }, { status: 400 });
  const r = await runCurationChoice(user.id, b.cardId, b.choice);
  return NextResponse.json({ ok: true, ...r });
}
