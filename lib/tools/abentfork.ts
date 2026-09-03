import { createHash } from 'node:crypto';
import { audit } from '@/lib/hub/audit';
import { fetchReadable } from '@/lib/tools/webfetch';

// "Send this recipe to A Bent Fork" — POST an external recipe URL to Noah's
// recipe site (noaht425/abentfork), which parses it into a `pending` recipe for
// admin approval. Contract: POST {ABENTFORK_URL}/api/webhook/recipe
//   header  x-webhook-secret: <CALLIAD_WEBHOOK_SECRET>   (same value on the abentfork deploy)
//   body    { capture_id, url, title, notes? }

const SITE = () => (process.env.ABENTFORK_URL || 'https://abentfork.com').replace(/\/$/, '');
export const abentforkShareAvailable = () => Boolean(process.env.CALLIAD_WEBHOOK_SECRET);

const URL_RE = /https?:\/\/[^\s<>"')]+/i;

// explicit only — "share/send/add/put this recipe … to/on a bent fork / abentfork"
export function isRecipeShare(t: string): boolean {
  if (!URL_RE.test(t)) return false;
  return /\b(a[- ]?bent[- ]?fork|abentfork)\b/i.test(t) &&
    /\b(share|send|add|put|post|submit|save)\b.{0,40}\brecipe\b|\brecipe\b.{0,40}\b(to|on|with|into)\b.{0,20}(a[- ]?bent[- ]?fork|abentfork)/i.test(t);
}

export function extractShareUrl(t: string): string | null {
  const m = t.match(URL_RE);
  return m ? m[0].replace(/[.,;:)\]}>"']+$/, '') : null;
}

function normalizeUrl(u: string): string {
  try {
    const url = new URL(u);
    url.hash = '';
    // drop tracking params
    for (const k of [...url.searchParams.keys()]) if (/^utm_|^ref$|^fbclid$|^gclid$/i.test(k)) url.searchParams.delete(k);
    return url.toString().replace(/\/$/, '');
  } catch {
    return u.trim();
  }
}

async function titleFor(url: string): Promise<string> {
  const r = await fetchReadable(url).catch(() => null);
  const t = r?.ok ? (r.title ?? '') : '';
  if (t.trim()) return t.replace(/\s+[|–-]\s+.*$/, '').trim().slice(0, 200); // strip trailing " | Site Name"
  const seg = decodeURIComponent(url.split('?')[0].split('/').filter(Boolean).pop() ?? '')
    .replace(/[-_]+/g, ' ')
    .replace(/\.\w+$/, '')
    .trim();
  return seg ? seg.replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 200) : 'Shared recipe';
}

export interface ShareResult {
  ok: boolean;
  message: string;
}

export async function shareRecipeToAbentfork(rawUrl: string, notes?: string): Promise<ShareResult> {
  if (!abentforkShareAvailable()) {
    return { ok: false, message: "Recipe sharing isn't set up — set CALLIAD_WEBHOOK_SECRET (same value as on A Bent Fork)." };
  }
  const url = normalizeUrl(rawUrl);
  if (!/^https?:\/\//i.test(url)) return { ok: false, message: "That doesn't look like a recipe URL." };

  const title = await titleFor(url);
  const capture_id = `calliad:${createHash('sha1').update(url).digest('hex').slice(0, 24)}`;

  let res: Response;
  try {
    res = await fetch(`${SITE()}/api/webhook/recipe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-webhook-secret': process.env.CALLIAD_WEBHOOK_SECRET! },
      body: JSON.stringify({ capture_id, url, title, notes: notes?.trim() || undefined, submitted_at: new Date().toISOString() }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    return { ok: false, message: "Couldn't reach A Bent Fork — try again in a bit." };
  }

  const j = (await res.json().catch(() => ({}))) as { ok?: boolean; status?: string; slug?: string; error?: string; reason?: string };
  await audit.log('outbound_message', 'calliad', null, { tool: 'abentfork_share', url, http: res.status, status: j.status ?? j.error });

  if (res.status === 503) return { ok: false, message: "A Bent Fork's webhook isn't configured on its side (CALLIAD_WEBHOOK_SECRET missing there)." };
  if (res.status === 401) return { ok: false, message: "Secret mismatch between Calliad and A Bent Fork — the two values don't match." };
  if (!res.ok || !j.ok) return { ok: false, message: `A Bent Fork rejected it (${j.error ?? res.status}).` };

  const link = j.slug ? ` — ${SITE()}/recipes/${j.slug}` : '';
  switch (j.status) {
    case 'created':
      return { ok: true, message: `Parsed and sent to A Bent Fork — it's in your Pending queue for approval${link}.` };
    case 'stub':
      return { ok: true, message: `Sent to A Bent Fork, but it couldn't auto-parse the page — a stub is in Pending for you to fill in${link}.` };
    case 'duplicate':
    case 'duplicate_stub':
      return { ok: true, message: `Already sent that one — it's in your Pending queue${link}.` };
    default:
      return { ok: true, message: `Sent to A Bent Fork${link}.` };
  }
}
