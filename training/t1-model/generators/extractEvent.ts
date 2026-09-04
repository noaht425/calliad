// Task: extract_event (lib/actions/detect.ts extractEvent). Ground truth is
// computed, never model-labeled — see lib/relativeDate.ts.

import { randomDatePhrase, noDatePhrase } from '../lib/relativeDate.ts';
import { localNowString, TZ } from '../lib/tz.ts';
import { pick, maybe, EVENT_TITLES, PEOPLE, PLACES } from '../lib/pools.ts';
import type { Example } from './types.ts';

export const SYSTEM = `Pull a single calendar event from this request. "Now" will be given as a local date/time with a timezone. Resolve relative dates/times against that.

Return JSON only:
{"ok": true|false, "title": "short", "start_at": "UTC ISO 8601", "end_at": "UTC ISO 8601 or null", "all_day": false, "location": "or null", "city": "or null"}

ok=false if there's no determinable date/time. If a time is given but no duration, set end_at null. all_day=true only when no clock time is implied. city = the city the location is in ONLY if a well-known venue or a full address makes it unambiguous (e.g. "Climate Pledge Arena" -> "Seattle"); otherwise null.`;

const VERBS = ['add', 'put', 'schedule', 'block off', 'pencil in'];

function userContent(now: Date, text: string): string {
  return `Now is ${localNowString(now)} (${TZ}).\nRequest: "${text}"`;
}

function sentence(title: string, phrase: string, withWho: boolean, place: string | null): string {
  const who = withWho ? ` with ${pick(PEOPLE)}` : '';
  const placeBit = place ? ` at ${place}` : '';
  const templates = [
    () => `add ${title}${who} ${phrase}${placeBit} to my calendar`,
    () => `${pick(VERBS)} ${title}${who}${placeBit} ${phrase}`,
    () => `I have ${title}${who} ${phrase}${placeBit}, put it on my calendar`,
    () => `schedule ${title} ${phrase}${placeBit}`,
    () => `can you add ${title}${who} to my calendar, it's ${phrase}${placeBit}`,
  ];
  return pick(templates)();
}

export function* generateExtractEvent(now: Date, n: number): Generator<Example> {
  let made = 0;
  while (made < n) {
    const negative = made % 5 === 0; // ~20% negative: calendar-shaped ask, no real date
    const title = pick(EVENT_TITLES);
    const withWho = Math.random() < 0.4;
    const place = maybe(PLACES, 0.5);

    if (negative) {
      const text = sentence(title, noDatePhrase(), withWho, place);
      made++;
      yield {
        task: 'extract_event',
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: userContent(now, text) },
          { role: 'assistant', content: JSON.stringify({ ok: false, title: null, start_at: null, end_at: null, all_day: false, location: null, city: null }) },
        ],
      };
      continue;
    }

    const r = randomDatePhrase(now);
    const text = sentence(title, r.phrase, withWho, place);
    made++;
    yield {
      task: 'extract_event',
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: userContent(now, text) },
        {
          role: 'assistant',
          content: JSON.stringify({
            ok: true,
            title: title[0].toUpperCase() + title.slice(1),
            start_at: r.iso,
            end_at: null,
            all_day: r.allDay,
            location: place,
            city: null, // pools' PLACES are never unambiguous venues -> always null
          }),
        },
      ],
    };
  }
}
