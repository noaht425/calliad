// Tier definitions + price table + cost computation.
//
// PRICES: verified against platform.claude.com/docs/en/about-claude/pricing on
// 2026-08-30 (USD per million tokens). Sonnet 5 $2/$10 is the permanent standard
// price. Cache multipliers: 5m write 1.25x, 1h write 2x, cache read 0.1x of base
// input. Re-verify on any dependency bump.

export type Tier = 'T0' | 'T1' | 'T2' | 'T3';

export const TIERS: Record<Tier, { desc: string; provider: string; model: string | null }> = {
  T0: { desc: 'rules only, no model call', provider: 'none', model: null },
  T1: { desc: 'cheap: classify / extract / tag / route', provider: 'gemini', model: 'gemini-flash-lite' }, // wired in Phase 1
  T2: { desc: 'conversation, brief/nudge phrasing, judgment', provider: 'anthropic', model: 'claude-sonnet-5' },
  T3: { desc: 'hard reasoning Noah explicitly asks for', provider: 'anthropic', model: 'claude-opus-5' },
};

export interface ModelPrice {
  input: number;
  output: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
}

export const MODEL_PRICING: Record<string, ModelPrice> = {
  'claude-sonnet-5':  { input: 2.0, output: 10.0, cacheWrite5m: 2.5,  cacheWrite1h: 4.0,  cacheRead: 0.2 },
  'claude-opus-5':    { input: 5.0, output: 25.0, cacheWrite5m: 6.25, cacheWrite1h: 10.0, cacheRead: 0.5 },
  'claude-haiku-4-5': { input: 1.0, output: 5.0,  cacheWrite5m: 1.25, cacheWrite1h: 2.0,  cacheRead: 0.1 },
  // T1 Gemini rate — fill once the exact model is confirmed (Phase 1). Near-free
  // at one-person volume; cost accounting for it is Phase 1.
};

export interface UsageLike {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  server_tool_use?: { web_search_requests?: number | null } | null;
}

const WEB_SEARCH_USD = 0.01; // Anthropic bills $10 / 1000 web searches

/** Cost of one Anthropic call in USD. */
export function anthropicCostUsd(
  model: string,
  usage: UsageLike,
  cacheWriteTtl: '5m' | '1h' = '5m',
): number {
  const p = MODEL_PRICING[model];
  if (!p) {
    console.warn(`tiers: no price for model "${model}" — cost recorded as 0`);
    return 0;
  }
  const writeRate = cacheWriteTtl === '1h' ? p.cacheWrite1h : p.cacheWrite5m;
  const m = 1_000_000;
  return (
    (usage.input_tokens * p.input) / m +
    ((usage.cache_read_input_tokens ?? 0) * p.cacheRead) / m +
    ((usage.cache_creation_input_tokens ?? 0) * writeRate) / m +
    (usage.output_tokens * p.output) / m +
    (usage.server_tool_use?.web_search_requests ?? 0) * WEB_SEARCH_USD
  );
}
