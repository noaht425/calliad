import { NextRequest, NextResponse } from 'next/server';
import { route } from '@/lib/router/route';
import { audit } from '@/lib/hub/audit';
import { checkSecret } from '@/lib/hub/guard';

export const runtime = 'nodejs';

// Hourly no-op — proof the scheduler is alive. Registered in vercel.json.
// Accepts `Authorization: Bearer <CRON_SECRET>` (Vercel Cron) or `x-cron-secret`.
async function handle(req: NextRequest) {
  const denied = checkSecret(req, 'CRON_SECRET', ['x-cron-secret']);
  if (denied) return denied;

  const decision = await route({ source: 'cron', kind: 'trigger', job: 'heartbeat' });
  await audit.log('trigger_fired', 'cron', 'heartbeat', {
    at: new Date().toISOString(),
    decision: decision.reason,
  });
  return NextResponse.json({ ok: true, job: 'heartbeat', ts: new Date().toISOString() });
}

export const GET = handle;
export const POST = handle;
