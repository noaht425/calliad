import { adminClient } from '@/lib/supabase.server';

export interface OpenLoop {
  id: string;
  title: string;
  body: string | null;
  due_at: string | null;
  status: 'open' | 'done' | 'dropped';
  tags: string[];
  source: string;
}

/** Open loops that are due soon or match any of the given tags. Most-urgent first. */
export async function relevantLoops(
  userId: string,
  opts: { dueWithinDays?: number; tags?: string[]; cap?: number } = {},
): Promise<OpenLoop[]> {
  const cap = opts.cap ?? 10;
  const horizon = new Date(Date.now() + (opts.dueWithinDays ?? 14) * 86400000).toISOString();

  const { data } = await adminClient
    .from('open_loops')
    .select('id, title, body, due_at, status, tags, source')
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
    .select('id, title, body, due_at, status, tags, source')
    .eq('user_id', userId)
    .eq('status', 'open')
    .order('due_at', { ascending: true, nullsFirst: false });
  return (data ?? []) as OpenLoop[];
}

/** Insert, or merge into an existing open loop with a matching title (case-insensitive). */
export async function upsertLoop(
  userId: string,
  loop: { title: string; body?: string | null; due_at?: string | null; tags?: string[]; source?: string },
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
  });
  return 'inserted';
}

export async function setLoopStatus(userId: string, id: string, status: 'done' | 'dropped'): Promise<void> {
  await adminClient
    .from('open_loops')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('id', id);
}
