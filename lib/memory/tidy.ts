import { adminClient } from '@/lib/supabase.server';
import { audit } from '@/lib/hub/audit';
import { setLoopStatus } from '@/lib/memory/loops';

// Data-hygiene scan: cheap, deterministic detectors that spot problems in
// Calliad's own tables (duplicate tasks, long-stale tasks, duplicate taste /
// restaurant rows) and turn them into a numbered "fix these?" list Noah picks
// from — same UX as the memory sweep.

export interface TidyItem {
  kind: 'dupe-loops' | 'stale-loop' | 'dupe-taste' | 'dupe-restaurant';
  summary: string;
  executor: 'drop_loops' | 'delete_taste' | 'delete_restaurant_prefs';
  ids: string[];
}

const STOP = /\b(the|a|an|my|our|to|for|of|on|in|at|is|are)\b/g;
const norm = (s: string) =>
  s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ').replace(STOP, ' ').replace(/\s+/g, ' ').trim();

const STALE_DAYS = 21;

export async function scanForTidy(userId: string): Promise<TidyItem[]> {
  const items: TidyItem[] = [];
  const claimedLoopIds = new Set<string>();

  // ── open_loops: duplicates + long-stale ────────────────────────────────
  const { data: loops } = await adminClient
    .from('open_loops')
    .select('id, title, due_at, created_at, tags')
    .eq('user_id', userId)
    .eq('status', 'open')
    .order('created_at', { ascending: true });

  const byTitle = new Map<string, { id: string; title: string; due_at: string | null; created_at: string }[]>();
  for (const l of loops ?? []) {
    const k = norm(l.title);
    if (k.length < 3) continue;
    (byTitle.get(k) ?? byTitle.set(k, []).get(k)!).push(l);
  }
  for (const group of byTitle.values()) {
    if (group.length < 2) continue;
    // keep the one with the soonest deadline, else the oldest (most-established)
    const keep = [...group].sort((a, b) => {
      if (a.due_at && b.due_at) return a.due_at.localeCompare(b.due_at);
      if (a.due_at) return -1;
      if (b.due_at) return 1;
      return a.created_at.localeCompare(b.created_at);
    })[0];
    const drop = group.filter((g) => g.id !== keep.id);
    drop.forEach((g) => claimedLoopIds.add(g.id));
    claimedLoopIds.add(keep.id);
    items.push({
      kind: 'dupe-loops',
      summary: `Duplicate task "${keep.title}" (${group.length} copies) — keep 1, drop ${drop.length}`,
      executor: 'drop_loops',
      ids: drop.map((g) => g.id),
    });
  }

  const staleBefore = Date.now() - STALE_DAYS * 86400000;
  for (const l of loops ?? []) {
    if (claimedLoopIds.has(l.id)) continue;
    if (!l.due_at) continue;
    const due = new Date(l.due_at).getTime();
    if (Number.isNaN(due) || due >= staleBefore) continue;
    const days = Math.round((Date.now() - due) / 86400000);
    items.push({
      kind: 'stale-loop',
      summary: `Stale task "${l.title}" — due ${days} days ago, still open. Drop it?`,
      executor: 'drop_loops',
      ids: [l.id],
    });
  }

  // ── taste_log: exact-title duplicates ─────────────────────────────────
  const { data: taste } = await adminClient
    .from('taste_log')
    .select('id, title, kind, verdict, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });
  const tByTitle = new Map<string, { id: string; title: string; verdict: string | null; created_at: string }[]>();
  for (const t of taste ?? []) {
    const k = norm(t.title);
    if (k.length < 2) continue;
    (tByTitle.get(k) ?? tByTitle.set(k, []).get(k)!).push(t);
  }
  for (const group of tByTitle.values()) {
    if (group.length < 2) continue;
    const keep = group[group.length - 1]; // newest verdict wins
    const drop = group.slice(0, -1);
    items.push({
      kind: 'dupe-taste',
      summary: `"${keep.title}" logged ${group.length}× in the taste log — keep the latest (${keep.verdict ?? 'no verdict'}), drop ${drop.length}`,
      executor: 'delete_taste',
      ids: drop.map((g) => g.id),
    });
  }

  // ── restaurant_prefs: same place on both the "want" and "ranked" list ──
  const { data: rest } = await adminClient
    .from('restaurant_prefs')
    .select('id, name, city, status, score')
    .eq('user_id', userId);
  const rByKey = new Map<string, { id: string; name: string; status: string; score: number | null }[]>();
  for (const r of rest ?? []) {
    const k = norm(`${r.name} ${r.city ?? ''}`);
    if (k.length < 2) continue;
    (rByKey.get(k) ?? rByKey.set(k, []).get(k)!).push(r);
  }
  for (const group of rByKey.values()) {
    const want = group.filter((g) => g.status === 'want');
    const ranked = group.filter((g) => g.status === 'ranked');
    if (want.length && ranked.length) {
      items.push({
        kind: 'dupe-restaurant',
        summary: `"${ranked[0].name}" is on your want-to-try list but you've also rated it (${ranked[0].score ?? '?'}) — drop the want entry`,
        executor: 'delete_restaurant_prefs',
        ids: want.map((g) => g.id),
      });
    }
  }

  return items.slice(0, 8);
}

/** Run the picked fixes. Returns a one-line recap. */
export async function applyTidyItems(userId: string, items: TidyItem[]): Promise<string> {
  let loopsDropped = 0;
  let tasteDeleted = 0;
  let restDeleted = 0;
  for (const it of items) {
    try {
      if (it.executor === 'drop_loops') {
        for (const id of it.ids) { await setLoopStatus(userId, id, 'dropped'); loopsDropped++; }
      } else if (it.executor === 'delete_taste') {
        await adminClient.from('taste_log').delete().eq('user_id', userId).in('id', it.ids);
        tasteDeleted += it.ids.length;
      } else if (it.executor === 'delete_restaurant_prefs') {
        await adminClient.from('restaurant_prefs').delete().eq('user_id', userId).in('id', it.ids);
        restDeleted += it.ids.length;
      }
    } catch { /* skip a bad item */ }
  }
  await audit.log('outbound_message', 'calliad', null, {
    action: 'tidy_apply', of: items.length, loopsDropped, tasteDeleted, restDeleted,
  });
  const parts: string[] = [];
  if (loopsDropped) parts.push(`dropped ${loopsDropped} task${loopsDropped === 1 ? '' : 's'}`);
  if (tasteDeleted) parts.push(`removed ${tasteDeleted} taste-log dupe${tasteDeleted === 1 ? '' : 's'}`);
  if (restDeleted) parts.push(`removed ${restDeleted} restaurant dupe${restDeleted === 1 ? '' : 's'}`);
  return parts.length ? `Done — ${parts.join(', ')}.` : 'Nothing changed.';
}

export const isTidyRequest = (t: string) =>
  /\b(tidy( up| my (lists|tasks))?|clean ?up my (lists|tasks|data)|housekeeping|declutter|dedupe|deduplicate|any (duplicates|dupes|stale (tasks|loops|items)|cleanup)|check for duplicates)\b/i.test(t);
