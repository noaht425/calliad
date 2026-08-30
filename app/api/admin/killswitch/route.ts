import { NextRequest, NextResponse } from 'next/server';
import { config } from '@/lib/hub/config';
import { audit } from '@/lib/hub/audit';
import { checkSecret } from '@/lib/hub/guard';

export const runtime = 'nodejs';

const LEVELS = ['off', 'pause_proactive', 'pause_all'] as const;
type Level = (typeof LEVELS)[number];

export async function POST(req: NextRequest) {
  const denied = checkSecret(req, 'ADMIN_SECRET', ['x-admin-secret']);
  if (denied) return denied;

  let body: { level?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Body must be JSON' }, { status: 400 }); }

  const level = body.level as Level;
  if (!LEVELS.includes(level)) {
    return NextResponse.json({ error: `level must be one of ${LEVELS.join(', ')}` }, { status: 400 });
  }

  const previous = await config.get('killswitch_level');
  await config.set('killswitch_level', level);
  await audit.log('killswitch', 'noah', null, { previous, level });
  return NextResponse.json({ ok: true, previous, level });
}

// Current level — no secret (also in /api/health).
export async function GET() {
  return NextResponse.json({ level: await config.get('killswitch_level') });
}
