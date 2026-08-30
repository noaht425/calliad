import { NextRequest, NextResponse } from 'next/server';
import { route } from '@/lib/router/route';
import { audit } from '@/lib/hub/audit';

export const runtime = 'nodejs';

// Hourly no-op — proof the scheduler is alive. Registered in vercel.json.
// Accepts either `Authorization: Bearer <CRON_SECRET>` (Vercel Cron) or
// `x-cron-secret: <CRON_SECRET>`.
async function handle(req: NextRequest) {
  const bearer = req.headers.get('authorization')?.replace('Bearer ', '');
  const header = req.headers.get('x-cron-secret');
  if (bearer !== process.env.CRON_SECRET && header !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const decision = await route({ source: 'cron', kind: 'trigger', job: 'heartbeat' });
  await audit.log('trigger_fired', 'cron', 'heartbeat', { at: new Date().toISOString(), decision: decision.reason });
  return NextResponse.json({ ok: true, job: 'heartbeat', ts: new Date().toISOString() });
}

export const GET = handle;   // Vercel Cron issues GET
export const POST = handle;  // manual / external pingers
