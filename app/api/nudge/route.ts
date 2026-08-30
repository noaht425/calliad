import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { composeNudge } from '@/lib/nudge/compose';
import { sendPush } from '@/lib/hub/push';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Manual nudge run (bearer). GET → compose + return; ?push=1 also notifies.
export async function GET(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const force = req.nextUrl.searchParams.get('force') === '1';
  const n = await composeNudge(user.id, { force });
  if (!n) return NextResponse.json({ ok: true, nudged: false, note: force ? 'no dated open loops at all' : 'no loop in the deadline window' });
  if (!n.deferred && req.nextUrl.searchParams.get('push') === '1') {
    await sendPush(user.id, { title: 'Heads up', body: n.text.slice(0, 160), url: '/', tag: 'nudge' });
  }
  return NextResponse.json({ ok: true, nudged: !n.deferred, loop: n.loopTitle, costUsd: n.costUsd, text: n.text });
}
