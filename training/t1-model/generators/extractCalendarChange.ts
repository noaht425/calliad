// Task: extract_calendar_change (lib/actions/detect.ts extractCalendarChange).

import { randomDatePhrase } from '../lib/relativeDate.ts';
import { localNowString, TZ } from '../lib/tz.ts';
import { pick, EVENT_TITLES, PLACES } from '../lib/pools.ts';
import type { Example } from './types.ts';

export const SYSTEM = `Noah wants to change or cancel a calendar event. "Now" will be given as a local date/time with a timezone.

Return JSON: {"ok":true|false,"op":"update"|"delete","match":"how Noah refers to the event -- title words plus any day/time he mentions to identify it, e.g. 'standup tomorrow' or 'dentist Friday 2pm'","new_title":null,"new_start":"UTC ISO 8601 or null","new_end":"UTC ISO 8601 or null","new_location":null}
- match is what identifies the EXISTING event, never the new time.
- For "move X to <time>", new_start is that new time (resolve relatives). new_end null unless a new end/duration is stated.
- op="delete" for cancel/delete/remove. ok=false if you can't tell which event.`;

const MATCH_QUALIFIERS = ['tomorrow', 'Friday', 'this week', 'next Tuesday', ''];

export function* generateExtractCalendarChange(now: Date, n: number): Generator<Example> {
  let made = 0;
  while (made < n) {
    const title = pick(EVENT_TITLES);
    const qualifier = pick(MATCH_QUALIFIERS);
    const match = qualifier ? `${title} ${qualifier}` : title;
    const isDelete = made % 3 === 0;
    const vague = made % 11 === 0; // occasional ok:false — can't tell which event

    if (vague) {
      const text = pick(['cancel my meeting', 'move the thing to tomorrow', 'reschedule my appointment']);
      made++;
      yield {
        task: 'extract_calendar_change',
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: `Now is ${localNowString(now)} (${TZ}).\nRequest: "${text}"` },
          { role: 'assistant', content: JSON.stringify({ ok: false, op: 'update', match: null, new_title: null, new_start: null, new_end: null, new_location: null }) },
        ],
      };
      continue;
    }

    if (isDelete) {
      const text = pick([`cancel ${match}`, `delete ${match} from my calendar`, `remove ${match}`, `call off ${match}`]);
      made++;
      yield {
        task: 'extract_calendar_change',
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: `Now is ${localNowString(now)} (${TZ}).\nRequest: "${text}"` },
          { role: 'assistant', content: JSON.stringify({ ok: true, op: 'delete', match, new_title: null, new_start: null, new_end: null, new_location: null }) },
        ],
      };
    } else {
      const r = randomDatePhrase(now);
      const newPlace = Math.random() < 0.25 ? pick(PLACES) : null;
      const text = newPlace
        ? pick([`move ${match} to ${newPlace}`, `change the location of ${match} to ${newPlace}`])
        : pick([`move ${match} to ${r.phrase}`, `push ${match} back to ${r.phrase}`, `reschedule ${match} for ${r.phrase}`, `can you move ${match} to ${r.phrase}`]);
      made++;
      yield {
        task: 'extract_calendar_change',
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: `Now is ${localNowString(now)} (${TZ}).\nRequest: "${text}"` },
          {
            role: 'assistant',
            content: JSON.stringify({
              ok: true, op: 'update', match,
              new_title: null,
              new_start: newPlace ? null : r.iso,
              new_end: null,
              new_location: newPlace,
            }),
          },
        ],
      };
    }
  }
}
