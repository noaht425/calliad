// Task: extract_task (lib/actions/task.ts). Own date-phrase logic — the
// production prompt's due_at rule differs from extract_event's ("next week" ->
// the following Monday; default time is always 9am, never inferred).

import { nyWallTimeToUtc, nyNowParts, localNowString, toIso, TZ } from '../lib/tz.ts';
import { pick, TASK_VERBS } from '../lib/pools.ts';
import type { Example } from './types.ts';

export const SYSTEM = `Noah is adding a to-do. "Now" will be given as a local date/time with a timezone.

Return JSON: {"title":"the task, imperative, no date/repeat words","due_at":"UTC ISO 8601 at a sensible time (default 9am local) or null","recur":"daily|weekdays|weekly|biweekly|monthly or null"}
- due_at: null unless a day/deadline is clearly stated ("tomorrow", "Friday", "by the 15th", "next week" -> the following Monday). For a repeating task, due_at = the FIRST occurrence.
- recur: set only if it clearly repeats ("every day", "every Monday" -> weekly, "every other week" -> biweekly, "monthly"/"every month" -> monthly, "weekdays" -> weekdays). Otherwise null.`;

function addDays(y: number, mo0: number, d: number, delta: number) {
  const t = new Date(Date.UTC(y, mo0, d + delta, 12));
  return { y: t.getUTCFullYear(), mo0: t.getUTCMonth(), d: t.getUTCDate() };
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

interface DuePhrase { phrase: string; iso: string | null }

function dueDatePhrase(now: Date): DuePhrase {
  const { y, mo0, d, dow } = nyNowParts(now);
  const kind = Math.floor(Math.random() * 6);
  switch (kind) {
    case 0: return { phrase: 'tomorrow', iso: iso9am(addDays(y, mo0, d, 1)) };
    case 1: { const n = 2 + Math.floor(Math.random() * 5); return { phrase: `in ${n} days`, iso: iso9am(addDays(y, mo0, d, n)) }; }
    case 2: { // by <weekday> -> that weekday, 1-7 days out
      const target = Math.floor(Math.random() * 7);
      const delta = ((target - dow + 7) % 7) || 7;
      return { phrase: `by ${WEEKDAYS[target]}`, iso: iso9am(addDays(y, mo0, d, delta)) };
    }
    case 3: { // by the Nth
      const dom = 1 + Math.floor(Math.random() * 28);
      let tmo = mo0, ty = y;
      if (dom <= d) { tmo += 1; if (tmo > 11) { tmo = 0; ty += 1; } }
      return { phrase: `by the ${dom}th`, iso: iso9am({ y: ty, mo0: tmo, d: dom }) };
    }
    case 4: { // next week -> the following Monday (per the production prompt's explicit rule)
      const deltaToNextMon = ((1 - dow + 7) % 7) || 7;
      const t = addDays(y, mo0, d, deltaToNextMon);
      return { phrase: 'next week', iso: iso9am(t) };
    }
    default: return { phrase: '', iso: null }; // no date stated
  }
  function iso9am(t: { y: number; mo0: number; d: number }) { return toIso(nyWallTimeToUtc(t.y, t.mo0, t.d, 9, 0)); }
}

const RECUR = [
  { phrase: 'every day', recur: 'daily' },
  { phrase: 'daily', recur: 'daily' },
  { phrase: 'every weekday', recur: 'weekdays' },
  { phrase: 'on weekdays', recur: 'weekdays' },
  { phrase: 'every Monday', recur: 'weekly' },
  { phrase: 'every Friday', recur: 'weekly' },
  { phrase: 'weekly', recur: 'weekly' },
  { phrase: 'every other week', recur: 'biweekly' },
  { phrase: 'biweekly', recur: 'biweekly' },
  { phrase: 'every month', recur: 'monthly' },
  { phrase: 'monthly', recur: 'monthly' },
];

export function* generateExtractTask(now: Date, n: number): Generator<Example> {
  let made = 0;
  while (made < n) {
    const verb = pick(TASK_VERBS);
    const mode = made % 3; // cycle: plain / dated / recurring
    let text: string; let due_at: string | null; let recur: string | null;

    if (mode === 0) {
      text = pick([`remind me to ${verb}`, `add ${verb} to my to-do list`, `put ${verb} on my list`]);
      due_at = null; recur = null;
    } else if (mode === 1) {
      const dp = dueDatePhrase(now);
      if (!dp.iso) { text = `remind me to ${verb}`; due_at = null; recur = null; }
      else {
        text = pick([`remind me to ${verb} ${dp.phrase}`, `${verb} ${dp.phrase}`, `add ${verb} to my to-do list, ${dp.phrase}`]);
        due_at = dp.iso; recur = null;
      }
    } else {
      const r = pick(RECUR);
      text = pick([`${r.phrase}: ${verb}`, `remind me to ${verb} ${r.phrase}`, `I need to ${verb} ${r.phrase}`]);
      recur = r.recur;
      // first occurrence: today if not yet 9am-passed-ish, else the next matching day — keep simple, use today
      const { y, mo0, d } = nyNowParts(now);
      due_at = toIso(nyWallTimeToUtc(y, mo0, d, 9, 0));
    }

    made++;
    yield {
      task: 'extract_task',
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: `Now is ${localNowString(now)} (${TZ}).\n"${text}"` },
        { role: 'assistant', content: JSON.stringify({ title: verb[0].toUpperCase() + verb.slice(1), due_at, recur }) },
      ],
    };
  }
}
