import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase.server';
import { audit } from '@/lib/hub/audit';
import { config } from '@/lib/hub/config';
import { checkSecret } from '@/lib/hub/guard';
import { sendPush } from '@/lib/hub/push';
import { composeBrief } from '@/lib/brief/compose';

export const runtime = 'nodejs';
export const maxDuration = 120;

const TZ = process.env.TZ_DEFAULT ?? 'America/New_York';

async function handle(req: NextRequest) {
  const denied = checkSecret(req, 'CRON_SECRET', ['x-cron-secret']);
  if (denied) return denied;

  // Kill switch: proactive output is suppressed under pause_proactive and pause_all.
  const kill = await config.get('killswitch_level');
  if (kill === 'pause_all' || kill === 'pause_proactive') {
    await audit.log('trigger_fired', 'cron', 'brief', { skipped: `killswitch ${kill}` });
    return NextResponse.json({ ok: true, skipped: `killswitch ${kill}` });
  }

  // Quiet hours 1–7am local (belt-and-suspenders; the cron time already clears it).
  const hour = parseInt(new Date().toLocaleString('en-US', { timeZone: TZ, hour: 'numeric', hour12: false }).replace(/\D/g, ''), 10);
  if (hour >= 1 && hour < 7) {
    await audit.log('trigger_fired', 'cron', 'brief', { skipped: 'quiet hours' });
    return NextResponse.json({ ok: true, skipped: 'quiet hours' });
  }

  // Everyone with any connected service or synced schedule gets a brief. Phase 0/1
  // is single-user, but this generalises.
  const { data: svc } = await adminClient.from('connected_services').select('user_id');
  const { data: sched } = await adminClient.from('calendar_events').select('user_id').eq('source', 'schedule').limit(1000);
  const userIds = [...new Set([...(svc ?? []), ...(sched ?? [])].map((r) => r.user_id))];

  const results: Record<string, unknown>[] = [];
  for (const userId of userIds) {
    try {
      const brief = await composeBrief(userId);
      if (brief.deferred) { results.push({ userId, deferred: true }); continue; }
      const push = await sendPush(userId, {
        title: 'Morning brief',
        body: brief.text.slice(0, 160),
        url: '/',
        tag: 'brief',
      });
      results.push({ userId, costUsd: brief.costUsd, pushed: push.sent });
    } catch (err) {
      console.error('[cron/brief]', userId, err);
      await audit.log('error', 'system', 'brief', { userId, message: String(err) });
      results.push({ userId, error: String(err) });
    }
  }

  await audit.log('trigger_fired', 'cron', 'brief', { at: new Date().toISOString(), users: results.length, results });
  return NextResponse.json({ ok: true, users: results.length, results });
}

export const GET = handle;  // Vercel Cron
export const POST = handle;  // external pinger
