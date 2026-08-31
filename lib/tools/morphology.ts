import { audit } from '@/lib/hub/audit';

// Latin/Greek morphology, tool-backed via the Perseids Morpheus service
// (services.perseids.org — no key). Models make paradigm errors; this pins the
// lemma + grammatical analysis. Free-text queries → an analysis block the brain
// treats as ground truth.

type Lang = 'lat' | 'grc';

interface Analysis {
  lemma: string;
  pos: string;
  features: string[]; // e.g. ["accusative", "singular", "masculine", "3rd decl"]
}

const GREEK_RE = /[Ͱ-Ͽἀ-῿]/;
const LATINISH_RE = /^[a-zāēīōūȳăĕĭŏŭͰ-Ͽἀ-῿-]+$/i;
const STOP = new Set([
  'conjugate', 'conjugation', 'decline', 'declension', 'parse', 'parsing', 'analyze', 'analyse',
  'the', 'a', 'an', 'of', 'in', 'is', 'this', 'that', 'form', 'word', 'verb', 'noun', 'adjective',
  'latin', 'greek', 'please', 'give', 'me', 'what', 'case', 'tense', 'mood', 'person', 'number',
  'gender', 'principal', 'parts', 'present', 'perfect', 'future', 'imperfect', 'for', 'to', 'and',
  'synopsis', 'synopsize', 'full', 'table', 'paradigm', 'its', 'my',
]);

function pickWord(query: string): string | null {
  const toks = query.replace(/[.,;:!?"'()]/g, ' ').split(/\s+/).filter(Boolean);
  const cands = toks.filter((t) => LATINISH_RE.test(t) && !STOP.has(t.toLowerCase()));
  if (!cands.length) return null;
  // prefer a Greek token, else the longest remaining
  return cands.find((t) => GREEK_RE.test(t)) ?? cands.sort((a, b) => b.length - a.length)[0];
}

function val(x: unknown): string | undefined {
  if (typeof x === 'string') return x;
  if (x && typeof x === 'object' && '$' in (x as Record<string, unknown>)) return String((x as Record<string, unknown>).$);
  return undefined;
}

function toArray<T>(x: T | T[] | undefined): T[] {
  return x == null ? [] : Array.isArray(x) ? x : [x];
}

/**
 * Morpheus chokes on Latin vowel-length marks: `ferō` comes back with no `Body`,
 * `amō` comes back empty, while `fero`/`amo` parse fine. Strip macrons/breves
 * (and any stray combining accent) for Latin. Greek keeps its diacritics —
 * Morpheus-grc needs the breathings and accents.
 */
function normalizeForEngine(word: string, lang: Lang): string {
  if (lang === 'grc') return word;
  return word.normalize('NFD').replace(/[\u0300-\u036f]/g, '').normalize('NFC');
}

export async function analyzeForm(word: string, lang: Lang): Promise<Analysis[]> {
  const engine = lang === 'grc' ? 'morpheusgrc' : 'morpheuslat';
  const q = normalizeForEngine(word, lang);
  const url = `https://services.perseids.org/bsp/morphologyservice/analysis/word?lang=${lang}&engine=${engine}&word=${encodeURIComponent(q)}`;
  const r = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw new Error(`perseids ${r.status}`);
  const j = (await r.json()) as Record<string, unknown>;

  // RDF.Annotation.Body → .rest.entry. Body is a single object for one analysis
  // but an ARRAY when the form is ambiguous (e.g. `fero` → 2), and entry itself
  // may be one or many. Flatten both levels.
  const ann = ((j.RDF as Record<string, unknown>)?.Annotation ?? {}) as Record<string, unknown>;
  const bodies = toArray(ann.Body as Record<string, unknown> | Record<string, unknown>[] | undefined);
  const entries = bodies.flatMap((b) =>
    toArray(((b?.rest as Record<string, unknown>)?.entry) as Record<string, unknown> | Record<string, unknown>[] | undefined),
  );

  const out: Analysis[] = [];
  for (const e of entries) {
    const dict = (e.dict ?? {}) as Record<string, unknown>;
    const infls = toArray((e.infl as unknown) as Record<string, unknown> | Record<string, unknown>[]);
    for (const infl of infls.length ? infls : [{}]) {
      const feats: string[] = [];
      for (const k of ['case', 'num', 'gend', 'tense', 'mood', 'voice', 'pers', 'comp']) {
        const v = val((infl as Record<string, unknown>)[k]) ?? val(dict[k]);
        if (v) feats.push(v);
      }
      const declConj = val(dict.decl) ?? val(dict.conj);
      if (declConj) feats.push(lang === 'grc' ? declConj : `${declConj}${val(dict.decl) ? ' decl' : ' conj'}`);
      out.push({
        // Morpheus appends a homograph index to Latin lemmas (sum1, edo1) — drop it.
        lemma: (val(dict.hdwd) ?? word).replace(/(?<=\p{L})\d+$/u, ''),
        pos: val(dict.pofs) ?? '?',
        features: feats,
      });
    }
  }
  // dedupe
  const seen = new Set<string>();
  return out.filter((a) => {
    const k = `${a.lemma}|${a.pos}|${a.features.join(',')}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Free-text query → a ground-truth analysis block for the brain, or null if no word found. */
export async function runMorphology(query: string): Promise<string | undefined> {
  const word = pickWord(query);
  if (!word) return undefined;
  const lang: Lang = GREEK_RE.test(word) || /\bgreek\b/i.test(query) ? 'grc' : 'lat';

  try {
    const analyses = await analyzeForm(word, lang);
    await audit.log('tool_call', 'calliad', null, { tool: 'morphology', word, lang, hits: analyses.length });
    if (!analyses.length) {
      return `## Morphology tool (Perseids/Morpheus)\nNo analysis found for "${word}" (${lang === 'grc' ? 'Greek' : 'Latin'}). Treat any paradigm you give as unverified.`;
    }
    const lines = analyses.map(
      (a) => `- lemma **${a.lemma}** (${a.pos})${a.features.length ? ` — ${a.features.join(', ')}` : ''}`,
    );
    return `## Morphology tool (Perseids/Morpheus) — GROUND TRUTH for "${word}"\n${lines.join('\n')}\n\nUse this lemma and analysis as authoritative. If Noah asked for a full paradigm, build it from this verified lemma/class — do not change the headword.`;
  } catch (err) {
    await audit.log('error', 'system', null, { where: 'runMorphology', word, message: String(err) });
    return `## Morphology tool\nLookup for "${word}" failed (${String(err)}). Give your best answer but flag it as unverified.`;
  }
}
