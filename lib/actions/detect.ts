import { t1Json, t1Available } from '@/lib/llm/gemini';
import { adminClient } from '@/lib/supabase.server';

const TZ = process.env.TZ_DEFAULT ?? 'America/New_York';

// Calendar-write intent (needs a time reference somewhere in the message).
const CAL_WRITE =
  /\b(add\b.{0,80}?\bto (my |the )?calendar|put\b.{0,80}?\bon (my |the )?calendar|schedule (a|an|the)\b|block off|book (a|an|the)? ?(slot|time|room|appointment)|calendar hold|put a hold|pencil (me )?in)\b/i;
const TASK_ADD =
  /\b(add (a )?(task|reminder|to-?do)|remind me to|add to (my )?(to-?do|task list)|put on my to-?do)\b|(?:^|[,.;:]\s*)every\s+(day|morning|night|week|month|weekday|other\s+week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|(?:^|[,.;:]\s*)(daily|weekly|biweekly|monthly)\s*[:—-]\s*\S/i;

export interface EventDraft {
  title: string;
  start_at: string;
  end_at?: string | null;
  all_day?: boolean;
  location?: string | null;
  city?: string | null; // the city the location is in, if a known venue/address makes it obvious
}

export function isCalendarWrite(text: string): boolean {
  return CAL_WRITE.test(text);
}
export function isTaskAdd(text: string): boolean {
  return TASK_ADD.test(text) && !CAL_WRITE.test(text);
}

/** Extract a calendar event from free text via T1. Returns null if underspecified. */
export async function extractEvent(text: string, now = new Date()): Promise<EventDraft | null> {
  if (!t1Available()) return null;
  const localNow = now.toLocaleString('en-US', { timeZone: TZ });
  const out = await t1Json<EventDraft & { ok: boolean }>(
    'extract_event',
    `Pull a single calendar event from this request. "Now" is ${localNow} (${TZ}). Resolve relative dates/times against that.
Request: "${text}"

Return JSON only:
{"ok": true|false, "title": "short", "start_at": "UTC ISO 8601", "end_at": "UTC ISO 8601 or null", "all_day": false, "location": "or null", "city": "or null"}

ok=false if there's no determinable date/time. If a time is given but no duration, set end_at null (the writer defaults to 1h). all_day=true only when no clock time is implied. city = the city the location is in ONLY if a well-known venue or a full address makes it unambiguous (e.g. "Climate Pledge Arena" → "Seattle"); otherwise null.`,
    { maxOutputTokens: 220 },
  );
  if (!out?.ok || !out.start_at || Number.isNaN(Date.parse(out.start_at))) return null;
  return { title: out.title || 'Untitled', start_at: out.start_at, end_at: out.end_at ?? null, all_day: !!out.all_day, location: out.location ?? null, city: out.city ?? null };
}

export function whenLabel(iso: string, allDay = false): string {
  const d = new Date(iso);
  return d.toLocaleString('en-US', {
    timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric',
    ...(allDay ? {} : { hour: 'numeric', minute: '2-digit' }),
  });
}

// ── calendar edit / delete ───────────────────────────────────────────────
const EVENTISH =
  /\b(meeting|appt|appointment|event|call|lunch|dinner|reservation|session|standup|stand-up|sync|class|game|practice|rehearsal|dentist|doctor|interview|hangout|catch[- ]?up|\d{1,2}\s?(am|pm)\b|\d{1,2}:\d{2})\b/i;
const CAL_EDIT =
  /\b(?:move|reschedul\w*|push (?:it |that |the )?(?:back|to|out)|bump|shift|rename|change (?:the )?(?:time|date|name|title|location|day) of|make \w[\w ]{0,28}(?:earlier|later))/i;
const CAL_CANCEL =
  /\b(?:cancel|delete|remove|call off|scrap|drop|get rid of)\b/i;

export function isCalendarChange(t: string): 'update' | 'delete' | null {
  if (CAL_CANCEL.test(t) && EVENTISH.test(t)) return 'delete';
  if (CAL_EDIT.test(t) && EVENTISH.test(t)) return 'update';
  return null;
}

export interface CalendarChangeDraft {
  op: 'update' | 'delete';
  match: string;
  new_title: string | null;
  new_start: string | null;
  new_end: string | null;
  new_location: string | null;
}

export async function extractCalendarChange(text: string, now = new Date()): Promise<CalendarChangeDraft | null> {
  if (!t1Available()) return null;
  const localNow = now.toLocaleString('en-US', { timeZone: TZ });
  const out = await t1Json<CalendarChangeDraft & { ok: boolean }>(
    'extract_calendar_change',
    `Noah wants to change or cancel a calendar event. "Now" is ${localNow} (${TZ}).
Request: "${text}"
Return JSON: {"ok":true|false,"op":"update"|"delete","match":"how Noah refers to the event — title words plus any day/time he mentions to identify it, e.g. 'standup tomorrow' or 'dentist Friday 2pm'","new_title":null,"new_start":"UTC ISO 8601 or null","new_end":"UTC ISO 8601 or null","new_location":null}
- match is what identifies the EXISTING event, never the new time.
- For "move X to <time>", new_start is that new time (resolve relatives). new_end null unless a new end/duration is stated.
- op="delete" for cancel/delete/remove. ok=false if you can't tell which event.`,
    { maxOutputTokens: 220 },
  );
  if (!out?.ok || !out.match) return null;
  const iso = (v: string | null) => (v && !Number.isNaN(Date.parse(v)) ? v : null);
  return {
    op: out.op === 'delete' ? 'delete' : 'update',
    match: out.match.trim(),
    new_title: out.new_title?.trim() || null,
    new_start: iso(out.new_start),
    new_end: iso(out.new_end),
    new_location: out.new_location?.trim() || null,
  };
}

const HINT_STOP = new Set(['the', 'a', 'an', 'my', 'our', 'to', 'on', 'at', 'for', 'with', 'me', 'move', 'reschedule', 'cancel', 'delete', 'remove', 'meeting', 'event', 'appointment', 'appt', 'tomorrow', 'today', 'tonight', 'next', 'this', 'am', 'pm']);

export interface MatchedEvent { uid: string; title: string; start_at: string }

/** Resolve Noah's "match" phrase to a synced calendar event. */
export async function findEventByHint(
  userId: string,
  hint: string,
  now = new Date(),
): Promise<{ hit: MatchedEvent } | { ambiguous: MatchedEvent[] } | { none: true }> {
  const { data } = await adminClient
    .from('calendar_events')
    .select('uid, title, start_at')
    .eq('user_id', userId)
    .eq('source', 'icloud') // only real CalDAV objects can be edited/deleted
    .gte('start_at', new Date(now.getTime() - 12 * 3600000).toISOString())
    .lte('start_at', new Date(now.getTime() + 120 * 86400000).toISOString())
    .order('start_at', { ascending: true })
    .limit(150);
  // collapse recurring instances (same uid) to the soonest upcoming one
  const seen = new Set<string>();
  const events = ((data ?? []) as MatchedEvent[])
    .filter((e) => e.uid && e.title)
    .filter((e) => (seen.has(e.uid) ? false : (seen.add(e.uid), true)));
  if (!events.length) return { none: true };

  const h = hint.toLowerCase();
  const tokens = h.split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !HINT_STOP.has(w));

  // day / relative-day hint
  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  let wantDate: string | null = null;
  if (/\btomorrow\b/.test(h)) wantDate = new Date(now.getTime() + 86400000).toLocaleDateString('en-CA', { timeZone: TZ });
  else if (/\btoday\b|\btonight\b/.test(h)) wantDate = now.toLocaleDateString('en-CA', { timeZone: TZ });
  else {
    const dn = dayNames.findIndex((d) => h.includes(d));
    if (dn >= 0) {
      const d = new Date(now);
      for (let i = 1; i <= 7; i++) { d.setDate(d.getDate() + 1); if (d.getDay() === dn) break; }
      wantDate = d.toLocaleDateString('en-CA', { timeZone: TZ });
    }
  }
  const tm = h.match(/\b(\d{1,2})(?::(\d{2}))?\s?(am|pm)\b/);
  const wantHour = tm ? (parseInt(tm[1], 10) % 12) + (tm[3] === 'pm' ? 12 : 0) : null;

  const scored = events.map((e) => {
    const t = e.title.toLowerCase();
    let s = tokens.reduce((acc, w) => acc + (t.includes(w) ? 2 : 0), 0);
    const localDate = new Date(e.start_at).toLocaleDateString('en-CA', { timeZone: TZ });
    if (wantDate && localDate === wantDate) s += 3;
    if (wantHour != null) {
      const hr = Number(new Date(e.start_at).toLocaleString('en-US', { timeZone: TZ, hour: '2-digit', hour12: false }).replace(/\D/g, ''));
      if (hr === wantHour) s += 2;
    }
    return { e, s };
  }).filter((x) => x.s > 0).sort((a, b) => b.s - a.s || Date.parse(a.e.start_at) - Date.parse(b.e.start_at));

  if (!scored.length) return { none: true };
  if (scored.length === 1 || scored[0].s - scored[1].s >= 2) return { hit: scored[0].e };
  return { ambiguous: scored.slice(0, 3).map((x) => x.e) };
}

const YES = /^\s*(yes|yep|yeah|yup|confirm(ed)?|do it|go ahead|please do|add it|sounds good|ok(ay)?|sure)\b/i;
const NO = /^\s*(no|nope|nah|cancel|don'?t|do not|never ?mind|leave it|skip it|forget it)\b/i;
export const isYes = (t: string) => YES.test(t);
export const isNo = (t: string) => NO.test(t);
