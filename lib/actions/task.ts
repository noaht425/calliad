import { t1Json, t1Available } from '@/lib/llm/gemini';

const TZ = process.env.TZ_DEFAULT ?? 'America/New_York';

export interface TaskDraft {
  title: string;
  due_at: string | null; // UTC ISO, or null
}

/**
 * "call the dentist tomorrow" / "file the timesheet by Friday" → a clean title
 * plus an optional due date. No date → due_at null. Falls back to the raw text
 * as the title when T1 is unavailable.
 */
export async function extractTask(text: string, now = new Date()): Promise<TaskDraft> {
  const raw = text
    .replace(/^.*?\b(add (a )?(task|reminder|to-?do)( to)?|remind me to|add to (my )?(to-?do|task list)|put on my to-?do)\b[:,]?\s*/i, '')
    .trim();
  if (!t1Available() || !raw) return { title: raw || text.trim(), due_at: null };

  const localNow = now.toLocaleString('en-US', { timeZone: TZ });
  const out = await t1Json<{ title: string; due_at: string | null }>(
    'extract_task',
    `Noah is adding a to-do. "Now" is ${localNow} (${TZ}).
"${raw}"
Return JSON: {"title":"the task, imperative, no date words","due_at":"UTC ISO 8601 at a sensible time (default 9am local) or null"}
null due_at unless a day/deadline is clearly stated ("tomorrow", "Friday", "by the 15th", "next week" → the following Monday).`,
    { maxOutputTokens: 120 },
  );
  const title = out?.title?.trim() || raw;
  const due_at = out?.due_at && !Number.isNaN(Date.parse(out.due_at)) ? out.due_at : null;
  return { title: title.slice(0, 200), due_at };
}
