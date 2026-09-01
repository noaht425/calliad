import { adminClient } from '@/lib/supabase.server';
import { audit } from '@/lib/hub/audit';
import { scanGmailQuery } from '@/lib/integrations/gmail';

// Detects "you've been unsubscribed" confirmation emails, logs the sender, then
// watches that domain for ~10 days to see whether marketing mail actually stops.

const CONFIRM_RE =
  /\b(you (have|'?ve) (been )?unsubscribed|unsubscribe (successful|confirmed|request received)|you (will|'?ll) no longer receive|removed from (our|the) (mailing )?list|sorry to see you go|opt(ed)?[- ]out (successful|confirmed)|your (email )?preferences? (have|has) been updated)\b/i;

function parseFrom(from: string): { name: string; domain: string } | null {
  const email = from.match(/[\w.+-]+@([\w.-]+\.\w+)/);
  if (!email) return null;
  const domain = email[1].toLowerCase().replace(/^(www\.|email\.|mail\.|e\.|m\.|news\.|newsletter\.|updates?\.|marketing\.|reply\.|noreply\.|no-reply\.)/g, '');
  const nameM = from.match(/^\s*"?([^"<]+?)"?\s*</);
  const name = (nameM?.[1] ?? domain.split('.')[0]).trim();
  return { name, domain };
}

export const isUnsubscribeMention = (t: string) =>
  /\b(i (just )?unsubscribed from|i (took|got) myself off|stop(ped)? getting|unsubscribe(d)? me from)\b/i.test(t);

export async function noteUnsubscribeFromChat(userId: string, text: string): Promise<string | null> {
  const m = text.match(/\bunsubscribed? (myself )?from (the )?(.+?)(?:\s+(?:newsletter|emails?|list|mailing list))?[.!]?\s*$/i);
  const name = m?.[3]?.trim();
  if (!name || name.length < 2) return null;
  const domain = /\.[a-z]{2,}$/i.test(name) ? name.toLowerCase() : `${name.toLowerCase().replace(/[^a-z0-9]+/g, '')}.com`;
  await adminClient.from('unsubscribes').upsert(
    { user_id: userId, sender_name: name.replace(/\.[a-z]{2,}$/i, ''), sender_domain: domain, source: 'chat' },
    { onConflict: 'user_id,sender_domain', ignoreDuplicates: true },
  );
  return `Logged — watching ${domain} for 10 days to confirm it stops.`;
}

/** Scan promo mail for unsubscribe confirmations. */
export async function detectUnsubscribes(userId: string): Promise<number> {
  await scanGmailQuery(userId, 'newer_than:30d category:promotions (unsubscribe OR "opt out" OR "no longer receive" OR "preferences")', 'promo', { max: 25 }).catch(() => ({}));

  const { data: rows } = await adminClient
    .from('email_items')
    .select('from_addr, subject, snippet, body_text, received_at')
    .eq('user_id', userId)
    .eq('label', 'promo')
    .order('received_at', { ascending: false })
    .limit(40);

  let found = 0;
  for (const r of rows ?? []) {
    const hay = `${r.subject ?? ''} ${r.snippet ?? ''} ${(r.body_text ?? '').slice(0, 800)}`;
    if (!CONFIRM_RE.test(hay)) continue;
    const parsed = parseFrom(r.from_addr ?? '');
    if (!parsed) continue;
    const { data: exists } = await adminClient
      .from('unsubscribes').select('id').eq('user_id', userId).eq('sender_domain', parsed.domain).maybeSingle();
    if (exists) continue;
    await adminClient.from('unsubscribes').insert({
      user_id: userId, sender_name: parsed.name, sender_domain: parsed.domain,
      unsubscribed_at: (r.received_at as string | null)?.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
      source: 'email',
    });
    found++;
  }
  if (found) await audit.log('trigger_fired', 'cron', 'unsub_detect', { found });
  return found;
}

/** For each pending row: did marketing mail keep coming? Resolve after watch_days. */
export async function verifyUnsubscribes(userId: string): Promise<void> {
  const { data: rows } = await adminClient
    .from('unsubscribes').select('*').eq('user_id', userId).eq('status', 'pending');
  for (const r of rows ?? []) {
    const since = `${r.unsubscribed_at}`;
    const q = `newer_than:20d category:promotions from:${r.sender_domain} after:${since.replace(/-/g, '/')}`;
    const scan = await scanGmailQuery(userId, q, 'promo', { max: 5 }).catch(() => null);
    const gotMail = scan && !('error' in scan) && scan.captured > 0;

    const daysElapsed = Math.floor((Date.now() - Date.parse(since)) / 86400000);
    const patch: Record<string, unknown> = {};
    if (gotMail) { patch.status = 'still_coming'; patch.last_marketing_at = new Date().toISOString().slice(0, 10); }
    else if (daysElapsed >= (r.watch_days as number)) { patch.status = 'confirmed'; }
    if (Object.keys(patch).length) await adminClient.from('unsubscribes').update(patch).eq('id', r.id);
  }
}

export async function listUnsubscribes(userId: string) {
  const { data } = await adminClient
    .from('unsubscribes')
    .select('id, sender_name, sender_domain, unsubscribed_at, last_marketing_at, watch_days, status')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  return (data ?? []).map((r) => ({
    ...r,
    days_watched: Math.min(r.watch_days as number, Math.max(0, Math.floor((Date.now() - Date.parse(r.unsubscribed_at as string)) / 86400000))),
  }));
}
