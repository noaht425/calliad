import { adminClient } from '@/lib/supabase.server';

// Noah's fixed Fall-2026 class schedule → dated calendar_events rows (source
// 'schedule'). Sourced from planning/inputs/course-schedule-fall2026.md +
// trinity-academic-calendar-2026-27.md. Re-run when the Greek time is set.

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

  for (const c of CLASSES) {
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
  return { inserted: rows.length, classes: CLASSES.length };
}
