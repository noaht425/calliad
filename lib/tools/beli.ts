import { adminClient } from '@/lib/supabase.server';
import { audit } from '@/lib/hub/audit';
import { t1Text } from '@/lib/llm/gemini';
import { getPrefs } from '@/lib/profile/prefs';
import { nearbySpotsBlock } from '@/lib/tools/foursquare';

// Beli has no API. Noah screenshots his ranked / want-to-try lists; Gemini Flash
// vision pulls the restaurants (structured OCR, not judgement — ~1/10th the cost
// of a Sonnet vision call); they land in restaurant_prefs and feed the
// restaurant hand-off + profile.

export const isBeliShare = (t: string) =>
  /\bbeli\b/i.test(t) ||
  /\b(my|these are (my)?) (restaurant|resto) (rank|list|score|pref)/i.test(t) ||
  /\b(here('?s| are)|adding) .{0,25}(restaurant|place)s? (i('?ve| have)? )?(been|rank|rated|want)/i.test(t);

export type PlaceType = 'restaurant' | 'cafe' | 'bakery' | 'dessert' | 'bar' | 'other';
const PLACE_TYPES: PlaceType[] = ['restaurant', 'cafe', 'bakery', 'dessert', 'bar', 'other'];
const PLACE_TYPE_LABEL: Record<PlaceType, string> = {
  restaurant: 'Restaurants', cafe: 'Cafés', bakery: 'Bakeries', dessert: 'Dessert spots', bar: 'Bars', other: 'Other',
};

function normPlaceType(v: unknown): PlaceType | null {
  if (typeof v !== 'string') return null;
  const s = v.toLowerCase().trim();
  if (PLACE_TYPES.includes(s as PlaceType)) return s as PlaceType;
  if (/coffee|espresso|caf[eé]/.test(s)) return 'cafe';
  if (/bakery|pastr|patisserie|boulanger/.test(s)) return 'bakery';
  if (/dessert|ice cream|gelato|frozen|donut|doughnut|sweets?|candy|chocolat/.test(s)) return 'dessert';
  if (/\bbar\b|cocktail|wine bar|pub|brewery|speakeasy/.test(s)) return 'bar';
  if (/restaurant|dining|eatery|bistro|trattoria|osteria/.test(s)) return 'restaurant';
  return null;
}

interface BeliRow {
  name: string;
  city: string | null;
  score: number | null;
  category: string | null;
  place_type: PlaceType | null;
  note: string | null;
  status: 'ranked' | 'want';
}

const dedupeKey = (name: string, city: string | null) =>
  `${name.toLowerCase().trim()}|${(city ?? '').toLowerCase().trim()}`;

/** One or more screenshots → the places in them (deduped across shots). */
export async function extractBeli(
  images: { media_type: string; data: string }[],
): Promise<{ rows: BeliRow[]; costUsd: number }> {
  const shots = images.slice(0, 8);
  if (!shots.length) return { rows: [], costUsd: 0 };

  const prompt =
    'These are screenshots from Beli, a place-ranking app. Extract EVERY place visible across ALL the images. ' +
    'If the same place appears in more than one image, return it once. ' +
    'For each: name; city or neighbourhood if shown (else null); the numeric score if shown, 0–10 (else null); ' +
    'category = the CUISINE only (e.g. "Italian", "Thai", "sushi", "pizza") if shown, else null; ' +
    'place_type = one of "restaurant", "cafe", "bakery", "dessert", "bar", "other" — infer from the Beli tab/section header ' +
    '(Restaurants / Coffee & Cafés / Bakeries / Dessert / Bars) or obvious cues; use "restaurant" if unsure; ' +
    'any short note or tag (else null). ' +
    'status = "ranked" when there is a score (a place Noah has been), "want" when it is on a want-to-try list with no score. ' +
    'Return ONLY a minified JSON array like [{"name":"","city":null,"score":8.7,"category":null,"place_type":"restaurant","note":null,"status":"ranked"}]. ' +
    'No prose, no markdown fence. If the images have no place list, return [].';

  const raw = (
    await t1Text(
      'beli_extract',
      prompt,
      shots.map((im) => ({ inlineData: { mimeType: im.media_type || 'image/jpeg', data: im.data } })),
      { flash: true, maxOutputTokens: 2500 },
    )
  )?.replace(/```json\n?|\n?```/g, '').trim();

  const costUsd = 0; // metered in audit.modelCall by t1Text
  if (!raw) return { rows: [], costUsd };
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
      place_type: normPlaceType(p.place_type),
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
        place_type: r.place_type, note: r.note, status: r.status, source: 'beli',
        dedupe_key: key, updated_at: new Date().toISOString(),
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
    .select('id, name, city, score, category, place_type, note, status')
    .eq('user_id', userId)
    .order('score', { ascending: false, nullsFirst: false })
    .order('name');
  return data ?? [];
}

export interface RestaurantVerdict {
  name: string;
  city: string | null;
  score: number | null;
  category: string | null;
  place_type: PlaceType | null;
  note: string | null;
  status: 'ranked' | 'want';
  match: 'exact' | 'fuzzy';
}

/** Does Noah have an opinion on this place already? Name (+ optional city) match. */
export async function lookupRestaurant(userId: string, name: string, city?: string | null): Promise<RestaurantVerdict | null> {
  const q = name.toLowerCase().trim().replace(/^(the|a)\s+/, '');
  if (q.length < 2) return null;
  const all = await listPrefs(userId);
  const norm = (s: string) => s.toLowerCase().trim().replace(/^(the|a)\s+/, '');
  const cityLc = city?.toLowerCase().trim() || null;
  const scored = all
    .map((r) => {
      const n = norm(r.name);
      let m = 0;
      if (n === q) m = 3;
      else if (n.startsWith(q) || q.startsWith(n)) m = 2;
      else if (n.includes(q) || q.includes(n)) m = 1;
      if (m && cityLc && r.city && r.city.toLowerCase().includes(cityLc)) m += 1;
      return { r, m };
    })
    .filter((x) => x.m > 0)
    .sort((a, b) => b.m - a.m);
  if (!scored.length) return null;
  const { r, m } = scored[0];
  return {
    name: r.name, city: r.city, score: r.score == null ? null : Number(r.score),
    category: r.category, place_type: (r.place_type as PlaceType | null) ?? null,
    note: r.note, status: r.status as 'ranked' | 'want',
    match: m >= 3 ? 'exact' : 'fuzzy',
  };
}

/** Context block for the restaurant hand-off — top-rated (by type) + favoured cuisines + want list. */
export async function restaurantPrefsBlock(userId: string): Promise<string> {
  const all = await listPrefs(userId);
  if (!all.length) return '';
  const ranked = all.filter((r) => r.status === 'ranked' && r.score != null);
  const want = all.filter((r) => r.status === 'want');
  const pt = (r: { place_type: string | null }): PlaceType => ((r.place_type as PlaceType | null) ?? 'restaurant');

  // Cuisine rollup only over actual restaurants — a dessert or café score
  // shouldn't move a cuisine average.
  const cuisineScore = new Map<string, { sum: number; n: number }>();
  for (const r of ranked) {
    if (!r.category || pt(r) !== 'restaurant') continue;
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

  const line = (r: typeof ranked[number]) =>
    `- ${r.name}${r.city ? `, ${r.city}` : ''} — ${r.score}${r.category ? ` · ${r.category}` : ''}${r.note ? ` · ${r.note}` : ''}`;

  const L = ["## Noah's place ratings (from Beli, 0–10)"];
  // Restaurants first and in full-ish; other types grouped so "where for dessert"
  // etc. has something to pull from.
  const order: PlaceType[] = ['restaurant', 'cafe', 'bakery', 'dessert', 'bar', 'other'];
  for (const type of order) {
    const group = ranked.filter((r) => pt(r) === type);
    if (!group.length) continue;
    const cap = type === 'restaurant' ? 15 : 8;
    L.push('', `${PLACE_TYPE_LABEL[type]} he's been (top ${Math.min(cap, group.length)}):`);
    for (const r of group.slice(0, cap)) L.push(line(r));
  }
  if (favCuisines.length) L.push('', `Cuisines he scores highest: ${favCuisines.join(', ')}.`);
  if (want.length) {
    const byType = new Map<PlaceType, string[]>();
    for (const r of want) {
      const arr = byType.get(pt(r)) ?? [];
      arr.push(r.name + (r.city ? ` (${r.city})` : ''));
      byType.set(pt(r), arr);
    }
    L.push('', 'Want-to-try:');
    for (const type of order) {
      const arr = byType.get(type);
      if (arr?.length) L.push(`- ${PLACE_TYPE_LABEL[type]}: ${arr.slice(0, 20).join(', ')}`);
    }
  }
  L.push(
    '',
    'Use this to answer "would I like <place>?" (match by name — say his score and how it sits vs his others), to steer recommendations toward what he actually rates highly, and to match the ask to the right type (dessert ask → dessert list, not restaurants). If a want-to-try place fits, surface it.',
  );
  return L.join('\n');
}

// ── "would I like this restaurant / where should I eat" ──────────────────────
const REC_INTENT =
  /\b(recommend|suggest|where should i (eat|go)|good (place|spot|restaurant|eats|dinner|lunch|brunch|dessert|coffee|bar)|places? (near|around|in|to try)|near (me|here|by)\b|near ?by|around here|somewhere (to eat|for (dinner|lunch|brunch|drinks|dessert|coffee))|what should i (eat|get|order)|hidden gem)\b/i;
const PLACE_HINT =
  /\b(restaurant|resto|eat|dine|dining|dinner|lunch|brunch|breakfast|food|cuisine|caf[eé]|coffee|bakery|dessert|ice cream|gelato|bar|cocktail|brewery|pub|spot|bite|takeout|take-out)\b/i;
const OPINION =
  /\b(would i (like|enjoy)|have i (been (to|there)|tried|eaten (at|there))|did i (like|rate|enjoy)|what did i (rate|think of|give)|my (score|rating) (for|of|on)|do i like|is it any good|any good\??$|worth (going|it|a visit)|thoughts on)\b/i;
const NAME_AFTER =
  /\b(?:like|at|to|about|is|was|rate[d]?|try|tried|been to|eaten at|think of|thoughts on|visit|check out|go to|for)\s+([A-Z][\w'&.\-]*(?:\s+(?:[A-Z][\w'&.\-]*|de|la|le|di|of|and|&)){0,3})/g;

export function isRestaurantTasteQuery(t: string): boolean {
  if (REC_INTENT.test(t) && PLACE_HINT.test(t)) return true;
  if (OPINION.test(t) && PLACE_HINT.test(t)) return true;
  if (/\b(where should i eat|somewhere to eat|good (dinner|lunch|brunch) spot|dessert (place|spot)|coffee (shop|spot|place))\b/i.test(t)) return true;
  return false;
}

/**
 * Block for the brain when Noah asks about a restaurant's worth or wants a
 * recommendation. Returns undefined for non-restaurant "would I like X" so the
 * taste-log path (books/screen/games) still handles those.
 */
export async function restaurantTasteBlock(userId: string, text: string): Promise<string | undefined> {
  const names = new Set<string>();
  for (const m of text.matchAll(NAME_AFTER)) names.add(m[1].trim());
  for (const m of text.matchAll(/(?<=[a-z0-9,]\s)([A-Z][\w'&.\-]*(?:\s+[A-Z][\w'&.\-]*){0,3})/g)) names.add(m[1].trim());

  const verdicts: RestaurantVerdict[] = [];
  const seen = new Set<string>();
  for (const n of [...names].slice(0, 8)) {
    const v = await lookupRestaurant(userId, n);
    if (v && !seen.has(v.name.toLowerCase())) { seen.add(v.name.toLowerCase()); verdicts.push(v); }
  }

  const rec = REC_INTENT.test(text) || isRestaurantTasteQuery(text);
  if (!verdicts.length && !rec) return undefined;

  const prefs = await restaurantPrefsBlock(userId);
  if (!prefs && !verdicts.length) return undefined;

  const L: string[] = ['## Restaurant taste check'];
  if (verdicts.length) {
    L.push('', 'Places from his question already on file:');
    for (const v of verdicts) {
      const verdict =
        v.status === 'want' ? 'on his want-to-try list (no score yet)'
        : v.score != null ? `he rated it ${v.score}/10`
        : 'logged, no score';
      L.push(
        `- **${v.name}**${v.city ? `, ${v.city}` : ''} — ${verdict}` +
          `${v.category ? ` · ${v.category}` : ''}` +
          `${v.place_type && v.place_type !== 'restaurant' ? ` · ${v.place_type}` : ''}` +
          `${v.note ? ` · "${v.note}"` : ''}` +
          `${v.match === 'fuzzy' ? " (approximate name match — confirm it's the same place)" : ''}`,
      );
    }
  } else {
    L.push('', 'Nothing from his question is on file yet — reason from the ratings below.');
  }
  if (prefs) L.push('', prefs);
  const diet = (await getPrefs(userId).catch(() => ({ dietary_restrictions: [] as string[] }))).dietary_restrictions;
  if (diet.length) L.push('', `Dietary: ${diet.join(', ')} — factor this into any recommendation.`);

  // structured nearby data for a recommendation ask (dark without FOURSQUARE_API_KEY)
  if (rec) {
    const nearby = await nearbySpotsBlock(text).catch(() => '');
    if (nearby) L.push('', nearby);
  }

  L.push(
    '',
    '### Instructions',
    'Whether he\'d like a specific place: if it\'s on file, lead with his own score and where it sits among his other ratings; if not, estimate from his cuisine averages and highest-rated places (same cuisine / neighbourhood / vibe) and flag it as an estimate. ' +
      'For a recommendation or nearby options: start from his want-to-try list and top-rated places, then use the Foursquare list above (or web search if present) — cross-check every candidate against his cuisine preferences and ratings before naming it. ' +
      'Match the place type to the ask (dessert → dessert list, coffee → cafés). A few sentences, his voice, no menu spoilers.',
  );
  return L.join('\n');
}
