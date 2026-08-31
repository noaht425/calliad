import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { adminClient } from '@/lib/supabase.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TZ = process.env.TZ_DEFAULT ?? 'America/New_York';

function todayBoundsUTC(now = new Date()) {
  const shifted = new Date(now.toLocaleString('en-US', { timeZone: TZ }));
  const offset = now.getTime() - shifted.getTime();
  const startLocal = new Date(shifted);
  startLocal.setHours(0, 0, 0, 0);
  const start = new Date(startLocal.getTime() + offset);
  return { start, end: new Date(start.getTime() + 86400000) };
}

// GET → the at-a-glance bundle for the home screen.
export async function GET(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const now = new Date();
  const { start, end } = todayBoundsUTC(now);

  const [{ data: events }, { data: loops }] = await Promise.all([
    adminClient
      .from('calendar_events')
      .select('title, start_at, end_at, all_day, location')
      .eq('user_id', user.id)
      .gte('start_at', start.toISOString())
      .lt('start_at', end.toISOString())
      .order('start_at')
      .limit(20),
    adminClient
      .from('open_loops')
      .select('id, title, due_at, tags, source')
      .eq('user_id', user.id)
      .eq('status', 'open')
      .order('due_at', { ascending: true, nullsFirst: false }),
  ]);

  const all = loops ?? [];
  const overdue = all.filter((l) => l.due_at && Date.parse(l.due_at) < start.getTime());
  const today = all.filter((l) => l.due_at && Date.parse(l.due_at) >= start.getTime() && Date.parse(l.due_at) < end.getTime());
  const undatedCount = all.filter((l) => !l.due_at).length;
  // soonest dated task beyond today (open_loops is already sorted by due_at asc)
  const nextDeadline = all.find((l) => l.due_at && Date.parse(l.due_at) >= end.getTime()) ?? null;

  return NextResponse.json({
    tz: TZ,
    now: now.toISOString(),
    events: events ?? [],
    tasks: { overdue, today, undatedCount, openCount: all.length },
    nextDeadline,
  });
}
