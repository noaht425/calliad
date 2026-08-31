import { audit } from '@/lib/hub/audit';

// A Bent Fork (abentfork.com) — Noah's own recipe site. It has no search API,
// but every recipe page carries clean JSON-LD Recipe schema and the sitemap
// lists them all, so: slug index from the sitemap + schema extraction per page.

const BASE = 'https://abentfork.com';
const UA = 'Calliad/1.0 (personal assistant)';

interface IndexEntry { slug: string; title: string }
let INDEX: IndexEntry[] | null = null;
let INDEX_AT = 0;

function titleFromSlug(slug: string): string {
  let s = slug;
  try { s = decodeURIComponent(slug); } catch { /* keep raw */ }
  return s
    .replace(/[^\x20-\x7E-]/g, '') // drop non-ASCII (CJK slug segments etc.)
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

async function getIndex(): Promise<IndexEntry[]> {
  if (INDEX && Date.now() - INDEX_AT < 3_600_000) return INDEX;
  try {
    const r = await fetch(`${BASE}/sitemap.xml`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10_000) });
    if (!r.ok) return INDEX ?? [];
    const xml = await r.text();
    const slugs = new Set<string>();
    for (const m of xml.matchAll(/<loc>https:\/\/abentfork\.com\/recipes\/([^<\/]+)<\/loc>/g)) {
      const slug = m[1];
      if (!slug || slug.startsWith('category/') || slug.startsWith('cuisine/')) continue;
      slugs.add(slug);
    }
    INDEX = [...slugs].map((slug) => ({ slug, title: titleFromSlug(slug) }));
    INDEX_AT = Date.now();
    return INDEX;
  } catch {
    return INDEX ?? [];
  }
}

const STOP = new Set(['a', 'an', 'the', 'for', 'with', 'and', 'of', 'to', 'in', 'my', 'me', 'how', 'do', 'i', 'make', 'cook', 'recipe', 'recipes', 'some', 'homemade']);

export async function searchRecipes(query: string): Promise<{ slug: string; title: string; url: string; score: number }[]> {
  const idx = await getIndex();
  const terms = query.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((t) => t.length > 2 && !STOP.has(t));
  if (!terms.length) return [];
  return idx
    .map((e) => {
      const hay = e.slug.replace(/-/g, ' ');
      let score = 0;
      for (const t of terms) if (hay.includes(t)) score += hay.split(' ').includes(t) ? 2 : 1;
      if (hay === terms.join(' ')) score += 5;
      return { ...e, url: `${BASE}/recipes/${e.slug}`, score };
    })
    .filter((e) => e.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);
}

export interface Recipe {
  name: string;
  url: string;
  description?: string;
  ingredients: string[];
  instructions: string[];
  prepTime?: string;
  cookTime?: string;
  totalTime?: string;
  recipeYield?: string;
  cuisine?: string;
  category?: string;
}

const isoDur = (d?: string): string | undefined => {
  if (!d) return undefined;
  const m = d.match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
  if (!m) return undefined;
  const h = m[1] ? `${m[1]} hr` : '';
  const min = m[2] ? `${m[2]} min` : '';
  return [h, min].filter(Boolean).join(' ') || undefined;
};

export async function getRecipe(slugOrUrl: string): Promise<Recipe | null> {
  const url = slugOrUrl.startsWith('http') ? slugOrUrl : `${BASE}/recipes/${slugOrUrl}`;
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10_000) });
    if (!r.ok) return null;
    const html = await r.text();
    for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
      let j: Record<string, unknown>;
      try { j = JSON.parse(m[1]); } catch { continue; }
      const graph = Array.isArray((j as { '@graph'?: unknown[] })['@graph']) ? (j as { '@graph': Record<string, unknown>[] })['@graph'] : [j];
      const rec = graph.find((g) => g['@type'] === 'Recipe' || (Array.isArray(g['@type']) && (g['@type'] as string[]).includes('Recipe')));
      if (!rec) continue;
      const instr = (rec.recipeInstructions as unknown[]) ?? [];
      return {
        name: String(rec.name ?? 'Recipe'),
        url,
        description: rec.description ? String(rec.description) : undefined,
        ingredients: ((rec.recipeIngredient as string[]) ?? []).map(String),
        instructions: instr
          .map((s) => (typeof s === 'string' ? s : (s as { text?: string }).text ?? ''))
          .filter(Boolean),
        prepTime: isoDur(rec.prepTime as string),
        cookTime: isoDur(rec.cookTime as string),
        totalTime: isoDur(rec.totalTime as string),
        recipeYield: rec.recipeYield ? String(Array.isArray(rec.recipeYield) ? (rec.recipeYield as string[])[0] : rec.recipeYield) : undefined,
        cuisine: rec.recipeCuisine ? String(rec.recipeCuisine) : undefined,
        category: rec.recipeCategory ? String(rec.recipeCategory) : undefined,
      };
    }
    return null;
  } catch {
    return null;
  }
}

function recipeBlock(r: Recipe): string {
  const meta = [r.category, r.cuisine, r.totalTime && `${r.totalTime} total`, r.recipeYield].filter(Boolean).join(' · ');
  return [
    `## A Bent Fork — ${r.name}`,
    meta,
    r.url,
    r.description ? `\n${r.description}` : '',
    `\n**Ingredients**`,
    ...r.ingredients.map((i) => `- ${i}`),
    `\n**Method**`,
    ...r.instructions.map((s, i) => `${i + 1}. ${s}`),
    `\nThis is Noah's own recipe. Give it to him faithfully. If he asks about a substitution, a scale-up/down, or a technique, help with that from general cooking knowledge — but don't quietly rewrite the recipe.`,
  ].filter(Boolean).join('\n');
}

/** Free-text recipe ask → a toolResult block. */
export async function runRecipe(query: string): Promise<string> {
  const hits = await searchRecipes(query);
  await audit.log('tool_call', 'calliad', null, { tool: 'recipe', q: query.slice(0, 80), hits: hits.length });

  if (!hits.length) {
    return `## A Bent Fork\nNo recipe on the site matches that. Tell Noah plainly it's not one of his, then you can still help with a general approach if he wants — flag that it's not from A Bent Fork.`;
  }
  if (hits.length === 1 || hits[0].score >= hits[1].score + 4) {
    const r = await getRecipe(hits[0].url);
    if (r) return recipeBlock(r);
  }
  return [
    `## A Bent Fork — possible matches`,
    ...hits.map((h) => `- ${h.title} — ${h.url}`),
    `\nAsk Noah which one he means (or, if one is the obvious fit, just go with it and pull the full recipe next turn).`,
  ].join('\n');
}

export const isRecipeQuery = (t: string) =>
  /\b(recipe|abentfork|a bent fork|how (do i|to) (make|cook|bake)|how'?s .{0,30} made|what can i (make|cook) with|substitut\w+ for .{0,30}\bin\b|scale (up|down) .{0,20}recipe)\b/i.test(t);
