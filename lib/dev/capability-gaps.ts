import { adminClient } from '@/lib/supabase.server';
import { audit } from '@/lib/hub/audit';
import { embed } from '@/lib/memory/embed';

// "Self-improve", step 1: when Noah asks for something Calliad genuinely has
// no way to do, the miss gets drafted into a short spec and filed as a GitHub
// issue instead of just evaporating in the conversation. Doug's Calliad has an
// explicit-ask version of this (save an idea to the backlog on request, on
// GitHub too) — this is the automatic version, Calliad noticing the gap on its
// own. No code gets written or merged here; a human (or a later Claude Code
// session) still decides what to build.

const REPO = process.env.GITHUB_REPO || 'noaht425/calliad';
const TOKEN = () => process.env.GITHUB_TOKEN ?? '';
export const capabilityGapsAvailable = () => Boolean(TOKEN());

export interface GapDraft {
  title: string;           // short handle, e.g. "Order a rideshare" — used for dedupe
  whyNotPossible: string;  // one sentence: what's missing
  roughApproach?: string;  // one short paragraph, omit if genuinely unscoped
  exampleText: string;     // Noah's verbatim message, for context
}

function issueBody(g: GapDraft, hitCount: number): string {
  const lines = [
    '## What Noah asked',
    `> ${g.exampleText.replace(/\n/g, '\n> ')}`,
    '',
    "## Why Calliad couldn't do it",
    g.whyNotPossible,
  ];
  if (g.roughApproach) lines.push('', '## Rough shape', g.roughApproach);
  if (hitCount > 1) lines.push('', `_Asked ${hitCount} times so far._`);
  lines.push('', '---', "_Filed automatically by Calliad's capability-gap detector — nothing here is implemented yet._");
  return lines.join('\n');
}

async function fileGithubIssue(g: GapDraft): Promise<{ number: number; url: string } | null> {
  if (!capabilityGapsAvailable()) return null;
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/issues`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TOKEN()}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({
        title: `[capability gap] ${g.title}`,
        body: issueBody(g, 1),
        labels: ['capability-gap'],
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      await audit.log('error', 'system', null, { where: 'capability_gaps.file', status: res.status, body: await res.text().catch(() => '') });
      return null;
    }
    const j = (await res.json()) as { number: number; html_url: string };
    return { number: j.number, url: j.html_url };
  } catch (err) {
    await audit.log('error', 'system', null, { where: 'capability_gaps.file', message: String(err) });
    return null;
  }
}

const NORM = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const STOP = new Set(['the', 'a', 'an', 'to', 'my', 'me', 'for', 'and', 'with', 'on', 'of']);

/** Token-overlap fallback — catches near-identical rewordings when embeddings
 *  are unavailable, or as a second vote alongside them. */
function tokenMatch(rows: { id: string; title: string; hit_count: number }[], title: string): { id: string; hit_count: number } | null {
  const tokens = NORM(title).split(' ').filter((w) => w.length > 2 && !STOP.has(w));
  if (!tokens.length) return null;
  const scored = rows
    .map((r) => {
      const hay = NORM(r.title);
      const s = tokens.reduce((acc, w) => acc + (hay.includes(w) ? 1 : 0), 0);
      return { r, s };
    })
    .filter((x) => x.s >= Math.max(1, Math.ceil(tokens.length * 0.6)))
    .sort((a, b) => b.s - a.s);
  return scored[0] ? { id: scored[0].r.id, hit_count: scored[0].r.hit_count } : null;
}

/** Same gap, worded differently — "book an Uber" vs. "order a rideshare" won't
 *  share a token but should still collapse into one. Embeddings catch that;
 *  token overlap (above) is the fallback/second vote when they don't apply or
 *  the embedding key is unavailable. Either signal firing counts as a match. */
async function findSimilarGap(userId: string, title: string, titleVec: number[] | null): Promise<{ id: string; hit_count: number } | null> {
  if (titleVec) {
    const { data } = await adminClient.rpc('match_capability_gaps', {
      query_embedding: titleVec, match_user_id: userId, match_count: 3,
    });
    // Threshold calibrated against real gemini-embedding-001 output: genuinely-
    // same-gap title pairs ("book an Uber" / "order a rideshare") scored
    // 0.79-0.96; clearly-different pairs topped out at 0.64. 0.75 sits with
    // margin on both sides.
    const hit = (data as { id: string; title: string; hit_count: number; similarity: number }[] | null)?.find((r) => r.similarity >= 0.75);
    if (hit) return { id: hit.id, hit_count: hit.hit_count };
  }
  const { data: rows } = await adminClient
    .from('capability_gaps')
    .select('id, title, hit_count')
    .eq('user_id', userId)
    .in('status', ['open', 'filed'])
    .limit(100);
  return tokenMatch((rows ?? []) as { id: string; title: string; hit_count: number }[], title);
}

/**
 * Record a detected gap. First time it's seen (no similar open/filed gap on
 * file), it's drafted into a GitHub issue; a repeat just bumps hit_count /
 * last_seen_at — no duplicate issues for the same recurring miss.
 */
export async function recordCapabilityGap(userId: string, g: GapDraft): Promise<void> {
  const title = g.title.trim().slice(0, 140);
  if (!title) return;

  const titleVec = await embed(title).catch(() => null);

  const existing = await findSimilarGap(userId, title, titleVec).catch(() => null);
  if (existing) {
    await adminClient
      .from('capability_gaps')
      .update({ hit_count: existing.hit_count + 1, last_seen_at: new Date().toISOString() })
      .eq('id', existing.id);
    return;
  }

  const issue = await fileGithubIssue(g);
  await adminClient.from('capability_gaps').insert({
    user_id: userId,
    title,
    description: g.whyNotPossible + (g.roughApproach ? `\n\n${g.roughApproach}` : ''),
    example_text: g.exampleText.slice(0, 2000),
    embedding: titleVec,
    github_issue_number: issue?.number ?? null,
    github_issue_url: issue?.url ?? null,
    status: issue ? 'filed' : 'open',
  });
  await audit.log('tool_call', 'calliad', null, { tool: 'capability_gap', title, filed: !!issue });
}
