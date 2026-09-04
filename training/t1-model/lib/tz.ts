// NY-wall-clock <-> UTC conversion, DST-correct. Standalone (no Next.js/app
// imports) so this training project can run outside the app's build graph.

export const TZ = 'America/New_York';

/** Local wall-clock components (NY) -> the correct UTC instant, DST-aware. */
export function nyWallTimeToUtc(y: number, mo0: number, d: number, h: number, min: number): Date {
  // Guess UTC == the wall-clock numbers, then measure how far that guess's NY
  // rendering is from the target and correct — two passes converges even
  // across a DST transition.
  let guess = Date.UTC(y, mo0, d, h, min);
  for (let i = 0; i < 2; i++) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(new Date(guess));
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    const seenUtcIfLocal = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') === 24 ? 0 : get('hour'), get('minute'));
    const wantUtcIfLocal = Date.UTC(y, mo0, d, h, min);
    guess += wantUtcIfLocal - seenUtcIfLocal;
  }
  return new Date(guess);
}

/** The current instant's NY wall-clock components. */
export function nyNowParts(now: Date): { y: number; mo0: number; d: number; h: number; min: number; dow: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short',
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const dowMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    y: Number(get('year')), mo0: Number(get('month')) - 1, d: Number(get('day')),
    h: Number(get('hour')) === 24 ? 0 : Number(get('hour')), min: Number(get('minute')),
    dow: dowMap[get('weekday')] ?? now.getUTCDay(),
  };
}

/** Mirrors detect.ts's `now.toLocaleString('en-US', { timeZone: TZ })` — the
 *  exact "Now is ${localNow}" string these prompts are trained to see. */
export function localNowString(now: Date): string {
  return now.toLocaleString('en-US', { timeZone: TZ });
}

export function toIso(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}
