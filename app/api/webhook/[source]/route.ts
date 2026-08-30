import { NextRequest, NextResponse } from 'next/server';
import { audit } from '@/lib/hub/audit';

export const runtime = 'nodejs';

// Phase 0: acknowledge + log only. No processing until Phase 1 wires real sources.
export async function POST(req: NextRequest, ctx: { params: Promise<{ source: string }> }) {
  const { source } = await ctx.params;

  if (req.headers.get('x-webhook-secret') !== process.env.WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let payload: unknown = null;
  try { payload = await req.json(); } catch { /* non-JSON bodies allowed */ }

  await audit.log('trigger_fired', 'system', `webhook:${source}`, { source, payload });
  return NextResponse.json({ ok: true, received: source });
}
