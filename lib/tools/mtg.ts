import { audit } from '@/lib/hub/audit';

// Magic: the Gathering — Scryfall-backed card data + decklist analysis. The
// engine's own hand-modeled decks are separate (that's the sim wrapper). This is
// "give me a list, tell me what to change" reasoning over GROUND-TRUTH oracle
// text, so the model never has to recall what a card does.

const UA = 'Calliad/1.0 (personal assistant; contact noaht425@gmail.com)';
const SCRY = 'https://api.scryfall.com';

export interface Card {
  name: string;
  mana_cost: string;
  cmc: number;
  type_line: string;
  oracle_text: string;
  power?: string;
  toughness?: string;
  keywords: string[];
  color_identity: string[];
  legal_commander: boolean;
  edhrec_rank?: number;
  price_usd?: number;
}

function normalizeCard(c: Record<string, unknown>): Card {
  const faces = (c.card_faces as Record<string, unknown>[] | undefined) ?? [];
  const oracle =
    (c.oracle_text as string) ||
    faces.map((f) => `${f.name}: ${f.oracle_text ?? ''}`).join('\n//\n') ||
    '';
  const legal = ((c.legalities as Record<string, string>) ?? {}).commander;
  return {
    name: c.name as string,
    mana_cost: (c.mana_cost as string) || faces.map((f) => f.mana_cost).filter(Boolean).join(' // ') || '',
    cmc: (c.cmc as number) ?? 0,
    type_line: (c.type_line as string) || '',
    oracle_text: oracle,
    power: c.power as string | undefined,
    toughness: c.toughness as string | undefined,
    keywords: (c.keywords as string[]) ?? [],
    color_identity: (c.color_identity as string[]) ?? [],
    legal_commander: legal === 'legal' || legal === 'restricted',
    edhrec_rank: c.edhrec_rank as number | undefined,
    price_usd: (c.prices as Record<string, string> | undefined)?.usd ? Number((c.prices as Record<string, string>).usd) : undefined,
  };
}

/** One card by (fuzzy) name. */
export async function getCard(name: string): Promise<Card | null> {
  try {
    const r = await fetch(`${SCRY}/cards/named?fuzzy=${encodeURIComponent(name.trim())}`, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return null;
    return normalizeCard(await r.json());
  } catch {
    return null;
  }
}

/** Batch — Scryfall's /cards/collection, 75 identifiers per call. */
export async function getCards(names: string[]): Promise<{ found: Card[]; missing: string[] }> {
  const uniq = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
  const found: Card[] = [];
  const missing: string[] = [];
  for (let i = 0; i < uniq.length; i += 75) {
    const chunk = uniq.slice(i, i + 75);
    try {
      const r = await fetch(`${SCRY}/cards/collection`, {
        method: 'POST',
        headers: { 'User-Agent': UA, Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifiers: chunk.map((name) => ({ name })) }),
        signal: AbortSignal.timeout(12000),
      });
      if (!r.ok) { missing.push(...chunk); continue; }
      const j = (await r.json()) as { data?: Record<string, unknown>[]; not_found?: { name?: string }[] };
      for (const c of j.data ?? []) found.push(normalizeCard(c));
      for (const nf of j.not_found ?? []) if (nf.name) missing.push(nf.name);
    } catch {
      missing.push(...chunk);
    }
    if (i + 75 < uniq.length) await new Promise((res) => setTimeout(res, 120)); // be polite
  }
  return { found, missing };
}

// ── decklist parsing ───────────────────────────────────────────────────────
export interface DeckEntry { count: number; name: string }

const SECTION_RE = /^(deck|commander|companion|sideboard|maybeboard|lands?|creatures?|instants?|sorceries|artifacts?|enchantments?|planeswalkers?|tokens?)\b[:\s]*$/i;

/** Handles "1 Sol Ring", "1x Sol Ring", "Sol Ring", set codes, MWS/Arena/Moxfield exports. */
export function parseDecklist(text: string): { commander: string | null; entries: DeckEntry[] } {
  const entries: DeckEntry[] = [];
  let commander: string | null = null;
  let inCommander = false;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('//') || line.startsWith('#')) continue;
    if (SECTION_RE.test(line)) { inCommander = /^commander/i.test(line); continue; }
    const cm = line.match(/^(?:commander:\s*)(.+)$/i);
    if (cm) { commander = cleanName(cm[1]); continue; }

    const m = line.match(/^(?:(\d+)\s*x?\s+)?(.+?)(?:\s+\((?:[A-Za-z0-9]{2,5})\)(?:\s+[\dA-Za-z-]+)?)?(?:\s+\*[A-Z]\*)?$/);
    if (!m) continue;
    const count = m[1] ? parseInt(m[1], 10) : 1;
    const name = cleanName(m[2]);
    if (!name) continue;
    if (inCommander && !commander) { commander = name; continue; }
    entries.push({ count, name });
  }
  return { commander, entries };
}

function cleanName(s: string): string {
  return s
    .replace(/\s+/g, ' ')
    .replace(/^\d+\s*x?\s+/, '')
    .replace(/\s*\/\/.*$/, '') // DFC: front face name is enough for Scryfall
    .replace(/\s*\[[^\]]*\]$/, '') // trailing [Category] tags (Moxfield text export)
    .trim();
}

// ── deck URL → decklist text ───────────────────────────────────────────────
// Archidekt only. Moxfield put their API behind Cloudflare (403 to any client
// without an approved user-agent) — paste the list for those.
export async function fetchDeckFromUrl(url: string): Promise<string | null> {
  try {
    const arch = url.match(/archidekt\.com\/(?:api\/)?decks\/(\d+)/);
    if (arch) {
      const r = await fetch(`https://archidekt.com/api/decks/${arch[1]}/`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000) });
      if (!r.ok) return null;
      const j = (await r.json()) as { cards?: { quantity: number; card: { oracleCard: { name: string } }; categories?: string[] }[] };
      return (j.cards ?? [])
        .map((c) => `${c.categories?.includes('Commander') ? 'Commander: ' : ''}${c.quantity} ${c.card.oracleCard.name}`)
        .join('\n');
    }
  } catch { /* fall through */ }
  return null;
}

// ── role classification (heuristic, overlap allowed) ────────────────────────
function roles(c: Card): string[] {
  const t = c.oracle_text.toLowerCase();
  const type = c.type_line.toLowerCase();
  const out: string[] = [];
  if (type.includes('land')) out.push('land');
  const nonland = !type.includes('land');
  if (nonland && (/\badd \{|\badd (one|two|three|four|five|that much|x)\b|\badd .* mana/.test(t) ||
    /search your library for .*(basic land|plains|island|swamp|mountain|forest).*(battlefield|play)/.test(t))) out.push('ramp');
  if (/draw (a|one|two|three|four|x|\d+) cards?|draws? cards? equal|draw that many/.test(t)) out.push('draw');
  if (/(destroy|exile) target (creature|permanent|artifact|enchantment|planeswalker|nonland|nonbasic)/.test(t)) out.push('spot removal');
  if (/(destroy|exile) all (creatures|nonland|permanents)|(destroy|exile) each (creature|permanent)|each player sacrifices (all|.*creature)|all creatures get -\d+\/-\d+|creatures get -\d+\/-\d+ until/.test(t)) out.push('board wipe');
  if (/counter target (spell|ability|activated|triggered)/.test(t)) out.push('counterspell');
  if (nonland && /search your library for a(n)? .*card/.test(t) && !out.includes('ramp')) out.push('tutor');
  if (/return target .*(card|permanent).* from (your|a) graveyard|from your graveyard to (your hand|the battlefield)/.test(t)) out.push('recursion');
  if (/\bgain \d+ life|\bwhenever .* gain(s)? \d+ life|lifelink/.test(t)) out.push('lifegain');
  if (/create .*token/.test(t)) out.push('tokens');
  if (/\+1\/\+1 counter/.test(t)) out.push('+1/+1 counters');
  return out;
}

export interface DeckAnalysis {
  commander: Card | null;
  cards: { card: Card; count: number }[];
  missing: string[];
  totalCards: number;
  colorIdentity: string[];
  lands: number;
  avgCmcNonland: number;
  curve: Record<string, number>;
  roleCounts: Record<string, number>;
  offColorIdentity: string[]; // cards outside the commander's identity
  notCommanderLegal: string[];
  priceUsd: number | null;
}

export async function analyzeDeck(text: string): Promise<DeckAnalysis | null> {
  const { commander: cmdName, entries } = parseDecklist(text);
  if (entries.length < 10) return null;
  const names = [...entries.map((e) => e.name), ...(cmdName ? [cmdName] : [])];
  const { found, missing } = await getCards(names);
  await audit.log('tool_call', 'calliad', null, { tool: 'mtg_deck', cards: entries.length, resolved: found.length, missing: missing.length });

  const byName = new Map(found.map((c) => [c.name.toLowerCase(), c]));
  const commander = cmdName ? byName.get(cmdName.toLowerCase()) ?? (await getCard(cmdName)) : null;
  const cards = entries
    .map((e) => ({ card: byName.get(e.name.toLowerCase()), count: e.count }))
    .filter((x): x is { card: Card; count: number } => !!x.card);

  const nonland = cards.filter((x) => !x.card.type_line.toLowerCase().includes('land'));
  const lands = cards.filter((x) => x.card.type_line.toLowerCase().includes('land')).reduce((n, x) => n + x.count, 0);
  const curve: Record<string, number> = { '0-1': 0, '2': 0, '3': 0, '4': 0, '5': 0, '6': 0, '7+': 0 };
  for (const { card, count } of nonland) {
    const k = card.cmc <= 1 ? '0-1' : card.cmc >= 7 ? '7+' : String(Math.round(card.cmc));
    curve[k] = (curve[k] ?? 0) + count;
  }
  const roleCounts: Record<string, number> = {};
  for (const { card, count } of cards) for (const r of roles(card)) roleCounts[r] = (roleCounts[r] ?? 0) + count;

  const ci = commander?.color_identity ?? [...new Set(cards.flatMap((x) => x.card.color_identity))];
  const offColor = cards
    .filter((x) => x.card.color_identity.some((c) => !ci.includes(c)))
    .map((x) => x.card.name);
  const notLegal = cards.filter((x) => !x.card.legal_commander).map((x) => x.card.name);
  const prices = cards.map((x) => x.card.price_usd).filter((p): p is number => typeof p === 'number');

  return {
    commander: commander ?? null,
    cards,
    missing,
    totalCards: cards.reduce((n, x) => n + x.count, 0) + (commander ? 1 : 0),
    colorIdentity: ci,
    lands,
    avgCmcNonland: nonland.length ? nonland.reduce((s, x) => s + x.card.cmc * x.count, 0) / nonland.reduce((n, x) => n + x.count, 0) : 0,
    curve,
    roleCounts,
    offColorIdentity: offColor,
    notCommanderLegal: notLegal,
    priceUsd: prices.length ? Math.round(prices.reduce((a, b) => a + b, 0)) : null,
  };
}

// ── toolResult builders ────────────────────────────────────────────────────
export function cardBlock(cards: Card[]): string {
  const lines = ['## Card data (Scryfall — ground truth)'];
  for (const c of cards) {
    lines.push(
      `\n**${c.name}** ${c.mana_cost}  ·  ${c.type_line}${c.power ? `  ·  ${c.power}/${c.toughness}` : ''}` +
        `${c.edhrec_rank ? `  ·  EDHREC #${c.edhrec_rank}` : ''}`,
      c.oracle_text || '(no rules text)',
    );
  }
  lines.push('\nUse this text verbatim for what each card does and how they interact. Do not rely on memory.');
  return lines.join('\n');
}

const WUBRG: Record<string, string> = { W: 'white', U: 'blue', B: 'black', R: 'red', G: 'green' };

export function deckBlock(a: DeckAnalysis): string {
  const ci = a.colorIdentity;
  const idName = ci.length ? ci.map((c) => WUBRG[c] ?? c).join('/') : 'colorless';
  const forbidden = (['W', 'U', 'B', 'R', 'G'] as const).filter((c) => !ci.includes(c)).map((c) => WUBRG[c]);

  const L: string[] = ['## Deck analysis (Scryfall data)'];
  L.push(
    `**Color identity: {${ci.join('}{') || 'C'}} (${idName}).** Every card you suggest MUST be inside this identity — ` +
      `no ${forbidden.join('/') || 'off-colour'} cards, and no card whose rules text has a ${forbidden.join('/') || 'off-colour'} mana symbol. Colourless is fine.`,
  );
  if (a.commander) L.push(`**Commander:** ${a.commander.name} — ${a.commander.type_line} — ${a.commander.color_identity.join('') || 'C'}\n${a.commander.oracle_text}`);
  L.push(
    `\n**${a.totalCards} cards** · identity ${a.colorIdentity.join('') || 'C'} · ${a.lands} lands · ` +
      `avg nonland MV ${a.avgCmcNonland.toFixed(2)}${a.priceUsd ? ` · ~$${a.priceUsd}` : ''}`,
    `Curve (nonland): ${Object.entries(a.curve).map(([k, v]) => `${k}:${v}`).join('  ')}`,
    `Roles (overlap ok): ${Object.entries(a.roleCounts).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k} ${v}`).join('  ') || '—'}`,
  );
  if (a.offColorIdentity.length) L.push(`⚠️ Outside color identity: ${a.offColorIdentity.join(', ')}`);
  if (a.notCommanderLegal.length) L.push(`⚠️ Not Commander-legal: ${a.notCommanderLegal.join(', ')}`);
  if (a.missing.length) L.push(`Couldn't resolve: ${a.missing.join(', ')}`);

  L.push('\n### Full list with rules text');
  for (const { card, count } of a.cards) {
    L.push(`- ${count > 1 ? `${count}x ` : ''}**${card.name}** ${card.mana_cost} · ${card.type_line}${card.power ? ` ${card.power}/${card.toughness}` : ''} — ${card.oracle_text.replace(/\n/g, ' ') || '(vanilla)'}`);
  }
  L.push(
    '\n### Instructions',
    `Analyze as a strong Commander player would. Reason from the rules text above, not memory. Cover, as relevant: mana base and curve health, ramp/draw/interaction/wincon counts against what this deck wants to do, synergy clusters and anti-synergies, combo lines and their redundancy/fragility, clearly weak inclusions and what to cut, and 3–6 concrete adds with why. Every card you name as an add MUST be legal in this deck's colour identity ({${ci.join('}{') || 'C'}}) — double-check each one; a card with an off-colour identity is a hard error, not a suggestion. If Noah asked a specific question, lead with that. Be direct about tradeoffs; no hedging filler.`,
  );
  return L.join('\n');
}

// ── intent detection ───────────────────────────────────────────────────────
export const looksLikeDecklist = (t: string) => {
  const lines = t.split(/\r?\n/).filter((l) => /^\s*\d+\s*x?\s+[A-Z]/.test(l) || /^\s*[A-Z][a-z].{2,}$/.test(l.trim()));
  return lines.length >= 15;
};
export const isDeckHelp = (t: string) =>
  /\b(my (deck|list|build)|this (deck|list|decklist)|analy[sz]e .*(deck|list)|what should i (cut|add|swap)|help me (build|tune|improve|cut)|rate my deck|deck ?doctor|is this deck)\b/i.test(t);
const CARD_Q_MECHANICS =
  /\b(what does .{2,60} do\b|how does .{2,60} (work|interact)|oracle text|rules text (for|of)|does .{2,50} (trigger|work with|combo with)|interaction between|combo with)\b/i;
const CARD_Q_OPINION =
  /\b(what do (you|we|u) think (of|about)|thoughts on|how (good|playable) is|is .{2,50} (good|worth|playable|any good))\b.{0,70}\b(card|creature|planeswalker|artifact|enchantment|spell|deck|commander|cube|format|edh)\b|\b(what do (you|we) think of|thoughts on) the (new|upcoming|latest|just[- ]?spoiled) .{2,50}/i;

export const isCardQuestion = (t: string) => CARD_Q_MECHANICS.test(t) || CARD_Q_OPINION.test(t);

/** Card names from a question — quoted first, else Capitalized runs (comma/"and" separated). */
export function extractCardNames(t: string): string[] {
  const quoted = [...t.matchAll(/["“”']([^"“”']{2,60})["“”']/g)].map((m) => m[1].trim());
  if (quoted.length) return quoted.slice(0, 6);
  const runs = [...t.matchAll(/\b([A-Z][a-z’']+(?:[ -](?:of|the|to|and|a|an|[A-Z][a-z’']+)){0,4})\b/g)]
    .map((m) => m[1].trim())
    .filter((s) => s.split(/\s+/).length >= 2 || s.length >= 5)
    .filter((s) => !/^(What|How|Does|Do|The|This|That|When|Where|Why|Is|Are|Can|Could|Would|I|My)$/.test(s));
  return [...new Set(runs)].slice(0, 6);
}
