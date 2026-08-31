import { adminClient } from '@/lib/supabase.server';
import { t1Json, t1Available } from '@/lib/llm/gemini';

export interface QuizItem {
  id: string;
  lang: string;
  kind: string;
  prompt: string;
  answer: string;
  notes: string | null;
  box: number;
  streak: number;
}

// Leitner intervals (days) by box after a correct answer.
const INTERVAL_DAYS = [1, 2, 4, 8, 16, 30];

export async function addItem(
  userId: string,
  it: { lang?: string; kind?: string; prompt: string; answer: string; notes?: string },
): Promise<'added' | 'exists' | 'skipped'> {
  if (!it.prompt.trim() || !it.answer.trim()) return 'skipped';
  const { error } = await adminClient.from('quiz_items').insert({
    user_id: userId,
    lang: it.lang ?? 'lat',
    kind: it.kind ?? 'vocab',
    prompt: it.prompt.trim(),
    answer: it.answer.trim(),
    notes: it.notes ?? null,
  });
  if (error) return /duplicate|unique/i.test(error.message) ? 'exists' : 'skipped';
  return 'added';
}

export async function counts(userId: string): Promise<{ total: number; due: number }> {
  const [{ count: total }, { count: due }] = await Promise.all([
    adminClient.from('quiz_items').select('id', { count: 'exact', head: true }).eq('user_id', userId),
    adminClient.from('quiz_items').select('id', { count: 'exact', head: true }).eq('user_id', userId).lte('due_at', new Date().toISOString()),
  ]);
  return { total: total ?? 0, due: due ?? 0 };
}

export async function getItem(userId: string, id: string): Promise<QuizItem | null> {
  const { data } = await adminClient
    .from('quiz_items')
    .select('id, lang, kind, prompt, answer, notes, box, streak')
    .eq('user_id', userId).eq('id', id).maybeSingle();
  return (data as QuizItem) ?? null;
}

/** Next item to test: soonest-due, then least-recently-seen. */
export async function nextDue(userId: string, excludeId?: string): Promise<QuizItem | null> {
  let q = adminClient
    .from('quiz_items')
    .select('id, lang, kind, prompt, answer, notes, box, streak')
    .eq('user_id', userId)
    .order('due_at', { ascending: true })
    .limit(2);
  const { data } = await q;
  const rows = (data ?? []) as QuizItem[];
  return rows.find((r) => r.id !== excludeId) ?? rows[0] ?? null;
}

function norm(s: string): string {
  return s.toLowerCase().trim()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // strip macrons/accents
    .replace(/^(to |the |a |an |i )/, '').replace(/[.,;!?]/g, '').replace(/\s+/g, ' ');
}

export async function judge(expected: string, given: string, kind = 'vocab'): Promise<boolean> {
  const alts = expected.split('|').map(norm);
  const g = norm(given);
  if (alts.some((a) => a === g || (a.length > 4 && (a.includes(g) || g.includes(a)) && g.length > 3))) return true;
  if (!t1Available()) return false;
  const rule =
    kind === 'vocab'
      ? 'This is a vocabulary card. Accept close synonyms and word-order differences. Ignore capitalisation, macrons/accents, and leading "to/the/a".'
      : 'This is a grammatical-form card. Require the exact form (ignoring only capitalisation and macrons/accents). Do NOT accept romanised Greek, paraphrases, or partial answers.';
  const out = await t1Json<{ ok: boolean }>(
    'quiz_grade',
    `${rule}\nExpected: ${expected}\nStudent: ${given}\nReturn {"ok":true|false}`,
    { maxOutputTokens: 20 },
  );
  return out?.ok === true;
}

export async function grade(userId: string, id: string, correct: boolean): Promise<void> {
  const it = await getItem(userId, id);
  if (!it) return;
  const box = correct ? Math.min(5, it.box + 1) : 0;
  const days = correct ? INTERVAL_DAYS[box] : 0;
  const due = correct
    ? new Date(Date.now() + days * 86400_000)
    : new Date(Date.now() + 10 * 60_000); // wrong → retry in ~10 min
  await adminClient.from('quiz_items').update({
    box,
    streak: correct ? it.streak + 1 : 0,
    due_at: due.toISOString(),
    last_seen: new Date().toISOString(),
  }).eq('user_id', userId).eq('id', id);
}
