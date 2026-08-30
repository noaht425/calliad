import { NextRequest, NextResponse } from 'next/server';
import { audit } from '@/lib/hub/audit';
import { checkSecret } from '@/lib/hub/guard';

export const runtime = 'nodejs';

// Phase 0: acknowledge + log only. No processing until Phase 1 wires real sources.
export async function POST(req: NextRequest, ctx: { params: Promise<{ source: string }> }) {
  const denied = checkSecret(req, 'WEBHOOK_SECRET', ['x-webhook-secret']);
  if (denied) return denied;

  const { source } = await ctx.params;
  let payload: unknown = null;
  try { payload = await req.json(); } catch { /* non-JSON bodies allowed */ }

  await audit.log('trigger_fired', 'system', `webhook:${source}`, { source, payload });
  return NextResponse.json({ ok: true, received: source });
}
