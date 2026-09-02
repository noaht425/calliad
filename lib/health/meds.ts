import { adminClient } from '@/lib/supabase.server';
import { audit } from '@/lib/hub/audit';
import { notifyUser } from '@/lib/hub/notify';
import { signAction } from '@/lib/hub/push-token';

// Active daily medication check-in. Persona: "a light spoken check-in lands
// better than a reminder that needs a tick." Max two pushes a day; after that
// the brain may raise it once, gently, then let it go.

const TZ = process.env.TZ_DEFAULT ?? 'America/New_York';
const MAX_SENDS = 2;

function today(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: TZ }); // YYYY-MM-DD local
}

interface MedRow {
  day: string;
  sent_count: number;
  last_sent_at: string | null;
  taken: boolean;
  taken_at: string | null;
  note: string | null;
}

async function getRow(userId: string): Promise<MedRow | null> {
  const { data } = await adminClient
    .from('med_log')
    .select('day, sent_count, last_sent_at, taken, taken_at, note')
    .eq('user_id', userId)
    .eq('day', today())
    .maybeSingle();
  return (data as MedRow) ?? null;
}

/**
 * Send a check-in push if one's warranted. `followUp` allows a second send when
 * the first went unanswered; without it, only the first send of the day fires.
 */
export async function medCheckin(
  userId: string,
  opts: { followUp?: boolean } = {},
): Promise<{ sent: boolean; reason: string }> {
  const row = await getRow(userId);
  if (row?.taken) return { sent: false, reason: 'already confirmed today' };
  const sent = row?.sent_count ?? 0;
  if (sent >= MAX_SENDS) return { sent: false, reason: 'already asked twice today' };
  if (sent >= 1 && !opts.followUp) return { sent: false, reason: 'already asked once today' };

  const body =
    sent === 0
      ? 'Did you take your meds today?'
      : 'Still checking — meds today? (last one, then I’ll drop it)';
  const push = await notifyUser(userId, {
    title: 'Meds',
    body,
    url: '/',
    tag: 'meds',
    actions: [
      { action: 'med-took', title: 'Took them' },
      { action: 'med-not-yet', title: 'Not yet' },
    ],
    actionToken: signAction(userId, 'med'),
  });

  await adminClient.from('med_log').upsert(
    {
      user_id: userId,
      day: today(),
      sent_count: sent + 1,
      last_sent_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,day' },
  );
  await audit.log('outbound_message', 'calliad', null, { kind: 'med_checkin', send: sent + 1, pushed: push.push });
  return { sent: true, reason: `checkin #${sent + 1}` };
}

/** Noah answered — in chat or via a notification action. */
export async function recordMed(userId: string, taken: boolean, note?: string): Promise<void> {
  await adminClient.from('med_log').upsert(
    {
      user_id: userId,
      day: today(),
      taken,
      taken_at: taken ? new Date().toISOString() : null,
      note: note ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,day' },
  );
  await audit.log('inbound_message', 'noah', null, { kind: 'med_response', taken, note });
}

// "took my meds" / "yes I did" (in context) / "not yet" / "forgot"
const TOOK = /\b(took (my |the )?(meds?|medication|pills?)|had my (meds?|medication)|meds? (are )?(done|taken)|yeah?,? took (them|it)|already took (them|my meds))\b/i;
const NOT_YET = /\b(not yet|haven'?t (taken|had|done).{0,20}(meds?|medication|it|them)|still need to.{0,15}(meds?|medication)|forgot (my |to take ).{0,15}(meds?|medication|it|them)|no,? not yet)\b/i;

export function classifyMedReply(text: string): 'took' | 'not-yet' | null {
  if (TOOK.test(text)) return 'took';
  if (NOT_YET.test(text)) return 'not-yet';
  return null;
}

/** A line for the brain about where today's check-in stands, or '' if settled/untouched. */
export async function medContextLine(userId: string): Promise<string> {
  const row = await getRow(userId);
  if (!row || row.taken) return '';
  if ((row.sent_count ?? 0) === 0) return '';
  const asked = row.last_sent_at
    ? new Date(row.last_sent_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TZ })
    : 'earlier';
  return (
    `## Medication\nNoah was asked about his daily meds at ${asked} and hasn't confirmed` +
    `${row.note ? ` (he said: "${row.note}")` : ''}. If the conversation gives a natural opening, ` +
    `a light "did you get your meds?" is welcome — once. Don't force it, don't repeat it if he's brushed it off, ` +
    `and never treat an Apple Reminders checkbox as the answer.`
  );
}
