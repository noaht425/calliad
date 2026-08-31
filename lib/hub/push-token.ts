import crypto from 'node:crypto';

// Signed, short-lived token embedded in a push payload so a notification action
// button can hit /api/push/action without a logged-in session. HMAC over
// {user, kind, exp} with CRON_SECRET (already present in the environment).

function secret(): string {
  const s = process.env.CRON_SECRET;
  if (!s) throw new Error('CRON_SECRET not set — cannot sign push actions');
  return s;
}

export function signAction(userId: string, kind: string, ttlSec = 36 * 3600): string {
  const body = Buffer.from(
    JSON.stringify({ u: userId, k: kind, exp: Math.floor(Date.now() / 1000) + ttlSec }),
  ).toString('base64url');
  const sig = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyAction(token: string): { userId: string; kind: string } | null {
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expect = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString()) as { u?: string; k?: string; exp?: number };
    if (!p.u || !p.k || typeof p.exp !== 'number' || p.exp < Math.floor(Date.now() / 1000)) return null;
    return { userId: p.u, kind: p.k };
  } catch {
    return null;
  }
}
