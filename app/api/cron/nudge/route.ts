import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase.server';
import { audit } from '@/lib/hub/audit';
import { config } from '@/lib/hub/config';
import { checkSecret } from '@/lib/hub/guard';
import { sendPush } from '@/lib/hub/push';
import { composeNudge } from '@/lib/nudge/compose';
import { medCheckin } from '@/lib/health/meds';
import { tripPrepNudges, markPrepSent } from '@/lib/travel/trips';

export const runtime = 'nodejs';
export const maxDuration = 120;

const TZ = process.env.TZ_DEFAULT ?? 'America/New_York';

async function handle(req: NextRequest) {
  const denied = checkSecret(req, 'CRON_SECRET', ['x-cron-secret']);
  if (denied) return denied;

  const kill = await config.get('killswitch_level');
  if (kill === 'pause_all' || kill === 'pause_proactive') {
    await audit.log('trigger_fired', 'cron', 'nudge', { skipped: `killswitch ${kill}` });
    return NextResponse.json({ ok: true, skipped: `killswitch ${kill}` });
  }
  const hour = parseInt(new Date().toLocaleString('en-US', { timeZone: TZ, hour: 'numeric', hour12: false }).replace(/\D/g, ''), 10);
  if (hour >= 1 && hour < 7) {
    await audit.log('trigger_fired', 'cron', 'nudge', { skipped: 'quiet hours' });
    return NextResponse.json({ ok: true, skipped: 'quiet hours' });
  }

  // Afternoon medication backstop + trip-prep nudges for every connected user,
  // then the deadline nudge.
  const { data: allSvc } = await adminClient.from('connected_services').select('user_id');
  const medResults: Record<string, unknown>[] = [];
  const tripResults: Record<string, unknown>[] = [];
  for (const userId of [...new Set((allSvc ?? []).map((r) => r.user_id))]) {
    const m = await medCheckin(userId, { followUp: true }).catch((e) => ({ sent: false, reason: String(e) }));
    medResults.push({ userId, ...m });

    const preps = await tripPrepNudges(userId).catch(() => []);
    for (const p of preps) {
      const push = await sendPush(userId, { title: 'Trip prep', body: p.message.slice(0, 300), url: '/', tag: `trip-${p.key}` });
      await markPrepSent(p.tripId, p.key).catch(() => {});
      tripResults.push({ userId, key: p.key, pushed: push.sent });
    }
  }

  const { data: users } = await adminClient
    .from('open_loops')
    .select('user_id')
    .eq('status', 'open')
    .not('due_at', 'is', null)
    .is('last_nudged_at', null);
  const userIds = [...new Set((users ?? []).map((r) => r.user_id))];

  const results: Record<string, unknown>[] = [];
  for (const userId of userIds) {
    try {
      const n = await composeNudge(userId);
      if (!n) { results.push({ userId, nudged: false }); continue; }
      if (n.deferred) { results.push({ userId, deferred: true }); continue; }
      const push = await sendPush(userId, { title: 'Heads up', body: n.text.slice(0, 160), url: '/', tag: 'nudge' });
      results.push({ userId, loop: n.loopTitle, pushed: push.sent, costUsd: n.costUsd });
    } catch (err) {
      console.error('[cron/nudge]', userId, err);
      await audit.log('error', 'system', 'nudge', { userId, message: String(err) });
    }
  }

  await audit.log('trigger_fired', 'cron', 'nudge', { at: new Date().toISOString(), results, med: medResults, trips: tripResults });
  return NextResponse.json({ ok: true, results, med: medResults, trips: tripResults });
}

export const GET = handle;
export const POST = handle;
