import Anthropic from '@anthropic-ai/sdk';
import { adminClient } from '@/lib/supabase.server';
import { audit } from '@/lib/hub/audit';
import { anthropicCostUsd } from '@/lib/router/tiers';
import { createCalendarEvent } from '@/lib/integrations/icloud-calendar-write';

// A screenshot of a class timetable or a work schedule -> real calendar events.
// Two shapes come out of the same extraction: a RECURRING weekly pattern (a
// class grid — needs a term date range to expand across) and DATED one-off
// entries (a work schedule showing specific days — no expansion needed).

const anthropic = new Anthropic();
const TZ = process.env.TZ_DEFAULT ?? 'America/New_York';

// Fallback term range when a recurring block's dates aren't visible in the
// screenshot or stated in the message. Noah's current term — update each
// semester, or just say the real dates in the same message as the screenshot.
const DEFAULT_TERM_START = '2026-09-08';
const DEFAULT_TERM_END = '2026-12-14';

export const isScheduleShare = (t: string) =>
  /\b(class(es)?|course|work|shift)s?\s+(schedule|timetable)\b/i.test(t) ||
  /\b(my|this|the|our) (schedule|timetable)\b/i.test(t) ||
  /\bschedule\b.{0,20}\b(for|screenshot|photo|picture)\b/i.test(t) ||
  /\bfinalized? (class|work)? ?schedule\b/i.test(t);

interface RawBlock {
  title: string;
  location: string | null;
  start_time: string; // "HH:MM" 24h
  end_time: string;
  days: string | null; // meeting days exactly as shown — "TR", "MWF", "Tuesday, Thursday", etc. Decoded in code, not by the model (see parseDayCode).
  date: string | null;   // "YYYY-MM-DD" for a specific one-off entry
}

interface ExtractResult {
  ok: boolean;
  blocks: RawBlock[];
  term_start: string | null;
  term_end: string | null;
  notes: string | null;
}

function parseArrayLoose(raw: string): Record<string, unknown> | null {
  const s = raw.replace(/```json\n?|\n?```/g, '').trim();
  try {
    return JSON.parse(s);
  } catch {
    const m = s.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try { return JSON.parse(m[0]); } catch { return null; }
  }
}

const SYSTEM = `These screenshots show a class timetable or a work shift schedule. Extract every distinct time block.

Two kinds of block, tell them apart:
- RECURRING: a weekly class grid ("Mon/Wed/Fri 9:00-9:50", a course timetable). Set "days" to the meeting days EXACTLY as written in the image, "date" null. Class schedules often show days as letter codes, not full names — copy the code verbatim, do not translate or expand it yourself: "TR" stays "TR", "MWF" stays "MWF", "T" stays "T". Do not guess what a code means — just transcribe it.
- DATED: a specific day's shift or event with an actual date visible ("Tue Sep 9, 2pm-6pm"). Set "date" to that ISO date, "days" null.

For each block: title (course name/code, or job/employer name for a shift), location if shown (room, or workplace), start_time and end_time in 24-hour "HH:MM". If the image states the term/semester date range (e.g. "Fall 2026" with visible start/end, or a syllabus-style date range), capture it in term_start/term_end (YYYY-MM-DD) — otherwise leave those null.

Return ONLY minified JSON: {"ok":true|false,"blocks":[{"title":"","location":null,"start_time":"09:00","end_time":"09:50","days":"MWF","date":null}],"term_start":null,"term_end":null,"notes":"anything ambiguous or that needs Noah to confirm, else null"}
ok=false only if the images have no readable schedule at all.`;

export async function extractSchedule(
  images: { media_type: string; data: string }[],
  text: string,
): Promise<ExtractResult | null> {
  const shots = images.slice(0, 8);
  if (!shots.length) return null;
  const started = Date.now();
  const msg = await anthropic.messages.create({
    model: 'claude-sonnet-5',
    max_tokens: 4000,
    system: SYSTEM,
    messages: [
      {
        role: 'user',
        content: [
          ...shots.map((im) => ({
            type: 'image' as const,
            source: { type: 'base64' as const, media_type: im.media_type as 'image/jpeg', data: im.data },
          })),
          { type: 'text' as const, text: text.trim() ? `Noah's message: "${text.slice(0, 400)}"` : 'Extract the schedule.' },
        ],
      },
    ],
  });
  await audit.modelCall({
    conversation_id: null, purpose: 'schedule_extract', tier: 'T2', model: 'claude-sonnet-5',
    input_tokens: msg.usage.input_tokens, cached_read_tokens: msg.usage.cache_read_input_tokens ?? 0,
    cache_write_tokens: msg.usage.cache_creation_input_tokens ?? 0, output_tokens: msg.usage.output_tokens,
    cost_usd: anthropicCostUsd('claude-sonnet-5', msg.usage), latency_ms: Date.now() - started,
  });
  const raw = msg.content.filter((b) => b.type === 'text').map((b) => (b as Anthropic.TextBlock).text).join('');
  const parsed = parseArrayLoose(raw) as Partial<ExtractResult> | null;
  if (!parsed || !Array.isArray(parsed.blocks)) return null;
  return {
    ok: parsed.ok !== false,
    blocks: parsed.blocks.filter((b): b is RawBlock => !!b && typeof b.title === 'string' && typeof b.start_time === 'string'),
    term_start: typeof parsed.term_start === 'string' ? parsed.term_start : null,
    term_end: typeof parsed.term_end === 'string' ? parsed.term_end : null,
    notes: typeof parsed.notes === 'string' ? parsed.notes : null,
  };
}

export interface PlannedEvent {
  title: string;
  location: string | null;
  start_at: string; // UTC ISO
  end_at: string;
}

// Longest token first so a full/abbreviated name is matched before falling
// back to single letters. Order matters: 'TH' must be checked before bare
// 'T', and multi-letter names before their abbreviations.
const DAY_TOKENS_RAW: [string, number][] = [
  ['SUNDAY', 0], ['MONDAY', 1], ['TUESDAY', 2], ['WEDNESDAY', 3], ['THURSDAY', 4], ['FRIDAY', 5], ['SATURDAY', 6],
  ['SUN', 0], ['MON', 1], ['TUE', 2], ['TUES', 2], ['WED', 3], ['THU', 4], ['THUR', 4], ['THURS', 4], ['FRI', 5], ['SAT', 6],
  ['TU', 2], ['TH', 4], ['SU', 0], ['SA', 6],
  // Bare-letter academic shorthand. The classic ambiguity this exists to
  // resolve: T = Tuesday, R = Thursday (never "Th") so "TR" reads as
  // Tuesday+Thursday, not one ambiguous day. S = Saturday, U = Sunday.
  ['M', 1], ['T', 2], ['W', 3], ['R', 4], ['F', 5], ['S', 6], ['U', 0],
];
const DAY_TOKENS: [string, number][] = [...DAY_TOKENS_RAW].sort((a, b) => b[0].length - a[0].length);

/** Decode a day spec exactly as a schedule screenshot might show it — full
 *  names ("Tuesday, Thursday"), abbreviations ("Tue/Thu"), or academic
 *  letter-code shorthand ("TR", "MWF", "TTh", "M/W/F") — into weekday
 *  numbers (0=Sun..6=Sat). Never asks a model to resolve this; it's a fixed,
 *  testable table so "TR" always means Tue+Thu, not a guess. */
function parseDayCode(raw: string): number[] {
  const s = raw.toUpperCase().replace(/[^A-Z]/g, '');
  const out: number[] = [];
  let i = 0;
  outer: while (i < s.length) {
    for (const [tok, dow] of DAY_TOKENS) {
      if (s.startsWith(tok, i)) {
        out.push(dow);
        i += tok.length;
        continue outer;
      }
    }
    i += 1; // unrecognized character — skip rather than silently drop the whole block
  }
  return out;
}

/** Local wall-clock (America/New_York) -> UTC ISO, DST-correct. */
function localToUtcISO(dateStr: string, timeStr: string): string {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const [h, mi] = timeStr.split(':').map(Number);
  const approx = new Date(Date.UTC(y, mo - 1, d, h, mi, 0));
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(approx);
  const g = (t: string) => parseInt(parts.find((p) => p.type === t)!.value, 10);
  const rendered = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour') % 24, g('minute'), g('second'));
  const wanted = Date.UTC(y, mo - 1, d, h, mi, 0);
  return new Date(approx.getTime() + (wanted - rendered)).toISOString();
}

function* eachDate(from: string, to: string): Generator<string> {
  const cur = new Date(from + 'T00:00:00Z');
  const end = new Date(to + 'T00:00:00Z');
  while (cur <= end) {
    yield cur.toISOString().slice(0, 10);
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
}

/** Expand extracted blocks into concrete dated events. Recurring blocks expand
 *  across [termStart, termEnd]; dated blocks are used as-is. */
export function expandBlocks(
  blocks: RawBlock[],
  termStart: string,
  termEnd: string,
): PlannedEvent[] {
  const events: PlannedEvent[] = [];
  for (const b of blocks) {
    if (b.date) {
      events.push({
        title: b.title, location: b.location,
        start_at: localToUtcISO(b.date, b.start_time),
        end_at: localToUtcISO(b.date, b.end_time),
      });
      continue;
    }
    if (b.days?.length) {
      const wantDows = new Set(parseDayCode(b.days));
      for (const date of eachDate(termStart, termEnd)) {
        const dow = new Date(date + 'T12:00:00Z').getUTCDay();
        if (!wantDows.has(dow)) continue;
        events.push({
          title: b.title, location: b.location,
          start_at: localToUtcISO(date, b.start_time),
          end_at: localToUtcISO(date, b.end_time),
        });
      }
    }
  }
  return events;
}

export const scheduleDefaultTerm = { start: DEFAULT_TERM_START, end: DEFAULT_TERM_END };

/** Create every planned event, skipping ones that already exist (same title +
 *  start time) so re-sending the same screenshot doesn't duplicate. Bounded
 *  concurrency — this can be dozens of iCloud writes. */
export async function materializeEvents(
  userId: string,
  events: PlannedEvent[],
  batchLabel: string,
): Promise<{ created: number; skipped: number; uids: string[] }> {
  if (!events.length) return { created: 0, skipped: 0, uids: [] };

  const from = events.reduce((a, e) => (e.start_at < a ? e.start_at : a), events[0].start_at);
  const to = events.reduce((a, e) => (e.start_at > a ? e.start_at : a), events[0].start_at);
  const { data: existing } = await adminClient
    .from('calendar_events')
    .select('title, start_at')
    .eq('user_id', userId)
    .gte('start_at', from)
    .lte('start_at', to);
  const have = new Set((existing ?? []).map((r) => `${(r.title as string).toLowerCase()}|${r.start_at}`));

  const todo = events.filter((e) => !have.has(`${e.title.toLowerCase()}|${e.start_at}`));
  const skipped = events.length - todo.length;

  const uids: string[] = [];
  const CONCURRENCY = 6;
  for (let i = 0; i < todo.length; i += CONCURRENCY) {
    const batch = todo.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map((e) =>
        createCalendarEvent(userId, {
          title: e.title, start_at: e.start_at, end_at: e.end_at, all_day: false, location: e.location,
          description: `Imported from a schedule screenshot (${batchLabel}).`,
        }),
      ),
    );
    for (const r of results) if (r.ok && r.uid) uids.push(r.uid);
  }

  await audit.log('outbound_message', 'calliad', null, { tool: 'schedule_import', created: uids.length, skipped, batch: batchLabel });
  return { created: uids.length, skipped, uids };
}

/** Undo a schedule import — deletes every event whose uid this batch created. */
export async function undoScheduleImport(userId: string, uids: string[]): Promise<number> {
  const { deleteCalendarEvent } = await import('@/lib/integrations/icloud-calendar-write');
  let n = 0;
  for (const uid of uids) {
    const r = await deleteCalendarEvent(userId, uid).catch(() => ({ ok: false }));
    if (r.ok) n++;
  }
  return n;
}
