// Chat intent for watchers. Kept deliberately narrow so it doesn't collide with
// the TV/film watch list ("add X to my watch list") or normal conversation.

const URL_RE = /https?:\/\/[^\s<>"')]+/i;

// "watch this page", "keep an eye on <url>", "let me know if <url> changes",
// "tell me when <url> updates", "watch <url> for a price drop"
const PAGE_VERB =
  /\b(watch|keep an eye on|keep tabs on|monitor|track|let me know (if|when)|tell me (if|when)|ping me (if|when)|notify me (if|when)|alert me (if|when))\b/i;
const PAGE_OBJ = /\b(this|that|the)\s+(page|site|website|url|link|listing)\b/i;
const PAGE_CHANGE = /\b(change|changes|updates?|update|new|drops?|goes? (on sale|down|up|back)|back in stock|available|posts?)\b/i;

export function isWatchPageAdd(t: string): boolean {
  if (!PAGE_VERB.test(t)) return false;
  const hasUrl = URL_RE.test(t);
  if (hasUrl && PAGE_CHANGE.test(t)) return true;
  if (hasUrl && /\b(watch|monitor|track|keep an eye|keep tabs)\b/i.test(t)) return true;
  if (PAGE_OBJ.test(t) && (PAGE_CHANGE.test(t) || /\b(watch|monitor|track)\b/i.test(t))) return true;
  return false;
}

/** Pull the URL and the "for what" out of a page-watch request. */
export function extractPageWatch(t: string): { url: string; forWhat: string | null } | null {
  const m = t.match(URL_RE);
  if (!m) return null;
  const url = m[0].replace(/[.,;:)\]}>"']+$/, '');
  const forMatch = t.match(/\bfor\s+(?:a\s+|any\s+|the\s+)?(.+?)(?:[.?!]|$)/i);
  let forWhat = forMatch?.[1]?.trim() ?? null;
  if (forWhat && (forWhat.length < 3 || forWhat.length > 120)) forWhat = null;
  if (!forWhat && /\bprice|sale|stock|discount|cheaper\b/i.test(t)) forWhat = 'a price change or coming back in stock';
  return { url, forWhat };
}

// "tell me if it rains", "warn me about rain this week", "let me know if the
// weather turns", "watch the weather for my <event/day>"
const WEATHER_WATCH =
  /\b(rain|snow|storm|weather|forecast|precipitation|downpour|thunder|sleet|hail)(s|ing)?\b/i;
const WX_STRONG =
  /\b(watch|keep an eye on|keep tabs on|monitor|warn me|alert me|notify me|heads?[- ]?up)\b/i;
const WX_WEAK = /\b(let me know|tell me|ping me)\b/i;

export function isWeatherWatchAdd(t: string): boolean {
  if (!WEATHER_WATCH.test(t)) return false;
  if (/\bwhat('?s| is)\b.*\b(weather|forecast)\b/i.test(t)) return false; // a plain forecast question
  if (WX_STRONG.test(t)) return true;
  return WX_WEAK.test(t) && /\b(if|when)\b/i.test(t);
}

export function extractWeatherWatch(t: string): { days: number; label: string } {
  const weekend = /\bweekend\b/i.test(t);
  let days = 3;
  if (/\b(this|next|the) week\b/i.test(t)) days = 7;
  else if (weekend) days = 4;
  else if (/\btomorrow\b/i.test(t)) days = 2;
  else if (/\btoday|tonight\b/i.test(t)) days = 1;
  const n = t.match(/\bnext (\d+) ?days?\b/i);
  if (n) days = Math.max(1, Math.min(14, parseInt(n[1], 10)));
  const label =
    weekend ? 'Rain over the weekend’s plans'
    : days <= 1 ? 'Rain over today’s plans'
    : days <= 2 ? 'Rain over tomorrow’s plans'
    : days >= 7 ? 'Rain over this week’s calendar'
    : `Rain over the next ${days} days`;
  return { days, label };
}

// "watch my flight AA123 friday", "track flight UA 456", "let me know if my
// flight DL9 is delayed"
const FLIGHT_STOPWORDS = /^(on|at|in|is|it|be|to|of|by|or|as|so|do|go|my|no|us|we|he|hi|ok|an|am|if|the|for)$/i;

function findFlightNo(t: string): string | null {
  let m = t.match(/\bflight\s+(?:(?:number|no|#)\.?\s*)?([A-Za-z]{2,3}|[A-Za-z]\d|\d[A-Za-z])\s?(\d{1,4})\b/i);
  if (m) return `${m[1].toUpperCase()}${m[2]}`;
  m = t.match(/\b([A-Za-z]\d|\d[A-Za-z])\s?(\d{2,4})\b/); // B6 1234, 9W 22
  if (m) return `${m[1].toUpperCase()}${m[2]}`;
  m = t.match(/\b([A-Za-z]{2,3})\s?(\d{2,4})\b/); // AA1234
  if (m && !FLIGHT_STOPWORDS.test(m[1])) return `${m[1].toUpperCase()}${m[2]}`;
  return null;
}

const F_MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const F_WD = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function resolveFlightDate(t: string, now = new Date()): string {
  const lc = t.toLowerCase();
  const rollPast = (d: Date) => (d.getTime() < now.getTime() - 86_400_000 ? new Date(d.setFullYear(d.getFullYear() + 1)) : d);

  const iso = lc.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (iso) return iso[1];

  const md = lc.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (md) {
    const y = md[3] ? (md[3].length === 2 ? 2000 + +md[3] : +md[3]) : now.getFullYear();
    const d = new Date(Date.UTC(y, +md[1] - 1, +md[2], 12));
    return (md[3] ? d : rollPast(d)).toISOString().slice(0, 10);
  }

  const mon = lc.match(
    /\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2})(?:st|nd|rd|th)?\b/,
  );
  if (mon) {
    const day = +(mon[1] ?? mon[4]);
    const mi = F_MONTHS.indexOf((mon[2] ?? mon[3]).slice(0, 3));
    return rollPast(new Date(Date.UTC(now.getFullYear(), mi, day, 12))).toISOString().slice(0, 10);
  }

  if (/\btomorrow\b/.test(lc)) return new Date(now.getTime() + 86_400_000).toISOString().slice(0, 10);
  if (/\b(today|tonight|this evening)\b/.test(lc)) return now.toISOString().slice(0, 10);

  for (let i = 0; i < 7; i++) {
    if (new RegExp(`\\b${F_WD[i]}\\b`).test(lc)) {
      const d = new Date(now);
      d.setHours(12, 0, 0, 0);
      let add = (i - d.getDay() + 7) % 7;
      if (add === 0) add = 7;
      d.setDate(d.getDate() + add);
      return d.toISOString().slice(0, 10);
    }
  }
  return now.toISOString().slice(0, 10);
}

export function isFlightWatch(t: string): boolean {
  if (!/\bflight\b/i.test(t)) return false;
  if (!/\b(watch|track|keep an eye on|keep tabs on|monitor|follow|let me know|tell me|ping me|alert me|notify me|status of|delayed|on time|updates? on)\b/i.test(t)) return false;
  return findFlightNo(t) !== null;
}

export function extractFlightWatch(t: string, now = new Date()): { flightNo: string; date: string } | null {
  const flightNo = findFlightNo(t);
  if (!flightNo) return null;
  return { flightNo, date: resolveFlightDate(t, now) };
}

export const isWatcherList = (t: string) =>
  /\b(what('?s| is| are you)?\s*(am i|are you)?\s*watching( for me)?\??$|my watchers?\b|what are you (keeping an eye on|monitoring|tracking)|list (my )?watchers?)\b/i.test(t) &&
  !/\b(watch ?list|to watch|want to watch|tv|show|movie|film|series|episode)\b/i.test(t);

export const isWatcherRemove = (t: string) =>
  /\b(stop|cancel|end|remove|drop|quit|kill)\s+(watching|the watch(er)? (on|for)|monitoring|tracking)\b|\byou can stop watching\b|\bunwatch\b/i.test(t);

/** The thing named after "stop watching ___". */
export function extractWatcherRemoveHint(t: string): string {
  const m =
    t.match(/\b(?:stop|cancel|end|remove|drop|quit|kill)\s+(?:watching|the watch(?:er)?\s+(?:on|for)|monitoring|tracking)\s+(.+?)(?:[.?!]|$)/i) ||
    t.match(/\byou can stop watching\s+(.+?)(?:[.?!]|$)/i) ||
    t.match(/\bunwatch\s+(.+?)(?:[.?!]|$)/i);
  return (m?.[1] ?? '').trim();
}
