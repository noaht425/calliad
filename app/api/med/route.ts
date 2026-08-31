import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { adminClient } from '@/lib/supabase.server';
import { medCheckin, recordMed } from '@/lib/health/meds';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TZ = process.env.TZ_DEFAULT ?? 'America/New_York';

async function requireUser(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return null;
  const { data: { user } } = await supabase.auth.getUser(token);
  return user ?? null;
}

// GET → today's status + last 14 days. ?checkin=1 sends a check-in now (test).
export async function GET(req: NextRequest) {
  const user = await requireUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (req.nextUrl.searchParams.get('checkin') === '1') {
    const r = await medCheckin(user.id, { followUp: true });
    return NextResponse.json({ ok: true, ...r });
  }

  const since = new Date(Date.now() - 14 * 86400000).toLocaleDateString('en-CA', { timeZone: TZ });
  const { data } = await adminClient
    .from('med_log')
    .select('day, taken, taken_at, sent_count, note')
    .eq('user_id', user.id)
    .gte('day', since)
    .order('day', { ascending: false });
  return NextResponse.json({ history: data ?? [] });
}

// POST { taken: boolean, note?: string } → record today's answer.
export async function POST(req: NextRequest) {
  const user = await requireUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { taken?: boolean; note?: string };
  if (typeof b.taken !== 'boolean') return NextResponse.json({ error: 'taken (boolean) required' }, { status: 400 });
  await recordMed(user.id, b.taken, b.note);
  return NextResponse.json({ ok: true });
}
