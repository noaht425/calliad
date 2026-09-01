import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase.server';
import { audit } from '@/lib/hub/audit';
import { config } from '@/lib/hub/config';
import { checkSecret } from '@/lib/hub/guard';
import { sendPush } from '@/lib/hub/push';
import { composeBrief } from '@/lib/brief/compose';
import { syncCalendarEvents, recentCalendarChanges } from '@/lib/integrations/icloud-calendar';
import { syncContacts } from '@/lib/integrations/icloud-contacts';
import { scanGmailLabel } from '@/lib/integrations/gmail';
import { medCheckin } from '@/lib/health/meds';
import { scanForTidy } from '@/lib/memory/tidy';
import { upcomingCharges } from '@/lib/money/subscriptions';
import { riddleOfTheDay } from '@/lib/games/play';
import { refreshWatchAirDates, watchContextLine } from '@/lib/tools/watchlist';

export const runtime = 'nodejs';
export const maxDuration = 120;

const TZ = process.env.TZ_DEFAULT ?? 'America/New_York';

async function handle(req: NextRequest) {
  const denied = checkSecret(req, 'CRON_SECRET', ['x-cron-secret']);
  if (denied) return denied;

  // Kill switch: proactive output is suppressed under pause_proactive and pause_all.
  const kill = await config.get('killswitch_level');
  if (kill === 'pause_all' || kill === 'pause_proactive') {
    await audit.log('trigger_fired', 'cron', 'brief', { skipped: `killswitch ${kill}` });
    return NextResponse.json({ ok: true, skipped: `killswitch ${kill}` });
  }

  // Quiet hours 1–7am local (belt-and-suspenders; the cron time already clears it).
  const hour = parseInt(new Date().toLocaleString('en-US', { timeZone: TZ, hour: 'numeric', hour12: false }).replace(/\D/g, ''), 10);
  if (hour >= 1 && hour < 7) {
    await audit.log('trigger_fired', 'cron', 'brief', { skipped: 'quiet hours' });
    return NextResponse.json({ ok: true, skipped: 'quiet hours' });
  }

  // Everyone with any connected service or synced schedule gets a brief. Phase 0/1
  // is single-user, but this generalises.
  const { data: svc } = await adminClient.from('connected_services').select('user_id, service');
  const { data: sched } = await adminClient.from('calendar_events').select('user_id').eq('source', 'schedule').limit(1000);
  const userIds = [...new Set([...(svc ?? []), ...(sched ?? [])].map((r) => r.user_id))];
  const svcByUser = new Map<string, Set<string>>();
  for (const s of svc ?? []) {
    if (!svcByUser.has(s.user_id)) svcByUser.set(s.user_id, new Set());
    svcByUser.get(s.user_id)!.add(s.service);
  }

  const results: Record<string, unknown>[] = [];
  for (const userId of userIds) {
    try {
      // Freshen the calendar/mail first so the brief sees today's state
      // (folded in — Hobby-plan cron limit means we run one morning job).
      const s = svcByUser.get(userId) ?? new Set<string>();
      if (s.has('icloud_calendar')) {
        await syncCalendarEvents(userId).catch(() => {});
        await syncContacts(userId).catch(() => {});
      }
      if (s.has('gmail')) await scanGmailLabel(userId).catch(() => {});

      // Morning medication check-in (its own push). medCheckin self-limits to
      // 2 sends/day and skips if already taken, so the 2pm nudge cron's
      // follow-up call stays the intended second touch — no double reminder.
      const med = await medCheckin(userId, { followUp: false }).catch((e) => ({ sent: false, reason: String(e) }));

      await refreshWatchAirDates(userId).catch(() => 0);
      const [tidyCount, calChanges, charges, pendingFacts, airing] = await Promise.all([
        scanForTidy(userId).then((x) => x.length).catch(() => 0),
        recentCalendarChanges(userId).catch(() => [] as string[]),
        upcomingCharges(userId).catch(() => [] as string[]),
        adminClient.from('profile_facts').select('id', { count: 'exact', head: true })
          .eq('user_id', userId).eq('confirmed', false).eq('source', 'chat')
          .then((r) => r.count ?? 0, () => 0),
        watchContextLine(userId).catch(() => [] as string[]),
      ]);
      const notes: string[] = [];
      if (calChanges.length) {
        notes.push(`Calendar changed since yesterday: ${calChanges.join('; ')}. Mention the relevant ones near the schedule, briefly.`);
      }
      if (charges.length) {
        notes.push(`Subscriptions renewing in the next few days: ${charges.join('; ')}. One short line if relevant.`);
      }
      if (airing.length) {
        notes.push(`From Noah's watch list, airing soon: ${airing.join('; ')}. Mention if it lands in the next few days.`);
      }
      if (tidyCount) {
        notes.push(`Housekeeping: ${tidyCount} possible duplicate/stale item${tidyCount === 1 ? '' : 's'} in Noah's lists. End the brief with one short line telling him to say "tidy" to review them.`);
      }
      if (pendingFacts) {
        notes.push(`I've picked up ${pendingFacts} thing${pendingFacts === 1 ? '' : 's'} about Noah from recent chats that he hasn't confirmed. One short line: Settings → "Learned about me" to keep or drop them.`);
      }
      const riddle = riddleOfTheDay();
      notes.push(`Riddle of the day — end the brief with exactly this line, verbatim, no answer: Riddle: ${riddle.q}`);
      const addendum = notes.join('\n\n');

      const brief = await composeBrief(userId, 'scheduled', { addendum });
      if (brief.deferred) { results.push({ userId, deferred: true, med }); continue; }
      // seed the riddle on the brief thread so a guess/reveal there lands
      await adminClient.from('conversations')
        .update({ mode_state: { riddle: { id: riddle.id, revealed: false, at: Date.now() } } })
        .eq('id', brief.conversationId)
        .then(() => {}, () => {});
      const push = await sendPush(userId, {
        title: 'Morning brief',
        body: brief.text.slice(0, 160),
        url: '/',
        tag: 'brief',
      });
      results.push({ userId, costUsd: brief.costUsd, pushed: push.sent, med });
    } catch (err) {
      console.error('[cron/brief]', userId, err);
      await audit.log('error', 'system', 'brief', { userId, message: String(err) });
      results.push({ userId, error: String(err) });
    }
  }

  await audit.log('trigger_fired', 'cron', 'brief', { at: new Date().toISOString(), users: results.length, results });
  return NextResponse.json({ ok: true, users: results.length, results });
}

export const GET = handle;  // Vercel Cron
export const POST = handle;  // external pinger
