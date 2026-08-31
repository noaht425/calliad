import { audit } from '@/lib/hub/audit';
import type { DeckAnalysis } from '@/lib/tools/mtg';

// EDHREC — what decks for a given commander actually run. Data-backs the
// deck-analysis "what should I add" instead of leaning on model recall.
// Unofficial JSON endpoint (json.edhrec.com), no key.

const UA = 'Calliad/1.0 (personal assistant)';

export interface Rec {
  name: string;
  numDecks: number;
  pct: number; // share of this commander's decks running it
  synergy: number; // EDHREC synergy score (high = disproportionately paired)
  category: string;
}

export interface CommanderRecs {
  commander: string;
  potentialDecks: number;
  recs: Rec[]; // deduped, all lists merged
}

export function commanderSlug(name: string): string {
  return name
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’.,]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const norm = (s: string) => s.toLowerCase().replace(/['’]/g, "'").replace(/\s+/g, ' ').trim();

export async function getCommanderRecs(name: string): Promise<CommanderRecs | null> {
  const slug = commanderSlug(name);
  try {
    const r = await fetch(`https://json.edhrec.com/pages/commanders/${slug}.json`, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) return null;
    const j = (await r.json()) as {
      container?: { json_dict?: { cardlists?: { header?: string; tag?: string; cardviews?: Record<string, unknown>[] }[] } };
    };
    const lists = j.container?.json_dict?.cardlists ?? [];
    if (!lists.length) return null;

    const byName = new Map<string, Rec>();
    let potentialDecks = 0;
    for (const list of lists) {
      const cat = list.header ?? list.tag ?? '';
      for (const cv of list.cardviews ?? []) {
        const cname = (cv.name as string) ?? '';
        if (!cname) continue;
        const numDecks = (cv.num_decks as number) ?? 0;
        const potential = (cv.potential_decks as number) ?? 0;
        if (potential > potentialDecks) potentialDecks = potential;
        const rec: Rec = {
          name: cname,
          numDecks,
          pct: potential ? numDecks / potential : 0,
          synergy: (cv.synergy as number) ?? 0,
          category: cat,
        };
        const key = norm(cname);
        const prev = byName.get(key);
        // keep the entry with the most decks (most informative); prefer a synergy/top list for category
        if (!prev || rec.numDecks > prev.numDecks) byName.set(key, rec);
      }
    }
    await audit.log('tool_call', 'calliad', null, { tool: 'edhrec', commander: name, recs: byName.size });
    return { commander: name, potentialDecks, recs: [...byName.values()] };
  } catch (e) {
    await audit.log('error', 'system', null, { where: 'getCommanderRecs', commander: name, message: String(e) });
    return null;
  }
}

/** What EDHREC's recommendations for this commander are NOT already in the deck. */
export function recDiff(analysis: DeckAnalysis, recs: CommanderRecs) {
  const have = new Set(analysis.cards.map((c) => norm(c.card.name)));
  if (analysis.commander) have.add(norm(analysis.commander.name));
  const missing = recs.recs.filter((r) => !have.has(norm(r.name)));

  const staples = [...missing]
    .filter((r) => r.pct >= 0.35)
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 15);
  const synergy = [...missing]
    .filter((r) => r.synergy >= 0.25 && r.pct >= 0.08)
    .sort((a, b) => b.synergy - a.synergy)
    .slice(0, 15);

  // Nonland cards in the list that EDHREC doesn't surface among this commander's
  // cards (absent, or <6%). Weak signal — could be off-theme, or just a universal
  // staple / personal tech past EDHREC's cutoff. The model sorts that out.
  const recByName = new Map(recs.recs.map((r) => [norm(r.name), r]));
  const offbeat = analysis.cards
    .filter((c) => !/\bland\b/i.test(c.card.type_line))
    .filter((c) => {
      const r = recByName.get(norm(c.card.name));
      return !r || r.pct < 0.06;
    })
    .slice(0, 18)
    .map((c) => c.card.name);

  return { staples, synergy, offbeat };
}

export function recBlock(recs: CommanderRecs, diff?: ReturnType<typeof recDiff>): string {
  const L = [`## EDHREC — ${recs.commander} (${recs.potentialDecks.toLocaleString()} decks tracked)`];
  const line = (r: Rec) => `- ${r.name} — ${Math.round(r.pct * 100)}% of decks${r.synergy >= 0.2 ? `, synergy ${r.synergy.toFixed(2)}` : ''}`;

  if (diff) {
    if (diff.staples.length) {
      L.push('', '**Staples you\'re not running:**');
      diff.staples.forEach((r) => L.push(line(r)));
    }
    if (diff.synergy.length) {
      L.push('', '**Highest-synergy cards for this commander you\'re missing:**');
      diff.synergy.forEach((r) => L.push(line(r)));
    }
    if (diff.offbeat.length) {
      L.push('', `**Not among EDHREC's cards for this commander** (could be off-theme, or just universal staples / your own tech): ${diff.offbeat.join(', ')}`);
    }
    L.push(
      '',
      'Weigh these against what the deck is actually trying to do — a high inclusion % is popularity, not a mandate, and Noah\'s pod / budget / gameplan can justify ignoring any of them. High synergy is the stronger signal for commander-specific adds.',
    );
  } else {
    const BASIC = /^(plains|island|swamp|mountain|forest|wastes)$/i;
    const pool = recs.recs.filter((r) => !BASIC.test(r.name));
    const top = [...pool].sort((a, b) => b.pct - a.pct).slice(0, 12);
    const syn = [...pool].sort((a, b) => b.synergy - a.synergy).slice(0, 12);
    L.push('', '**Most-run cards:**');
    top.forEach((r) => L.push(line(r)));
    L.push('', '**Highest synergy:**');
    syn.forEach((r) => L.push(line(r)));
  }
  return L.join('\n');
}

export const isEdhrecQuery = (t: string) =>
  /\b(edhrec|what (am i|are we) missing (for|from)|what (do|does) (most|other) .{0,30}(decks?|people) run|what should (a|my) .{0,30}deck run|staples? for)\b/i.test(t);
