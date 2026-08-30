import { NextRequest, NextResponse } from 'next/server';

/**
 * Constant-ish secret check that FAILS CLOSED: if the expected env var is unset
 * or empty, every request is rejected (never let a missing secret mean "open").
 * Accepts the secret via any of the given headers; for CRON also `Authorization: Bearer`.
 */
export function checkSecret(
  req: NextRequest,
  envVar: 'ADMIN_SECRET' | 'WEBHOOK_SECRET' | 'CRON_SECRET',
  headers: string[],
): NextResponse | null {
  const expected = process.env[envVar];
  if (!expected) {
    console.error(`[guard] ${envVar} is not set — rejecting request (fail closed)`);
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 503 });
  }
  const presented = new Set<string>();
  for (const h of headers) {
    const v = req.headers.get(h);
    if (v) presented.add(v);
  }
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (bearer) presented.add(bearer);

  return presented.has(expected) ? null : NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}
