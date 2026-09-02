import { NextRequest, NextResponse } from 'next/server';
import { audit } from '@/lib/hub/audit';
import { config } from '@/lib/hub/config';
import { drainNotifications } from '@/lib/hub/notify';
import { runDueWatchers } from '@/lib/watch/check';
import { runEventNudges } from '@/lib/nudge/events';
import { runBehaviorMaintenance } from '@/lib/brain/behavior';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// The heartbeat. Vercel Hobby cron only fires once a day, so this is driven
// externally — Supabase pg_cron (or a GitHub Actions / cron-job.org schedule)
// hits it every ~10 minutes. Accepts either TICK_SECRET or the existing
// CRON_SECRET, via `x-tick-secret` / `x-cron-secret` / `Authorization: Bearer`.
function authed(req: NextRequest): boolean {
  const secrets = [process.env.TICK_SECRET, process.env.CRON_SECRET].filter(Boolean);
  if (!secrets.length) return false; // fail closed
  const presented = [
    req.headers.get('x-tick-secret'),
    req.headers.get('x-cron-secret'),
    req.headers.get('authorization')?.replace(/^Bearer\s+/i, ''),
  ].filter(Boolean);
  return presented.some((p) => secrets.includes(p!));
}

async function handle(req: NextRequest) {
  if (!authed(req)) {
    // booleans only, no values — so you can tell "unset" from "wrong value"
    return NextResponse.json(
      { error: 'Forbidden', env: { TICK_SECRET: !!process.env.TICK_SECRET, CRON_SECRET: !!process.env.CRON_SECRET } },
      { status: 403 },
    );
  }

  const kill = await config.get('killswitch_level').catch(() => 'off');
  if (kill === 'pause_all') {
    return NextResponse.json({ ok: true, skipped: 'killswitch pause_all' });
  }

  const started = Date.now();

  // Producers first (watchers + rule-based nudges), then drain — a change this
  // tick goes out the same tick.
  const watchers = await runDueWatchers().catch((e) => {
    console.error('[tick] runDueWatchers', e);
    return { checked: 0, changed: 0 };
  });
  const events = await runEventNudges().catch((e) => {
    console.error('[tick] runEventNudges', e);
    return { enqueued: 0 };
  });
  const behavior = await runBehaviorMaintenance().catch((e) => {
    console.error('[tick] runBehaviorMaintenance', e);
    return {} as { reflection?: number; compiler?: number };
  });
  const notifications = await drainNotifications().catch((e) => {
    console.error('[tick] drainNotifications', e);
    return { sent: 0, held: 0, failed: 0 };
  });

  const result = { ok: true, watchers, events, behavior, notifications, ms: Date.now() - started };
  if (watchers.changed || events.enqueued || behavior.reflection || behavior.compiler || notifications.sent || notifications.failed) {
    await audit.log('trigger_fired', 'cron', 'tick', result);
  }
  return NextResponse.json(result);
}

export const GET = handle;
export const POST = handle;
