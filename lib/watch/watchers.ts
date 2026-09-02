import { adminClient } from '@/lib/supabase.server';
import { audit } from '@/lib/hub/audit';

export type WatcherKind = 'page' | 'weather_event' | 'flight';
export type WatcherStatus = 'active' | 'paused' | 'done';

export interface Watcher {
  id: string;
  user_id: string;
  kind: WatcherKind;
  label: string;
  spec: Record<string, unknown>;
  last_state: Record<string, unknown> | null;
  status: WatcherStatus;
  interval_min: number;
  next_check_at: string;
  last_checked_at: string | null;
  last_change_at: string | null;
  created_at: string;
}

const SEL =
  'id, user_id, kind, label, spec, last_state, status, interval_min, next_check_at, last_checked_at, last_change_at, created_at';

const DEFAULT_INTERVAL: Record<WatcherKind, number> = {
  page: 60,
  weather_event: 240,
  flight: 25,
};

export async function createWatcher(
  userId: string,
  w: { kind: WatcherKind; label: string; spec?: Record<string, unknown>; intervalMin?: number },
): Promise<Watcher | null> {
  // de-dupe against an active watcher of the same kind with the same label or URL
  const { data: existing } = await adminClient
    .from('watchers')
    .select('label, spec')
    .eq('user_id', userId)
    .eq('kind', w.kind)
    .eq('status', 'active');
  const url = String(w.spec?.url ?? '');
  for (const e of existing ?? []) {
    if ((e.label as string).toLowerCase() === w.label.toLowerCase()) return null;
    if (url && String((e.spec as Record<string, unknown>)?.url ?? '') === url) return null;
  }

  const { data } = await adminClient
    .from('watchers')
    .insert({
      user_id: userId,
      kind: w.kind,
      label: w.label,
      spec: w.spec ?? {},
      interval_min: w.intervalMin ?? DEFAULT_INTERVAL[w.kind],
      next_check_at: new Date(Date.now() + 60_000).toISOString(), // first check ~1 min out
    })
    .select(SEL)
    .maybeSingle();
  if (data) await audit.log('tool_call', 'calliad', null, { tool: 'watcher_add', kind: w.kind, label: w.label });
  return (data as Watcher) ?? null;
}

export async function listWatchers(userId: string, includeInactive = false): Promise<Watcher[]> {
  let q = adminClient.from('watchers').select(SEL).eq('user_id', userId).order('created_at', { ascending: false });
  if (!includeInactive) q = q.neq('status', 'done');
  const { data } = await q;
  return (data ?? []) as Watcher[];
}

export async function matchWatcher(userId: string, hint: string): Promise<Watcher | null> {
  const h = hint.toLowerCase().replace(/^(the|that|my)\s+/, '').replace(/\s+(watcher|watch)$/, '').trim();
  if (h.length < 2) return null;
  const rows = await listWatchers(userId);
  return (
    rows.find((r) => {
      const l = r.label.toLowerCase();
      const url = String(r.spec?.url ?? '').toLowerCase();
      return l === h || l.includes(h) || h.includes(l) || (url && (url.includes(h) || h.includes(url)));
    }) ?? null
  );
}

export async function removeWatcher(userId: string, id: string): Promise<void> {
  await adminClient.from('watchers').update({ status: 'done' }).eq('user_id', userId).eq('id', id);
}

export async function pauseWatcher(userId: string, id: string, paused: boolean): Promise<void> {
  await adminClient
    .from('watchers')
    .update({ status: paused ? 'paused' : 'active', next_check_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('id', id);
}

/** Compact block so the brain can answer "what are you watching for me?". */
export async function watchersContextLine(userId: string): Promise<string> {
  const rows = await listWatchers(userId);
  const active = rows.filter((r) => r.status === 'active');
  if (!active.length) return '';
  const lines = active.map((r) => {
    const last = r.last_checked_at
      ? ` (checked ${new Date(r.last_checked_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', timeZone: process.env.TZ_DEFAULT ?? 'America/New_York' })})`
      : ' (not checked yet)';
    return `- ${r.label}${last}`;
  });
  return `## Watchers (things Calliad is checking on a schedule)\n${lines.join('\n')}\n\nAnswer "what are you watching" from this. Full control is on the /watchers screen.`;
}
