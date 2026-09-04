import { t1Json, t1Available } from '@/lib/llm/gemini';

const TZ = process.env.TZ_DEFAULT ?? 'America/New_York';

export type Recur = 'daily' | 'weekdays' | 'weekly' | 'biweekly' | 'monthly';

export interface TaskDraft {
  title: string;
  due_at: string | null; // UTC ISO, or null
  recur: Recur | null;
}

const RECURS: Recur[] = ['daily', 'weekdays', 'weekly', 'biweekly', 'monthly'];

/**
 * "call the dentist tomorrow" / "file the timesheet by Friday" → a clean title
 * plus an optional due date. No date → due_at null. Falls back to the raw text
 * as the title when T1 is unavailable.
 */
export async function extractTask(text: string, now = new Date()): Promise<TaskDraft> {
  const raw = text
    .replace(/^.*?\b(add (a )?(task|reminder|to-?do)( to)?|remind me to|add to (my )?(to-?do|task list)|put on my to-?do)\b[:,]?\s*/i, '')
    .trim();
  if (!t1Available() || !raw) return { title: raw || text.trim(), due_at: null, recur: null };

  const localNow = now.toLocaleString('en-US', { timeZone: TZ });
  const out = await t1Json<{ title: string; due_at: string | null; recur: string | null }>(
    'extract_task',
    `Noah is adding a to-do. "Now" is ${localNow} (${TZ}).
"${raw}"
Return JSON: {"title":"the task, imperative, no date/repeat words","due_at":"UTC ISO 8601 at a sensible time (default 9am local) or null","recur":"daily|weekdays|weekly|biweekly|monthly or null"}
- due_at: null unless a day/deadline is clearly stated ("tomorrow", "Friday", "by the 15th", "next week" → the following Monday). For a repeating task, due_at = the FIRST occurrence.
- recur: set only if it clearly repeats ("every day", "every Monday" → weekly, "every other week" → biweekly, "monthly"/"every month" → monthly, "weekdays" → weekdays). Otherwise null.`,
    { maxOutputTokens: 140 },
  );
  const title = out?.title?.trim() || raw;
  const due_at = out?.due_at && !Number.isNaN(Date.parse(out.due_at)) ? out.due_at : null;
  const recur = RECURS.includes(out?.recur as Recur) ? (out!.recur as Recur) : null;
  return { title: title.slice(0, 200), due_at, recur };
}

// ── task edit ────────────────────────────────────────────────────────────
// A reference to Noah's Tasks list ("task", "to-do", "reminder", the page
// name "Tasks") plus an edit-ish verb. Deliberately separate from calendar
// change detection — "the note in Tasks still says X" is not an event, and
// routing it through the calendar-edit path produces a "which event?"
// question that doesn't fit a task.
const TASKISH = /\b(tasks?|to-?dos?|reminders?)\b/i;
const EDITISH = /\b(edit|rename|fix(?:ed)?|correct(?:ed)?|update[ds]?|change[ds]?|still says?|should say)\b/i;

export function isTaskEdit(text: string): boolean {
  return TASKISH.test(text) && EDITISH.test(text);
}

export interface TaskChangeDraft {
  match: string;
  new_title: string | null;
}

/**
 * Pull which task Noah means and what it should now say. Recent turns matter
 * here — "the note in Tasks still says X" often refers back to a correction
 * ("Kathy" → "Katie") stated earlier in the conversation rather than in this
 * message itself.
 */
export async function extractTaskChange(
  text: string,
  recent: { role: 'user' | 'assistant'; content: string }[] = [],
): Promise<TaskChangeDraft | null> {
  if (!t1Available()) return null;
  const convo = recent
    .slice(-6)
    .map((t) => `${t.role === 'user' ? 'Noah' : 'Assistant'}: ${t.content.slice(0, 240)}`)
    .join('\n');
  const out = await t1Json<{ ok: boolean; match: string; new_title: string | null }>(
    'extract_task_change',
    `Noah wants to fix the title of an existing task/to-do on his list. Use the recent conversation to figure out the corrected text if he doesn't spell it out in this message.

Recent conversation:
${convo || '(none)'}

Latest message: "${text}"

Return JSON: {"ok":true|false,"match":"the words that identify the EXISTING task title, e.g. 'meeting with kathy'","new_title":"the corrected full task title, or null if genuinely unclear"}
- If a correction (e.g. a name fixed from X to Y) was already stated earlier in the conversation, apply it here to produce new_title.
- ok=false only if you can't tell which task he means at all.`,
    { maxOutputTokens: 160 },
  );
  if (!out?.ok || !out.match) return null;
  return { match: out.match.trim(), new_title: out.new_title?.trim() || null };
}
