// Calliad hub — app/api/admin/killswitch/route.ts (draft, 2026-08-30)
// POST /api/admin/killswitch — set the global pause level.
// Design: specs/hub-skeleton.md §7. Companion to router-route.ts (which reads it)
// and health-route.ts (which reports it) — the three only make sense together.
//
// TODO on drop-in: import real config + audit helpers from the fork.

import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

declare const config: { get(key: string): Promise<string>; set(key: string, value: string): Promise<void> };
declare const audit: { log(kind: string, actor: string, ref: string | null, payload: unknown): Promise<void> };

const LEVELS = ['off', 'pause_proactive', 'pause_all'] as const;
type Level = (typeof LEVELS)[number];

export async function POST(req: NextRequest) {
  if (req.headers.get('x-admin-secret') !== process.env.ADMIN_SECRET) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: { level?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Body must be JSON' }, { status: 400 });
  }

  const level = body.level as Level;
  if (!LEVELS.includes(level)) {
    return NextResponse.json({ error: `level must be one of ${LEVELS.join(', ')}` }, { status: 400 });
  }

  const previous = await config.get('killswitch_level');
  await config.set('killswitch_level', level);
  await audit.log('killswitch', 'noah', null, { previous, level });

  return NextResponse.json({ ok: true, previous, level });
}

// Also expose current level over GET for convenience (no secret needed — it's in /health too).
export async function GET() {
  return NextResponse.json({ level: await config.get('killswitch_level') });
}
