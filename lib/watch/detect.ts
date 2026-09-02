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
