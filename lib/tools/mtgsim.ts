import { audit } from '@/lib/hub/audit';

// Adapter for the standalone EDH sim service (server.py behind MTG_SIM_URL).
// Contract drift lives here — /transcript, /simulate + /jobs/{id}.

const BASE = (process.env.MTG_SIM_URL ?? '').replace(/\/$/, '');
const TOKEN = process.env.MTG_SIM_TOKEN ?? '';

export const simAvailable = () => Boolean(BASE && TOKEN);

// The engine's 7 hand-modelled decks. Not arbitrary decklists — that's the
// Scryfall path (lib/tools/mtg.ts).
export const SIM_DECKS = ['archelos', 'lightpaws', 'lathril', 'rocco', 'persephone', 'ares', 'hamza'] as const;
const DEFAULT_POD = ['rocco', 'hamza', 'persephone', 'ares'];

const H = () => ({ Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' });

/** Pull deck ids + an optional trial count out of a free-text ask. */
export function parseSimRequest(text: string): { decks: string[]; games: number } {
  const t = text.toLowerCase();
  let decks: string[] = SIM_DECKS.filter((d) => new RegExp(`\\b${d}\\b`).test(t));
  if (decks.length < 2 && /\b(the|my|our|real) pod\b/.test(t)) decks = [...DEFAULT_POD];
  if (decks.length < 2) decks = [...DEFAULT_POD]; // "run the sim" with nothing specific
  decks = [...new Set(decks)].slice(0, 4);

  const n = t.match(/\b(\d[\d,]{1,5})\s*(?:games|trials|times|runs|iterations|sims?)\b/) ??
    t.match(/\b(?:run|simulate|sim)\b[^.]*?\b(\d{2,5})\b/);
  let games = n ? parseInt(n[1].replace(/,/g, ''), 10) : 500;
  games = Math.max(100, Math.min(1500, games)); // sync-path budget
  return { decks, games };
}

export async function runTranscript(decks: string[], seed = 1): Promise<string> {
  if (!simAvailable()) return '## Sim\nNot configured (MTG_SIM_URL / MTG_SIM_TOKEN unset).';
  try {
    const r = await fetch(`${BASE}/transcript`, {
      method: 'POST', headers: H(), body: JSON.stringify({ decks, seed }), signal: AbortSignal.timeout(30_000),
    });
    if (!r.ok) return `## Sim\nTranscript request failed (${r.status}).`;
    const j = (await r.json()) as { winner: { name: string } | null; win_reason: string | null; turn: number; log: string[] };
    await audit.log('tool_call', 'calliad', null, { tool: 'mtg_sim_transcript', decks, seed });
    const tail = j.log.slice(-60).join('\n');
    return [
      `## Sim — one game (${decks.join(' vs ')}, seed ${seed})`,
      `Winner: ${j.winner?.name ?? 'DRAW'} on turn ${j.turn}${j.win_reason ? ` — ${j.win_reason}` : ''}`,
      '',
      'Last 60 log lines:',
      '```',
      tail,
      '```',
      '\nNarrate the arc of this game for Noah — what each deck did, the turning point, why it ended how it did.',
    ].join('\n');
  } catch (e) {
    return `## Sim\nTranscript errored — ${String(e)}.`;
  }
}

export async function runSimulation(decks: string[], games: number): Promise<string> {
  if (!simAvailable()) return '## Sim\nNot configured (MTG_SIM_URL / MTG_SIM_TOKEN unset).';
  const started = Date.now();
  try {
    const kick = await fetch(`${BASE}/simulate`, {
      method: 'POST', headers: H(), body: JSON.stringify({ decks, games }), signal: AbortSignal.timeout(15_000),
    });
    if (!kick.ok) {
      const b = await kick.text().catch(() => '');
      return `## Sim\nCouldn't start the run (${kick.status})${b ? ` — ${b.slice(0, 160)}` : ''}.`;
    }
    const { job_id } = (await kick.json()) as { job_id: string };

    // poll until done or ~50s (a 1500-game run is ~40s on 2 shared CPUs)
    let result: SimResult | null = null;
    let lastProgress = '';
    while (Date.now() - started < 52_000) {
      await new Promise((res) => setTimeout(res, 3000));
      const p = await fetch(`${BASE}/jobs/${job_id}`, { headers: H(), signal: AbortSignal.timeout(10_000) });
      if (!p.ok) break;
      const j = (await p.json()) as { status: string; progress?: { done: number; total: number }; result?: SimResult; error?: string };
      if (j.progress) lastProgress = `${j.progress.done}/${j.progress.total}`;
      if (j.status === 'done' && j.result) { result = j.result; break; }
      if (j.status === 'error') return `## Sim\nThe run failed: ${j.error}`;
    }
    await audit.log('tool_call', 'calliad', null, { tool: 'mtg_sim', decks, games, done: !!result });

    if (!result) {
      return `## Sim\nStarted a ${games}-game run of ${decks.join(', ')} (progress ${lastProgress}); it's still going. Tell Noah it's running and he can ask again in a moment for the numbers.`;
    }
    return formatSim(result);
  } catch (e) {
    return `## Sim\nRun errored — ${String(e)}.`;
  }
}

interface SimResult {
  decks: string[];
  games: number;
  elapsed_s: number;
  win_rates: Record<string, { wins: number; pct: number }>;
  draws: number;
  win_reasons: { reason: string; count: number; pct: number }[];
  avg_win_turn: number | null;
  crashes: { count: number; samples: { seed: number; error: string }[] };
}

function formatSim(r: SimResult): string {
  const L = [`## Sim — ${r.games} games, ${r.decks.join(' / ')} (${r.elapsed_s}s)`];
  L.push('', 'Win rate:');
  for (const [deck, { wins, pct }] of Object.entries(r.win_rates)) L.push(`- ${deck}: ${pct}% (${wins})`);
  if (r.draws) L.push(`- draws: ${r.draws}`);
  L.push('', 'How games ended:');
  for (const { reason, pct } of r.win_reasons) L.push(`- ${reason} — ${pct}%`);
  if (r.avg_win_turn) L.push('', `Avg turn a game ended: ${r.avg_win_turn}`);
  if (r.crashes.count) L.push('', `⚠️ ${r.crashes.count} games crashed (engine bug): ${r.crashes.samples.map((s) => s.error).slice(0, 3).join('; ')}`);
  L.push(
    '',
    '### Instructions',
    "Give Noah the standings plainly, then explain WHY — tie the win-reason breakdown to what each deck is actually doing (combos, wincons, speed). If a deck is far ahead or behind, say what's driving it and whether it's the decklist or an engine artefact. Note any crashes as a bug to look at, not a result.",
  );
  return L.join('\n');
}

// intent
export const isSimRequest = (t: string) =>
  /\b(sim(ulate)?|run)\b[^.?]*\b(rocco|hamza|persephone|ares|archelos|lightpaws|lathril|the pod|my pod)\b/i.test(t) ||
  /\b(who (would )?wins?|win ?rates?|matchup|head to head|goldfish)\b[^.?]*\b(rocco|hamza|persephone|ares|archelos|lightpaws|lathril|pod)\b/i.test(t);
export const isTranscriptRequest = (t: string) =>
  /\b(show me|walk me through|play out|transcript of|one game of|sample game)\b/i.test(t) &&
  /\b(rocco|hamza|persephone|ares|archelos|lightpaws|lathril|pod)\b/i.test(t);
