import { adminClient } from '@/lib/supabase.server';
import { audit } from '@/lib/hub/audit';
import { t1Json, t1Available } from '@/lib/llm/gemini';

const TZ = process.env.TZ_DEFAULT ?? 'America/New_York';

export type Cadence = 'weekly' | 'monthly' | 'quarterly' | 'yearly';
const CADENCES: Cadence[] = ['weekly', 'monthly', 'quarterly', 'yearly'];
const MONTHLY_FACTOR: Record<Cadence, number> = { weekly: 52 / 12, monthly: 1, quarterly: 1 / 3, yearly: 1 / 12 };

export interface Subscription {
  id: string;
  name: string;
  amount_cents: number;
  currency: string;
  cadence: Cadence;
  next_charge: string | null;
  category: string | null;
  active: boolean;
}

export const isSubscriptionAdd = (t: string) =>
  /\b(i pay|i'?m paying|paying)\b.{0,40}\$?\d/i.test(t) ||
  /\b(add|track|log)\b.{0,20}\b(subscription|recurring (charge|payment)|membership)\b/i.test(t) ||
  /\$\s?\d[\d.,]*\s*(?:\/|per|a|an|each)\s*(?:mo(?:nth)?|yr|year|wk|week|quarter)\b/i.test(t) ||
  /\b(subscri\w+ to|membership (to|for))\b.{0,40}\$?\d/i.test(t);

export const isSubscriptionQuery = (t: string) =>
  /\b(what (subscriptions|am i (paying|subscribed)|do i pay)|my subscriptions|list (my )?subscriptions|how much .{0,30}\b(subscriptions|recurring)|monthly (subscriptions|spend|burn)|recurring (charges|spend))\b/i.test(t);

export interface SubDraft {
  name: string; amount_cents: number; cadence: Cadence; next_charge: string | null; category: string | null;
}

/** One message may describe several recurring charges — pull them all. */
export async function extractSubscriptions(text: string, now = new Date()): Promise<SubDraft[]> {
  if (!t1Available()) return [];
  const localNow = now.toLocaleDateString('en-CA', { timeZone: TZ });
  const out = await t1Json<{
    items?: { name: string | null; amount: number | null; cadence: string | null; next_charge: string | null; category: string | null }[];
  }>(
    'extract_subscriptions',
    `Noah is telling Calliad about recurring payments. Today is ${localNow}.
"${text}"
Return JSON: {"items":[{"name":"service","amount":12.99,"cadence":"weekly|monthly|quarterly|yearly","next_charge":"YYYY-MM-DD or null","category":"streaming|software|news|fitness|finance|utilities|other or null"}]}
- One object per DISTINCT recurring payment. If the message describes several, return several.
- amount = the number only ("$12/mo" → 12 monthly; "$99 a year" → 99 yearly; "50 dollars a month" → 50 monthly).
- next_charge only when a day/date is stated ("the 25th", "the 6th of every month", "renews March 3") → resolve to the next real future date. Else null.
- Skip anything that isn't a recurring payment with a name AND an amount. Empty items array is fine.`,
    { maxOutputTokens: 400 },
  );
  const seen = new Set<string>();
  const drafts: SubDraft[] = [];
  for (const it of out?.items ?? []) {
    if (!it?.name || !it.amount || it.amount <= 0) continue;
    const key = it.name.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    drafts.push({
      name: it.name.trim().slice(0, 80),
      amount_cents: Math.round(it.amount * 100),
      cadence: (CADENCES.includes(it.cadence as Cadence) ? it.cadence : 'monthly') as Cadence,
      next_charge: it.next_charge && !Number.isNaN(Date.parse(it.next_charge)) ? it.next_charge.slice(0, 10) : null,
      category: it.category?.trim() || null,
    });
  }
  return drafts;
}

export async function upsertSubscription(
  userId: string,
  s: { name: string; amount_cents: number; cadence: Cadence; next_charge: string | null; category: string | null },
): Promise<'added' | 'updated'> {
  const { data: existing } = await adminClient
    .from('subscriptions')
    .select('id')
    .eq('user_id', userId)
    .ilike('name', s.name)
    .maybeSingle();
  if (existing) {
    await adminClient.from('subscriptions').update({ ...s, active: true, updated_at: new Date().toISOString() }).eq('id', existing.id);
    return 'updated';
  }
  await adminClient.from('subscriptions').insert({ user_id: userId, ...s, source: 'chat' });
  await audit.log('outbound_message', 'calliad', null, { action: 'subscription_add', name: s.name, cents: s.amount_cents, cadence: s.cadence });
  return 'added';
}

export async function listSubscriptions(userId: string): Promise<Subscription[]> {
  const { data } = await adminClient
    .from('subscriptions')
    .select('id, name, amount_cents, currency, cadence, next_charge, category, active')
    .eq('user_id', userId)
    .eq('active', true)
    .order('amount_cents', { ascending: false });
  return (data ?? []) as Subscription[];
}

export function monthlyTotalCents(subs: Subscription[]): number {
  return Math.round(subs.reduce((sum, s) => sum + s.amount_cents * MONTHLY_FACTOR[s.cadence], 0));
}

const money = (cents: number, currency = 'USD') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);

/** "Spotify $11.99 renews Fri" lines for charges within `days`. */
export async function upcomingCharges(userId: string, days = 5): Promise<string[]> {
  const subs = await listSubscriptions(userId);
  const now = Date.now();
  const horizon = now + days * 86400000;
  return subs
    .filter((s) => s.next_charge && Date.parse(s.next_charge) >= now - 86400000 && Date.parse(s.next_charge) <= horizon)
    .sort((a, b) => Date.parse(a.next_charge!) - Date.parse(b.next_charge!))
    .map((s) => {
      const d = new Date(s.next_charge + 'T12:00:00');
      return `${s.name} ${money(s.amount_cents, s.currency)} renews ${d.toLocaleDateString('en-US', { weekday: 'short', timeZone: TZ })}`;
    });
}

export async function subscriptionsSummary(userId: string): Promise<string> {
  const subs = await listSubscriptions(userId);
  if (!subs.length) return `You're not tracking any subscriptions yet — tell me things like "I pay $12/mo for Spotify".`;
  const lines = subs.map((s) => `- ${s.name}: ${money(s.amount_cents, s.currency)}/${s.cadence.replace('ly', '')}${s.next_charge ? ` · next ${s.next_charge}` : ''}`);
  return `## Tracked subscriptions\n${lines.join('\n')}\n\nRoughly ${money(monthlyTotalCents(subs))}/month (${money(monthlyTotalCents(subs) * 12)}/year). Present this plainly; note the biggest one or two.`;
}
