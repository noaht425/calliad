import { NextRequest, NextResponse } from 'next/server';
import { verifyAction } from '@/lib/hub/push-token';
import { recordMed } from '@/lib/health/meds';
import { audit } from '@/lib/hub/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Hit by the service worker when a notification action button is tapped. No
// session — auth is the signed token that was baked into the push payload.
export async function POST(req: NextRequest) {
  const { token, action } = (await req.json().catch(() => ({}))) as { token?: string; action?: string };
  const v = token ? verifyAction(token) : null;
  if (!v) return NextResponse.json({ ok: false, message: 'That button expired — open the app.' }, { status: 401 });

  await audit.log('inbound_message', 'noah', null, { via: 'push_action', kind: v.kind, action });

  if (v.kind === 'med') {
    if (action === 'med-took') {
      await recordMed(v.userId, true);
      return NextResponse.json({ ok: true, message: 'Logged — meds taken. 👍' });
    }
    if (action === 'med-not-yet') {
      await recordMed(v.userId, false, 'not yet');
      return NextResponse.json({ ok: true, message: 'Okay — I’ll check once more later, then leave it.' });
    }
  }

  return NextResponse.json({ ok: true, message: 'Got it.' });
}
