import { adminClient } from '@/lib/supabase.server';
import { config } from '@/lib/hub/config';

// Noah's fixed Fall-2026 class schedule → dated calendar_events rows (source
// 'schedule'). Sourced from planning/inputs/course-schedule-fall2026.md +
// trinity-academic-calendar-2026-27.md. Re-run when the Greek time is set.
//
// A class Noah drops mid-term goes on a `dropped_courses` config list (course
// codes) instead of being hand-edited out of CLASSES; materializeSchedule
// skips it and re-running purges its rows. "keep X after all" reverses it.

const TZ = 'America/New_York';
const TERM_START = '2026-09-08';
const TERM_END = '2026-12-14';
// In-term days with no classes (Trinity Days + Thanksgiving break).
const NO_CLASS = new Set(['2026-10-12', '2026-10-13', '2026-11-25', '2026-11-26', '2026-11-27']);

// day letters: M Tu(=T) W Th(=R) F  → JS getUTCDay 0=Sun..6=Sat
const DOW: Record<string, number> = { M: 1, T: 2, W: 3, R: 4, F: 5 };

interface ClassMeeting {
  course: string;   // course code
  title: string;    // display title
  days: string;     // e.g. 'TR', 'W'
  start: string;    // 'HH:MM' 24h local
  end: string;
  room: string;
}

const CLASSES: ClassMeeting[] = [
  { course: 'CLCV-390', title: 'New Troy',        days: 'TR', start: '10:50', end: '12:05', room: 'HL-123' },
  { course: 'LATN-201', title: 'Latin (Roman Daily Life)', days: 'TR', start: '13:30', end: '14:45', room: 'HL-121' },
  { course: 'ANTH-222', title: 'Voodoo',          days: 'TR', start: '18:30', end: '19:45', room: 'MC-225' },
  { course: 'CLCV-401', title: 'Senior Seminar (Tomasso)', days: 'W',  start: '18:30', end: '21:00', room: 'MC-313' },
  // Greek — time TBD; add here once known.
];

// Recurring non-class commitments from the profile.
const RECURRING = [
  { title: 'Counseling', day: 'W', start: '15:45', end: '16:45', room: null as string | null, from: '2026-09-16', to: TERM_END },
];

const DROPPED_KEY = 'dropped_courses';

async function droppedCourses(): Promise<string[]> {
  try {
    const v = JSON.parse(await config.get(DROPPED_KEY));
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Fuzzy-match a spoken hint ("voodoo", "my anth class", "ANTH 222") to a class.
 *  `pool` defaults to every defined class; pass the dropped list for restores. */
export function matchCourse(hint: string, pool: ClassMeeting[] = CLASSES): ClassMeeting[] {
  const h = norm(hint);
  const words = h.split(' ').filter((w) => w.length > 1 && !['class', 'course', 'the', 'my', 'lecture', 'section'].includes(w));
  if (!words.length) return [];
  const scored = pool
    .map((c) => {
      const hay = `${norm(c.title)} ${norm(c.course)}`;
      const s = words.reduce((acc, w) => acc + (hay.includes(w) ? 1 : 0), 0);
      return { c, s };
    })
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s);
  if (!scored.length) return [];
  const top = scored[0].s;
  return scored.filter((x) => x.s === top).map((x) => x.c);
}

/** Resolve a hint to a still-active class WITHOUT changing anything (for a
 *  propose-then-confirm flow). */
export async function findDroppableCourse(
  hint: string,
): Promise<{ course: string; title: string } | { ambiguous: string[] } | null> {
  const dropped = await droppedCourses();
  const live = CLASSES.filter((c) => !dropped.includes(c.course));
  const hits = matchCourse(hint, live);
  if (!hits.length) return null;
  if (hits.length > 1) return { ambiguous: hits.map((c) => `${c.title} (${c.course})`) };
  return { course: hits[0].course, title: hits[0].title };
}

/** Drop a class for the rest of the term. Idempotent; re-materializes. */
export async function dropCourse(
  userId: string,
  hint: string,
): Promise<{ ok: true; title: string; course: string } | { none: true } | { ambiguous: string[] }> {
  const dropped = await droppedCourses();
  const live = CLASSES.filter((c) => !dropped.includes(c.course));
  const hits = matchCourse(hint, live);
  if (!hits.length) return { none: true };
  if (hits.length > 1) return { ambiguous: hits.map((c) => `${c.title} (${c.course})`) };
  const c = hits[0];
  await config.set(DROPPED_KEY, JSON.stringify([...new Set([...dropped, c.course])]));
  await materializeSchedule(userId);
  return { ok: true, title: c.title, course: c.course };
}

/** Put a dropped class back. */
export async function restoreCourse(
  userId: string,
  hint: string,
): Promise<{ ok: true; title: string } | { none: true } | { ambiguous: string[] }> {
  const dropped = await droppedCourses();
  const droppedClasses = CLASSES.filter((c) => dropped.includes(c.course));
  const hits = matchCourse(hint, droppedClasses);
  if (!hits.length) return { none: true };
  if (hits.length > 1) return { ambiguous: hits.map((c) => `${c.title} (${c.course})`) };
  const c = hits[0];
  await config.set(DROPPED_KEY, JSON.stringify(dropped.filter((x) => x !== c.course)));
  await materializeSchedule(userId);
  return { ok: true, title: c.title };
}

/** Titles of currently-dropped classes, for context / "what did I drop". */
export async function droppedCourseTitles(): Promise<string[]> {
  const dropped = await droppedCourses();
  return CLASSES.filter((c) => dropped.includes(c.course)).map((c) => `${c.title} (${c.course})`);
}

/** Local wall-clock (America/New_York) → UTC ISO, DST-correct via Intl inverse-lookup. */
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

export async function materializeSchedule(userId: string): Promise<{ inserted: number; classes: number }> {
  const rows: Record<string, unknown>[] = [];
  const dropped = new Set(await droppedCourses());

  for (const c of CLASSES) {
    if (dropped.has(c.course)) continue; // Noah dropped this class
    const wantDows = new Set([...c.days.replace('Th', 'R').replace('Tu', 'T')].map((l) => DOW[l]).filter(Boolean));
    for (const date of eachDate(TERM_START, TERM_END)) {
      if (NO_CLASS.has(date)) continue;
      const dow = new Date(date + 'T12:00:00Z').getUTCDay();
      if (!wantDows.has(dow)) continue;
      rows.push({
        user_id: userId,
        uid: `schedule::${c.course}::${date}`,
        calendar_url: null,
        calendar_name: 'Class schedule',
        title: `${c.title} (${c.course})`,
        start_at: localToUtcISO(date, c.start),
        end_at: localToUtcISO(date, c.end),
        all_day: false,
        location: c.room,
        description: null,
        raw_ical: null,
        source: 'schedule',
        updated_at: new Date().toISOString(),
      });
    }
  }

  for (const r of RECURRING) {
    const dow = DOW[r.day];
    for (const date of eachDate(r.from, r.to)) {
      if (NO_CLASS.has(date)) continue;
      if (new Date(date + 'T12:00:00Z').getUTCDay() !== dow) continue;
      rows.push({
        user_id: userId,
        uid: `schedule::${r.title}::${date}`,
        calendar_url: null,
        calendar_name: 'Class schedule',
        title: r.title,
        start_at: localToUtcISO(date, r.start),
        end_at: localToUtcISO(date, r.end),
        all_day: false,
        location: r.room,
        description: null,
        raw_ical: null,
        source: 'schedule',
        updated_at: new Date().toISOString(),
      });
    }
  }

  await adminClient.from('calendar_events').delete().eq('user_id', userId).eq('source', 'schedule');
  if (rows.length) {
    await adminClient.from('calendar_events').upsert(rows, { onConflict: 'user_id,uid' });
  }
  return { inserted: rows.length, classes: CLASSES.length - dropped.size };
}
