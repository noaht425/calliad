import { enqueueNotification } from '@/lib/hub/notify';
import { upcomingOccasions, cadenceOverdue, markCadenceNudged } from '@/lib/integrations/icloud-contacts';
import { ownerUserIds } from '@/lib/hub/owner';

const CADENCE_LABEL: Record<string, string> = {
  weekly: 'weekly', biweekly: 'every couple of weeks', monthly: 'monthly',
  quarterly: 'every few months', yearly: 'about once a year',
};

async function forUser(userId: string): Promise<number> {
  let n = 0;
  const year = new Date().getFullYear();

  // birthdays / anniversaries — one heads-up ~a week out, one on the day
  for (const o of await upcomingOccasions(userId, 8)) {
    if (o.daysUntil !== 7 && o.daysUntil !== 1 && o.daysUntil !== 0) continue;
    const when = o.daysUntil === 0 ? 'today' : o.daysUntil === 1 ? 'tomorrow' : `${o.date} (a week out)`;
    const r = await enqueueNotification(userId, {
      kind: 'occasion',
      title: o.kind === 'birthday' ? 'Birthday coming up' : 'Anniversary coming up',
      body: `${o.name}'s ${o.kind} is ${when}.`,
      dedupeKey: `occasion:${o.id}:${o.kind}:${year}:${o.daysUntil <= 1 ? 'day' : 'week'}`,
    });
    if (r === 'queued') n++;
  }

  // people you're overdue to reach out to
  for (const c of await cadenceOverdue(userId)) {
    const gap = c.sinceDays ? `It's been ${c.sinceDays} days since you talked to ${c.name}` : `You haven't logged talking to ${c.name} yet`;
    const r = await enqueueNotification(userId, {
      kind: 'cadence',
      title: 'Keep in touch',
      body: `${gap} — you usually catch up ${CADENCE_LABEL[c.cadence] ?? c.cadence}.`,
      dedupeKey: `cadence:${c.id}:${new Date().toISOString().slice(0, 10)}`,
    });
    if (r === 'queued') { await markCadenceNudged(userId, c.id); n++; }
  }
  return n;
}

export async function runPeopleNudges(): Promise<{ enqueued: number }> {
  let enqueued = 0;
  for (const uid of await ownerUserIds()) {
    enqueued += await forUser(uid).catch(() => 0);
  }
  return { enqueued };
}
