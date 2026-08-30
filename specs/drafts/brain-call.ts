// Calliad hub — brain/call.ts (draft skeleton, 2026-08-30)
// The reasoning call: spend-cap pre-check → assemble → stream Claude → capture
// usage + cost → record → return. Design: specs/hub-skeleton.md §6.
//
// TODO on drop-in:
//   - import the real Supabase admin client + audit/config helpers from the fork
//   - confirm streaming API shape (.messages.stream / .finalMessage) against the
//     installed @anthropic-ai/sdk version
//   - Phase 1: add T1 (Gemini) path for the downgrade branch

import Anthropic from '@anthropic-ai/sdk';
import { TIERS, MODEL_PRICING, anthropicCostUsd, type Tier } from '../router/tiers';
import { assemble, type TurnState } from './prompt';

const anthropic = new Anthropic(); // reads ANTHROPIC_API_KEY

// ── stand-ins for fork wiring ───────────────────────────────────────────────
declare const config: {
  get(key: string): Promise<string>;
  set(key: string, value: string): Promise<void>;
};
declare const audit: {
  log(kind: string, actor: string, ref: string | null, payload: unknown): Promise<void>;
  modelCall(row: Record<string, unknown>): Promise<void>; // writes model_calls
};

export interface BrainRequest {
  purpose: 'chat' | 'brief' | 'extract' | 'route';
  tier: Tier;
  proactive: boolean;             // proactive turns DEFER at the cap; direct messages DOWNGRADE
  conversationId: string | null;
  userText: string;
  state: TurnState;
  maxTokens?: number;
}

export interface BrainResult {
  stream: AsyncIterable<string>;  // text deltas for the SSE surface
  done: Promise<{ text: string; costUsd: number; capped: boolean }>;
}

const FALLBACK = "Something broke on my end — try that again in a minute.";

export async function call(req: BrainRequest): Promise<BrainResult> {
  // 1. Spend-cap pre-check ---------------------------------------------------
  await rollMonthIfNeeded();
  const cap = parseFloat(await config.get('spend_cap_usd_month'));
  const mtd = parseFloat(await config.get('spend_month_to_date_usd'));
  let tier = req.tier;
  let capNote = false;

  if (mtd >= cap) {
    if (req.proactive) {
      await audit.log('spend_cap', 'system', req.conversationId,
        { action: 'defer', month_to_date: mtd, cap, purpose: req.purpose });
      return deferred(); // proactive: don't call at all; a note is queued for the next brief
    }
    // direct message: downgrade to T1 (Phase 1) or, until that exists, proceed on
    // the cheapest Anthropic model and have the reply mention the cap.
    tier = 'T1';
    capNote = true;
    await audit.log('spend_cap', 'system', req.conversationId,
      { action: 'downgrade', month_to_date: mtd, cap, purpose: req.purpose });
  }

  const model = TIERS[tier].model ?? 'claude-haiku-4-5'; // T1 stopgap until Gemini is wired
  if (!MODEL_PRICING[model]) {
    // T1 Gemini path not built yet — fall back to Haiku so Phase 0 still runs.
  }

  // 2. Assemble -----------------------------------------------------------------
  const { system, messages } = assemble(
    capNote ? `${req.userText}\n\n[system: monthly spend cap reached — keep this brief]` : req.userText,
    req.state,
  );

  // 3–6. Stream, capture usage, record ---------------------------------------
  const t0 = Date.now();
  let full = '';
  let usage: Anthropic.Usage | undefined;

  async function* run(): AsyncGenerator<string> {
    for (let attempt = 0; attempt <= 2; attempt++) {
      try {
        const s = anthropic.messages.stream({
          model,
          max_tokens: req.maxTokens ?? 1024,
          system,
          messages,
          // persona chat: adaptive thinking on Sonnet 5, low effort keeps it fast/cheap.
          // Tune per the routing policy; raise effort for T3.
          output_config: { effort: tier === 'T3' ? 'high' : 'low' },
        });
        for await (const ev of s) {
          if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') {
            full += ev.delta.text;
            yield ev.delta.text;
          }
        }
        usage = (await s.finalMessage()).usage;
        return;
      } catch (err) {
        if (attempt === 2) {
          await audit.log('error', 'system', req.conversationId,
            { where: 'brain.call', message: String(err) });
          full = FALLBACK;
          yield FALLBACK;
          return;
        }
        await sleep(500 * 2 ** attempt);
      }
    }
  }

  const iterator = run();

  const done = (async () => {
    // drain happens in the caller as it forwards to SSE; when the caller is done
    // it awaits this. usage/full are populated by then.
    const latency = Date.now() - t0;
    let costUsd = 0;
    if (usage) {
      costUsd = anthropicCostUsd(model, {
        input_tokens: usage.input_tokens,
        output_tokens: usage.output_tokens,
        cache_read_input_tokens: usage.cache_read_input_tokens ?? 0,
        cache_creation_input_tokens: usage.cache_creation_input_tokens ?? 0,
      });
      await audit.modelCall({
        ts: new Date().toISOString(),
        conversation_id: req.conversationId,
        purpose: req.purpose,
        tier,
        model,
        input_tokens: usage.input_tokens,
        cached_read_tokens: usage.cache_read_input_tokens ?? 0,
        cache_write_tokens: usage.cache_creation_input_tokens ?? 0,
        output_tokens: usage.output_tokens,
        cost_usd: costUsd,
        latency_ms: latency,
      });
      await audit.log('model_call', 'calliad', req.conversationId,
        { model, tier, purpose: req.purpose, usage, cost_usd: costUsd, latency_ms: latency });
      await config.set('spend_month_to_date_usd', String(mtd + costUsd));
    }
    return { text: full, costUsd, capped: capNote };
  })();

  return { stream: iterator, done };
}

// ── helpers ────────────────────────────────────────────────────────────────
async function rollMonthIfNeeded() {
  const stored = await config.get('spend_month');
  const current = new Date().toISOString().slice(0, 7); // YYYY-MM
  if (stored !== current) {
    await config.set('spend_month', current);
    await config.set('spend_month_to_date_usd', '0');
  }
}

function deferred(): BrainResult {
  async function* none() { /* nothing */ }
  return { stream: none(), done: Promise.resolve({ text: '', costUsd: 0, capped: true }) };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
