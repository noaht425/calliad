// Generates a relative-date phrase paired with its PROVABLY correct resolved
// datetime (or "no date" for negative examples). This is the ground truth for
// every date-extraction task — no model ever labels these, arithmetic does.
//
// Resolution conventions (chosen for consistency, not "the" universal truth —
// what matters is the model learns ONE stable rule):
//  - a bare or "next"/"this" weekday name -> the closest occurrence strictly
//    after today (1-7 days out; never today, never a second week out)
//  - "the Nth" -> that day-of-month, this month if not yet passed, else next
//  - no explicit time -> all_day (matches the prompt: "all_day=true only
//    when no clock time is implied")

import { nyWallTimeToUtc, nyNowParts, toIso } from './tz.ts';

export interface ResolvedDate {
  phrase: string;      // "next Friday at 3pm"
  iso: string | null;  // UTC ISO, or null if this phrase has no date (negative case)
  allDay: boolean;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function daysUntilWeekday(fromDow: number, targetDow: number): number {
  const d = (targetDow - fromDow + 7) % 7;
  return d === 0 ? 7 : d; // "Friday" said on a Friday -> next Friday, not today
}

interface TimeSpec { h: number; min: number; label: string }
const TIME_SPECS: TimeSpec[] = [
  { h: 9, min: 0, label: 'at 9am' },
  { h: 9, min: 30, label: 'at 9:30' },
  { h: 12, min: 0, label: 'at noon' },
  { h: 13, min: 0, label: 'at 1' },
  { h: 15, min: 0, label: 'at 3pm' },
  { h: 15, min: 30, label: 'at 3:30pm' },
  { h: 18, min: 0, label: 'at 6' },
  { h: 19, min: 0, label: 'at 7pm' },
  { h: 20, min: 30, label: 'at 8:30' },
];
const PART_OF_DAY: { h: number; min: number; label: string }[] = [
  { h: 9, min: 0, label: 'in the morning' },
  { h: 14, min: 0, label: 'in the afternoon' },
  { h: 19, min: 0, label: 'in the evening' },
  { h: 19, min: 0, label: 'tonight' },
];

function withTime(baseLabel: string, y: number, mo0: number, d: number, opts: { forceTime?: boolean; allowNoTime?: boolean } = {}): ResolvedDate {
  const r = Math.random();
  if (opts.allowNoTime !== false && r < 0.3 && !opts.forceTime) {
    return { phrase: baseLabel, iso: toIso(nyWallTimeToUtc(y, mo0, d, 12, 0)), allDay: true };
  }
  if (r < 0.6) {
    const t = TIME_SPECS[Math.floor(Math.random() * TIME_SPECS.length)];
    return { phrase: `${baseLabel} ${t.label}`, iso: toIso(nyWallTimeToUtc(y, mo0, d, t.h, t.min)), allDay: false };
  }
  const p = PART_OF_DAY[Math.floor(Math.random() * PART_OF_DAY.length)];
  return { phrase: `${baseLabel} ${p.label}`, iso: toIso(nyWallTimeToUtc(y, mo0, d, p.h, p.min)), allDay: false };
}

function addDays(y: number, mo0: number, d: number, delta: number): { y: number; mo0: number; d: number } {
  const t = new Date(Date.UTC(y, mo0, d + delta, 12));
  return { y: t.getUTCFullYear(), mo0: t.getUTCMonth(), d: t.getUTCDate() };
}

/** One randomly-chosen relative-date phrase, resolved against `now`. */
export function randomDatePhrase(now: Date): ResolvedDate {
  const { y, mo0, d, dow } = nyNowParts(now);
  const kind = Math.floor(Math.random() * 9);

  switch (kind) {
    case 0: // today / tonight
      return withTime('today', y, mo0, d, { allowNoTime: true });
    case 1: { // tomorrow
      const t = addDays(y, mo0, d, 1);
      return withTime('tomorrow', t.y, t.mo0, t.d);
    }
    case 2: { // in N days
      const n = 2 + Math.floor(Math.random() * 5); // 2-6
      const t = addDays(y, mo0, d, n);
      return withTime(`in ${n} days`, t.y, t.mo0, t.d);
    }
    case 3: case 4: { // <weekday> / next <weekday> (same resolution, see header)
      const target = Math.floor(Math.random() * 7);
      const delta = daysUntilWeekday(dow, target);
      const t = addDays(y, mo0, d, delta);
      const lead = kind === 4 ? 'next' : Math.random() < 0.4 ? 'this' : '';
      return withTime(`${lead} ${WEEKDAYS[target]}`.trim(), t.y, t.mo0, t.d);
    }
    case 5: { // the Nth of the month
      const dom = 1 + Math.floor(Math.random() * 28);
      let targetMo0 = mo0;
      let targetY = y;
      if (dom <= d) { targetMo0 += 1; if (targetMo0 > 11) { targetMo0 = 0; targetY += 1; } }
      const ord = dom === 1 || dom === 21 ? 'st' : dom === 2 || dom === 22 ? 'nd' : dom === 3 || dom === 23 ? 'rd' : 'th';
      return withTime(`the ${dom}${ord}`, targetY, targetMo0, dom);
    }
    case 6: { // in a/two/three week(s)
      const weeks = 1 + Math.floor(Math.random() * 3);
      const t = addDays(y, mo0, d, weeks * 7);
      const label = weeks === 1 ? 'in a week' : `in ${weeks} weeks`;
      return withTime(label, t.y, t.mo0, t.d);
    }
    case 7: { // next week (treated as +7, same weekday)
      const t = addDays(y, mo0, d, 7);
      return withTime('next week', t.y, t.mo0, t.d);
    }
    default: { // this weekend -> the coming Saturday
      const delta = daysUntilWeekday(dow, 6);
      const t = addDays(y, mo0, d, delta);
      return withTime('this weekend', t.y, t.mo0, t.d);
    }
  }
}

/** A phrase carrying no determinable date — the ok:false / negative case. */
export function noDatePhrase(): string {
  const opts = [
    'sometime soon', 'at some point', 'eventually', 'one of these days',
    'when I get a chance', 'soon', 'sometime', 'whenever works',
  ];
  return opts[Math.floor(Math.random() * opts.length)];
}
