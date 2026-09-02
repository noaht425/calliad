import { adminClient } from '@/lib/supabase.server';
import { enqueueNotification } from '@/lib/hub/notify';

// Rule-based proactive nudges the tick worker evaluates each cycle. Each rule
// reads existing data and enqueues a notification (de-duped, quiet-hours aware).
// Start small; new rules slot in here.

const TZ = process.env.TZ_DEFAULT ?? 'America/New_York';

function rollForward(dateStr: string, cadence: string, notBefore: string): string {
  const d = new Date(`${dateStr}T12:00:00`);
  const step = () => {
    if (cadence === 'weekly') d.setDate(d.getDate() + 7);
    else if (cadence === 'quarterly') d.setMonth(d.getMonth() + 3);
    else if (cadence === 'yearly') d.setFullYear(d.getFullYear() + 1);
    else d.setMonth(d.getMonth() + 1);
  };
  let guard = 0;
  while (d.toISOString().slice(0, 10) <= notBefore && guard++ < 60) step();
  return d.toISOString().slice(0, 10);
}

/** "Spotify ($11.99) renews tomorrow." — one heads-up per charge, then the
 *  next_charge date is rolled forward so it stays live for the next cycle. */
async function subscriptionRenewals(): Promise<number> {
  const today = new Date(new Date().toLocaleString('en-US', { timeZone: TZ })).toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

  const { data } = await adminClient
    .from('subscriptions')
    .select('id, user_id, name, amount_cents, currency, cadence, next_charge')
    .eq('active', true)
    .not('next_charge', 'is', null)
    .lte('next_charge', tomorrow);

  let n = 0;
  for (const s of data ?? []) {
    const nc = s.next_charge as string;
    if (nc >= today) {
      const when = nc === today ? 'today' : 'tomorrow';
      const amt = (Number(s.amount_cents) / 100).toLocaleString('en-US', {
        style: 'currency', currency: (s.currency as string) || 'USD',
      });
      const r = await enqueueNotification(s.user_id as string, {
        kind: 'subscription',
        title: 'Subscription renews',
        body: `${s.name} — ${amt} ${when}.`,
        dedupeKey: `sub:${s.id}:${nc}`,
      });
      if (r === 'queued') n++;
    }
    await adminClient
      .from('subscriptions')
      .update({ next_charge: rollForward(nc, String(s.cadence), today), updated_at: new Date().toISOString() })
      .eq('id', s.id);
  }
  return n;
}

export async function runEventNudges(): Promise<{ enqueued: number }> {
  let enqueued = 0;
  try {
    enqueued += await subscriptionRenewals();
  } catch (err) {
    console.error('[events] subscriptionRenewals', err);
  }
  return { enqueued };
}
