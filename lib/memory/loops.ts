import { adminClient } from '@/lib/supabase.server';

export interface OpenLoop {
  id: string;
  title: string;
  body: string | null;
  due_at: string | null;
  status: 'open' | 'done' | 'dropped';
  tags: string[];
  source: string;
  recur: 'daily' | 'weekdays' | 'weekly' | 'biweekly' | 'monthly' | null;
}

export type Recur = NonNullable<OpenLoop['recur']>;

/** Next due date for a recurring loop, always strictly in the future. */
export function nextRecurDate(recur: Recur, from: Date): string {
  const advance = (d: Date): Date => {
    const n = new Date(d);
    if (recur === 'daily') n.setDate(n.getDate() + 1);
    else if (recur === 'weekdays') { do { n.setDate(n.getDate() + 1); } while (n.getDay() === 0 || n.getDay() === 6); }
    else if (recur === 'weekly') n.setDate(n.getDate() + 7);
    else if (recur === 'biweekly') n.setDate(n.getDate() + 14);
    else n.setMonth(n.getMonth() + 1); // monthly
    return n;
  };
  let next = advance(from);
  const now = Date.now();
  let guard = 0;
  while (next.getTime() <= now && guard++ < 60) next = advance(next);
  return next.toISOString();
}

export const RECUR_LABEL: Record<Recur, string> = {
  daily: 'every day', weekdays: 'every weekday', weekly: 'every week', biweekly: 'every 2 weeks', monthly: 'every month',
};

/** Open loops that are due soon or match any of the given tags. Most-urgent first. */
export async function relevantLoops(
  userId: string,
  opts: { dueWithinDays?: number; tags?: string[]; cap?: number } = {},
): Promise<OpenLoop[]> {
  const cap = opts.cap ?? 10;
  const horizon = new Date(Date.now() + (opts.dueWithinDays ?? 14) * 86400000).toISOString();

  const { data } = await adminClient
    .from('open_loops')
    .select('id, title, body, due_at, status, tags, source, recur')
    .eq('user_id', userId)
    .eq('status', 'open')
    .order('due_at', { ascending: true, nullsFirst: false })
    .limit(50);

  const rows = (data ?? []) as OpenLoop[];
  const tagset = new Set((opts.tags ?? []).map((t) => t.toLowerCase()));
  const picked = rows.filter(
    (l) =>
      (l.due_at && l.due_at <= horizon) ||
      (tagset.size && l.tags.some((t) => tagset.has(t.toLowerCase()))) ||
      !l.due_at, // undated loops are "always somewhat relevant"
  );
  return picked.slice(0, cap);
}

export async function allOpenLoops(userId: string): Promise<OpenLoop[]> {
  const { data } = await adminClient
    .from('open_loops')
    .select('id, title, body, due_at, status, tags, source, recur')
    .eq('user_id', userId)
    .eq('status', 'open')
    .order('due_at', { ascending: true, nullsFirst: false });
  return (data ?? []) as OpenLoop[];
}

/** Insert, or merge into an existing open loop with a matching title (case-insensitive). */
export async function upsertLoop(
  userId: string,
  loop: { title: string; body?: string | null; due_at?: string | null; tags?: string[]; source?: string; recur?: Recur | null },
): Promise<'inserted' | 'merged' | 'skipped'> {
  const title = loop.title.trim();
  if (!title) return 'skipped';

  const { data: existing } = await adminClient
    .from('open_loops')
    .select('id, body, tags, due_at')
    .eq('user_id', userId)
    .eq('status', 'open')
    .ilike('title', title)
    .maybeSingle();

  if (existing) {
    await adminClient
      .from('open_loops')
      .update({
        body: loop.body ?? existing.body,
        due_at: loop.due_at ?? existing.due_at,
        tags: [...new Set([...(existing.tags ?? []), ...(loop.tags ?? [])])],
        ...(loop.recur !== undefined ? { recur: loop.recur } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id);
    return 'merged';
  }

  await adminClient.from('open_loops').insert({
    user_id: userId,
    title,
    body: loop.body ?? null,
    due_at: loop.due_at ?? null,
    tags: loop.tags ?? [],
    source: loop.source ?? 'chat',
    recur: loop.recur ?? null,
  });
  return 'inserted';
}

export async function setLoopStatus(userId: string, id: string, status: 'done' | 'dropped'): Promise<void> {
  const { data: loop } = await adminClient
    .from('open_loops')
    .select('title, body, tags, due_at, recur, source, status')
    .eq('user_id', userId)
    .eq('id', id)
    .maybeSingle();

  await adminClient
    .from('open_loops')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('id', id);

  // Completing a recurring task spawns the next occurrence. Dropping ends it.
  if (status === 'done' && loop?.recur && loop.status === 'open') {
    const base = loop.due_at ? new Date(loop.due_at) : new Date();
    await adminClient.from('open_loops').insert({
      user_id: userId,
      title: loop.title,
      body: loop.body ?? null,
      tags: loop.tags ?? [],
      source: loop.source ?? 'chat',
      recur: loop.recur,
      due_at: nextRecurDate(loop.recur as Recur, base),
    });
  }
}

export async function setLoopDue(userId: string, id: string, due_at: string | null): Promise<void> {
  await adminClient
    .from('open_loops')
    .update({ due_at, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('id', id);
}

const isExam = (l: OpenLoop) =>
  l.tags.some((t) => /exam|midterm|final|test|quiz/i.test(t)) || /exam|midterm|final\b|test\b/i.test(l.title);

/**
 * Open, dated loops that have crossed into the deadline window (exam-type 72h,
 * everything else 48h) and haven't been nudged yet. Most-urgent first.
 */
export async function loopsDueForNudge(userId: string): Promise<OpenLoop[]> {
  const now = Date.now();
  const { data } = await adminClient
    .from('open_loops')
    .select('id, title, body, due_at, status, tags, source, last_nudged_at')
    .eq('user_id', userId)
    .eq('status', 'open')
    .is('last_nudged_at', null)
    .not('due_at', 'is', null)
    .gte('due_at', new Date(now).toISOString())               // not already past
    .lte('due_at', new Date(now + 72 * 3600_000).toISOString()) // within the widest window
    .order('due_at', { ascending: true });

  return ((data ?? []) as (OpenLoop & { last_nudged_at: string | null })[]).filter((l) => {
    const hoursOut = (Date.parse(l.due_at!) - now) / 3600_000;
    return hoursOut <= (isExam(l) ? 72 : 48);
  });
}

export async function markNudged(userId: string, id: string): Promise<void> {
  await adminClient
    .from('open_loops')
    .update({ last_nudged_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('id', id);
}
