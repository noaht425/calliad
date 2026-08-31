import fs from 'node:fs';
import path from 'node:path';
import { adminClient } from '@/lib/supabase.server';
import { audit } from '@/lib/hub/audit';

// "Would I like this?" — pattern L + M. Pull the candidate's metadata, hand the
// brain the full taste log + Noah's bail patterns as ground truth. NO spoilers.

const TASTE_MD = (() => {
  try {
    const raw = fs.readFileSync(path.join(process.cwd(), 'content/taste-log.md'), 'utf8');
    const idx = raw.indexOf('## What makes Noah bail');
    return idx >= 0 ? raw.slice(idx) : '';
  } catch {
    return '';
  }
})();

type Kind = 'book' | 'screen' | 'game' | 'unknown';

function guessKind(q: string): Kind {
  if (/\b(book|novel|read|author|series of books)\b/i.test(q)) return 'book';
  if (/\b(watch|show|series|film|movie|season|episode)\b/i.test(q)) return 'screen';
  if (/\b(game|play|playthrough|roguelike|rpg)\b/i.test(q)) return 'game';
  return 'unknown';
}

function extractTitle(q: string): string {
  const quoted = q.match(/["'“](.+?)["'”]/)?.[1];
  if (quoted) return quoted;
  return q
    .replace(/\b(would i (like|enjoy|hate|bounce off)|should i (watch|read|play|start|bother with)|do you think i'?d (like|enjoy)|worth (watching|reading|playing)|any good|the (new )?(book|show|series|film|movie|game|tv show)|watching|reading|playing|on (netflix|hbo|hulu|disney\+?|prime|apple tv\+?|max)|by \w+ ?\w*$)\b/gi, ' ')
    .replace(/[?.!,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function bookMeta(title: string): Promise<string | null> {
  try {
    const r = await fetch(
      `https://openlibrary.org/search.json?limit=1&fields=title,author_name,first_sentence,subject&q=${encodeURIComponent(title)}`,
      { signal: AbortSignal.timeout(8000) },
    );
    if (!r.ok) return null;
    const j = (await r.json()) as { docs?: { title: string; author_name?: string[]; first_sentence?: string[]; subject?: string[] }[] };
    const d = j.docs?.[0];
    if (!d) return null;
    return `Open Library: "${d.title}"${d.author_name?.[0] ? ` by ${d.author_name[0]}` : ''}. Subjects: ${(d.subject ?? []).slice(0, 12).join(', ') || '(none)'}.`;
  } catch {
    return null;
  }
}

async function screenMeta(title: string): Promise<string | null> {
  const key = process.env.TMDB_API_KEY;
  if (!key) return null;
  try {
    const r = await fetch(
      `https://api.themoviedb.org/3/search/multi?api_key=${key}&query=${encodeURIComponent(title)}`,
      { signal: AbortSignal.timeout(8000) },
    );
    if (!r.ok) return null;
    const j = (await r.json()) as { results?: { media_type: string; title?: string; name?: string; overview?: string; genre_ids?: number[]; first_air_date?: string; release_date?: string }[] };
    const d = j.results?.find((x) => x.media_type === 'movie' || x.media_type === 'tv');
    if (!d) return null;
    const name = d.title ?? d.name;
    const year = (d.release_date ?? d.first_air_date ?? '').slice(0, 4);
    return `TMDB: "${name}"${year ? ` (${year})` : ''}, ${d.media_type === 'tv' ? 'TV series' : 'film'}. Premise: ${d.overview ?? '(none)'}`;
  } catch {
    return null;
  }
}

export async function wouldILike(userId: string, query: string): Promise<string | undefined> {
  const title = extractTitle(query);
  if (!title || title.length < 2) return undefined;
  const kind = guessKind(query);

  const [{ data: log }, meta] = await Promise.all([
    adminClient.from('taste_log').select('title, kind, verdict, why').eq('user_id', userId).order('created_at'),
    kind === 'book' ? bookMeta(title) : kind === 'screen' ? screenMeta(title) : Promise.resolve(null),
  ]);

  await audit.log('tool_call', 'calliad', null, { tool: 'would_i_like', title, kind, hasMeta: Boolean(meta) });

  const logLines = (log ?? []).map((r) => `- ${r.title} [${r.kind}] — ${r.verdict}${r.why ? `: ${r.why}` : ''}`).join('\n');

  return [
    `## "Would I like this?" — candidate: **${title}**${kind !== 'unknown' ? ` (${kind})` : ''}`,
    meta ? `\nMetadata — ${meta}` : `\nNo external metadata (${kind === 'screen' ? 'no TMDB key set' : 'not found'}) — reason from the taste log.`,
    `\n### Noah's taste log (verdicts + why)`,
    logLines || '(empty)',
    TASTE_MD ? `\n### ${TASTE_MD.trim()}` : '',
    `\n### Instructions`,
    `Give a real verdict — probably yes / probably not / mixed — in your voice. Ground it in specific rows above ("the slow-burn kind you bailed on with X"). If it's a myth retelling, weigh fidelity to the source. NO plot spoilers, ever — subject and vibe only. Two or three sentences.`,
  ].filter(Boolean).join('\n');
}
