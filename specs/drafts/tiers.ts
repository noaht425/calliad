// Calliad hub — router/tiers.ts (draft, 2026-08-30)
// Tier definitions + price table + cost computation.
// Drops into src/router/tiers.ts (or lib/router/tiers.ts) of the fork.
//
// PRICES: verified against platform.claude.com/docs/en/about-claude/pricing on
// 2026-08-30. Anthropic USD per million tokens (MTok). Sonnet 5 $2/$10 is now the
// permanent standard price (the scheduled Sep-2026 increase was cancelled).
// Re-check at build time and wire a test that fails if these drift.

export type Tier = 'T0' | 'T1' | 'T2' | 'T3';

/** What each tier is for + which model backs it. */
export const TIERS: Record<Tier, { desc: string; provider: string; model: string | null }> = {
  T0: { desc: 'rules only, no model call',              provider: 'none',      model: null },
  T1: { desc: 'cheap: classify / extract / tag / route', provider: 'gemini',    model: 'gemini-flash-lite' }, // wired in Phase 1
  T2: { desc: 'conversation, brief/nudge phrasing, judgment', provider: 'anthropic', model: 'claude-sonnet-5' },
  T3: { desc: 'hard reasoning Noah explicitly asks for', provider: 'anthropic', model: 'claude-opus-5' },
};

/** Per-MTok USD. cacheWrite5m = 1.25x input, cacheWrite1h = 2x input, cacheRead = 0.1x input. */
export interface ModelPrice {
  input: number;
  output: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
}

export const MODEL_PRICING: Record<string, ModelPrice> = {
  'claude-sonnet-5': { input: 2.0, output: 10.0, cacheWrite5m: 2.5,  cacheWrite1h: 4.0,  cacheRead: 0.2  },
  'claude-opus-5':   { input: 5.0, output: 25.0, cacheWrite5m: 6.25, cacheWrite1h: 10.0, cacheRead: 0.5  },
  'claude-haiku-4-5':{ input: 1.0, output: 5.0,  cacheWrite5m: 1.25, cacheWrite1h: 2.0,  cacheRead: 0.1  },
  // Gemini T1 — fill in once the exact model + rate is confirmed (Doug's code
  // names gemini-3.6-flash / gemini-2.5-flash-lite; both are past this draft's
  // knowledge and near-free at one-person volume).
  // 'gemini-flash-lite': { input: 0.10, output: 0.40, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0.025 },
};

/** Anthropic usage block field names (verified 2026-08-30). */
export interface AnthropicUsage {
  input_tokens: number;                 // uncached input this call
  output_tokens: number;
  cache_read_input_tokens?: number;     // billed at cacheRead
  cache_creation_input_tokens?: number; // billed at a cache-write rate (see ttl)
}

/**
 * Cost of one Anthropic call in USD. `cacheWriteTtl` picks which write rate the
 * cache_creation tokens are billed at (default '5m', matching cache_control
 * {type:'ephemeral'} with no ttl override).
 */
export function anthropicCostUsd(
  model: string,
  usage: AnthropicUsage,
  cacheWriteTtl: '5m' | '1h' = '5m',
): number {
  const p = MODEL_PRICING[model];
  if (!p) throw new Error(`tiers.ts: no price for model "${model}"`);
  const writeRate = cacheWriteTtl === '1h' ? p.cacheWrite1h : p.cacheWrite5m;
  const m = 1_000_000;
  return (
    (usage.input_tokens                     * p.input)     / m +
    ((usage.cache_read_input_tokens     ?? 0) * p.cacheRead) / m +
    ((usage.cache_creation_input_tokens ?? 0) * writeRate)  / m +
    (usage.output_tokens                    * p.output)    / m
  );
}
