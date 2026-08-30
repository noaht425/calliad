import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { adminClient } from '@/lib/supabase.server';
import { scanGmailForTravel, scanGmailSent } from '@/lib/gmail';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  // Cron invocation
  const authHeader = req.headers.get('authorization');
  if (authHeader === `Bearer ${process.env.CRON_SECRET}`) {
    const { data: services } = await adminClient
      .from('connected_services')
      .select('user_id')
      .eq('service', 'gmail');

    const results = await Promise.allSettled(
      (services ?? []).map((s) => Promise.all([
        scanGmailForTravel(s.user_id),
        scanGmailSent(s.user_id),
      ]))
    );

    const totals = results.reduce(
      (acc, r) => {
        if (r.status === 'fulfilled') {
          acc.captured += r.value[0].captured + r.value[1].captured;
          acc.skipped += r.value[0].skipped + r.value[1].skipped;
          acc.dupes_skipped += r.value[0].dupes_skipped + r.value[1].dupes_skipped;
        }
        return acc;
      },
      { captured: 0, skipped: 0, dupes_skipped: 0 }
    );

    return NextResponse.json({ ok: true, ...totals });
  }

  // Manual invocation — verify user JWT
  const token = authHeader?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const [travelResult, sentResult] = await Promise.all([
    scanGmailForTravel(user.id),
    scanGmailSent(user.id),
  ]);
  return NextResponse.json({ ok: true, travel: travelResult, sent: sentResult });
}
