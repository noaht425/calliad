import { NextRequest, NextResponse } from 'next/server';
import { audit } from '@/lib/hub/audit';
import { config } from '@/lib/hub/config';
import { checkSecret } from '@/lib/hub/guard';
import { drainNotifications } from '@/lib/hub/notify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// The heartbeat. Vercel Hobby cron only fires once a day, so this is driven
// externally — Supabase pg_cron (or a GitHub Actions schedule) hits it every
// ~10 minutes with TICK_SECRET. It drains the notification queue now; Phase 2
// adds watcher checks here.
async function handle(req: NextRequest) {
  const denied = checkSecret(req, 'TICK_SECRET', ['x-tick-secret']);
  if (denied) return denied;

  const kill = await config.get('killswitch_level').catch(() => 'off');
  if (kill === 'pause_all') {
    return NextResponse.json({ ok: true, skipped: 'killswitch pause_all' });
  }

  const started = Date.now();
  const notifications = await drainNotifications().catch((e) => {
    console.error('[tick] drainNotifications', e);
    return { sent: 0, held: 0, failed: 0 };
  });

  const result = { ok: true, notifications, ms: Date.now() - started };
  if (notifications.sent || notifications.failed) {
    await audit.log('trigger_fired', 'cron', 'tick', result);
  }
  return NextResponse.json(result);
}

export const GET = handle;
export const POST = handle;
