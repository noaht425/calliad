import Anthropic from '@anthropic-ai/sdk';
import { adminClient } from '@/lib/supabase.server';
import { audit } from '@/lib/hub/audit';
import { anthropicCostUsd } from '@/lib/router/tiers';

// Beli has no API. Noah screenshots his ranked / want-to-try lists; Sonnet
// vision pulls the restaurants; they land in restaurant_prefs and feed the
// restaurant hand-off + profile.

const anthropic = new Anthropic();

export const isBeliShare = (t: string) =>
  /\bbeli\b/i.test(t) ||
  /\b(my|these are (my)?) (restaurant|resto) (rank|list|score|pref)/i.test(t) ||
  /\b(here('?s| are)|adding) .{0,25}(restaurant|place)s? (i('?ve| have)? )?(been|rank|rated|want)/i.test(t);

interface BeliRow {
  name: string;
  city: string | null;
  score: number | null;
  category: string | null;
  note: string | null;
  status: 'ranked' | 'want';
}

const dedupeKey = (name: string, city: string | null) =>
  `${name.toLowerCase().trim()}|${(city ?? '').toLowerCase().trim()}`;

/** One screenshot → the restaurants in it. */
export async function extractBeli(image: { media_type: string; data: string }): Promise<{ rows: BeliRow[]; costUsd: number }> {
  const started = Date.now();
  const msg = await anthropic.messages.create({
    model: 'claude-sonnet-5',
    max_tokens: 1500,
    system:
      "This is a screenshot from Beli, a restaurant-ranking app. Extract EVERY restaurant visible in the list. " +
      'For each: name; city or neighbourhood if shown (else null); the numeric score if shown, 0–10 (else null); ' +
      'cuisine / category if shown (else null); any short note or tag (else null). ' +
      'status = "ranked" when there is a score (a place Noah has been), "want" when it is on a want-to-try list with no score. ' +
      'Return ONLY a minified JSON array like [{"name":"","city":null,"score":8.7,"category":null,"note":null,"status":"ranked"}]. ' +
      'No prose, no markdown fence. If the image has no restaurant list, return [].',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: image.media_type as 'image/jpeg', data: image.data } },
          { type: 'text', text: 'Extract the restaurants.' },
        ],
      },
    ],
  });
  const costUsd = anthropicCostUsd('claude-sonnet-5', msg.usage);
  await audit.modelCall({
    conversation_id: null, purpose: 'beli_extract', tier: 'T2', model: 'claude-sonnet-5',
    input_tokens: msg.usage.input_tokens, cached_read_tokens: msg.usage.cache_read_input_tokens ?? 0,
    cache_write_tokens: msg.usage.cache_creation_input_tokens ?? 0, output_tokens: msg.usage.output_tokens,
    cost_usd: costUsd, latency_ms: Date.now() - started,
  });

  const raw = msg.content.filter((b) => b.type === 'text').map((b) => (b as Anthropic.TextBlock).text).join('').replace(/```json\n?|\n?```/g, '').trim();
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return { rows: [], costUsd }; }
  if (!Array.isArray(parsed)) return { rows: [], costUsd };

  const rows: BeliRow[] = [];
  for (const p of parsed as Record<string, unknown>[]) {
    const name = typeof p.name === 'string' ? p.name.trim() : '';
    if (!name) continue;
    const score = typeof p.score === 'number' && p.score >= 0 && p.score <= 10 ? Math.round(p.score * 10) / 10 : null;
    rows.push({
      name,
      city: typeof p.city === 'string' && p.city.trim() ? p.city.trim() : null,
      score,
      category: typeof p.category === 'string' && p.category.trim() ? p.category.trim() : null,
      note: typeof p.note === 'string' && p.note.trim() ? p.note.trim() : null,
      status: p.status === 'want' || score === null ? 'want' : 'ranked',
    });
  }
  return { rows, costUsd };
}

export async function saveBeliRows(userId: string, rows: BeliRow[]): Promise<{ added: number; updated: number }> {
  if (!rows.length) return { added: 0, updated: 0 };
  const { data: existing } = await adminClient.from('restaurant_prefs').select('dedupe_key').eq('user_id', userId);
  const have = new Set((existing ?? []).map((x) => x.dedupe_key as string));
  let added = 0;
  let updated = 0;
  for (const r of rows) {
    const key = dedupeKey(r.name, r.city);
    (have.has(key) ? updated++ : added++);
    await adminClient.from('restaurant_prefs').upsert(
      {
        user_id: userId, name: r.name, city: r.city, score: r.score, category: r.category,
        note: r.note, status: r.status, source: 'beli', dedupe_key: key, updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,dedupe_key' },
    );
  }
  await audit.log('outbound_message', 'calliad', null, { tool: 'beli_save', added, updated });
  return { added, updated };
}

export async function listPrefs(userId: string) {
  const { data } = await adminClient
    .from('restaurant_prefs')
    .select('id, name, city, score, category, note, status')
    .eq('user_id', userId)
    .order('score', { ascending: false, nullsFirst: false })
    .order('name');
  return data ?? [];
}

/** Context block for the restaurant hand-off — top-rated + favoured cuisines + want list. */
export async function restaurantPrefsBlock(userId: string): Promise<string> {
  const all = await listPrefs(userId);
  if (!all.length) return '';
  const ranked = all.filter((r) => r.status === 'ranked' && r.score != null);
  const want = all.filter((r) => r.status === 'want');

  const cuisineScore = new Map<string, { sum: number; n: number }>();
  for (const r of ranked) {
    if (!r.category) continue;
    const c = cuisineScore.get(r.category) ?? { sum: 0, n: 0 };
    c.sum += Number(r.score);
    c.n += 1;
    cuisineScore.set(r.category, c);
  }
  const favCuisines = [...cuisineScore.entries()]
    .filter(([, v]) => v.n >= 2)
    .sort((a, b) => b[1].sum / b[1].n - a[1].sum / a[1].n)
    .slice(0, 5)
    .map(([c, v]) => `${c} (${(v.sum / v.n).toFixed(1)} avg over ${v.n})`);

  const L = ['## Noah\'s restaurant taste (from Beli)'];
  L.push('', 'Top-rated places he\'s been:');
  for (const r of ranked.slice(0, 15)) L.push(`- ${r.name}${r.city ? `, ${r.city}` : ''} — ${r.score}${r.category ? ` · ${r.category}` : ''}${r.note ? ` · ${r.note}` : ''}`);
  if (favCuisines.length) L.push('', `Cuisines he scores highest: ${favCuisines.join(', ')}.`);
  if (want.length) L.push('', `On his want-to-try list: ${want.slice(0, 20).map((r) => r.name + (r.city ? ` (${r.city})` : '')).join(', ')}.`);
  L.push('', 'Use this to steer a recommendation toward what he actually likes; if a want-to-try place fits the ask, surface it.');
  return L.join('\n');
}
