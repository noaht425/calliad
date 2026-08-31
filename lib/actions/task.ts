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
