import { t1Json, t1Available } from '@/lib/llm/gemini';

const TZ = process.env.TZ_DEFAULT ?? 'America/New_York';

// Calendar-write intent (needs a time reference somewhere in the message).
const CAL_WRITE =
  /\b(add\b.{0,80}?\bto (my |the )?calendar|put\b.{0,80}?\bon (my |the )?calendar|schedule (a|an|the)\b|block off|book (a|an|the)? ?(slot|time|room|appointment)|calendar hold|put a hold|pencil (me )?in)\b/i;
const TASK_ADD =
  /\b(add (a )?(task|reminder|to-?do)|remind me to|add to (my )?(to-?do|task list)|put on my to-?do)\b/i;

export interface EventDraft {
  title: string;
  start_at: string;
  end_at?: string | null;
  all_day?: boolean;
  location?: string | null;
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
{"ok": true|false, "title": "short", "start_at": "UTC ISO 8601", "end_at": "UTC ISO 8601 or null", "all_day": false, "location": "or null"}

ok=false if there's no determinable date/time. If a time is given but no duration, set end_at null (the writer defaults to 1h). all_day=true only when no clock time is implied.`,
    { maxOutputTokens: 200 },
  );
  if (!out?.ok || !out.start_at || Number.isNaN(Date.parse(out.start_at))) return null;
  return { title: out.title || 'Untitled', start_at: out.start_at, end_at: out.end_at ?? null, all_day: !!out.all_day, location: out.location ?? null };
}

export function whenLabel(iso: string, allDay = false): string {
  const d = new Date(iso);
  return d.toLocaleString('en-US', {
    timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric',
    ...(allDay ? {} : { hour: 'numeric', minute: '2-digit' }),
  });
}

const YES = /^\s*(yes|yep|yeah|yup|confirm(ed)?|do it|go ahead|please do|add it|sounds good|ok(ay)?|sure)\b/i;
const NO = /^\s*(no|nope|nah|cancel|don'?t|do not|never ?mind|leave it|skip it|forget it)\b/i;
export const isYes = (t: string) => YES.test(t);
export const isNo = (t: string) => NO.test(t);
