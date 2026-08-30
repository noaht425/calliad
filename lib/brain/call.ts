// The reasoning call: spend-cap pre-check → assemble → stream Claude → capture
// usage + cost → record. Design: specs/hub-skeleton.md §6.

import Anthropic from '@anthropic-ai/sdk';
import { config } from '@/lib/hub/config';
import { audit } from '@/lib/hub/audit';
import { TIERS, MODEL_PRICING, anthropicCostUsd, type Tier } from '@/lib/router/tiers';
import { assemble, type TurnState } from './prompt';

const anthropic = new Anthropic(); // reads ANTHROPIC_API_KEY

export interface BrainRequest {
  purpose: 'chat' | 'brief' | 'extract' | 'route';
  tier: Tier;
  proactive: boolean; // proactive turns DEFER at the cap; direct messages DOWNGRADE
  conversationId: string | null;
  userText: string;
  state: TurnState;
  maxTokens?: number;
}

export interface BrainMeta {
  model: string;
  tier: Tier;
  costUsd: number;
  capped: boolean;   // reply should acknowledge the spend cap
  deferred: boolean; // proactive turn skipped entirely (no stream)
  text: string;      // full accumulated reply
}

export interface BrainStream {
  meta: BrainMeta;
  stream: AsyncGenerator<string>;
}

const FALLBACK = 'Something broke on my end — try that again in a minute.';
const EFFORT: Record<Tier, 'low' | 'high'> = { T0: 'low', T1: 'low', T2: 'low', T3: 'high' };

export async function call(req: BrainRequest): Promise<BrainStream> {
  await rollMonthIfNeeded();
  const cap = parseFloat(await config.get('spend_cap_usd_month'));
  const mtd = parseFloat(await config.get('spend_month_to_date_usd'));

  let tier = req.tier;
  let capped = false;

  if (mtd >= cap) {
    if (req.proactive) {
      await audit.log('spend_cap', 'system', req.conversationId, {
        action: 'defer', month_to_date: mtd, cap, purpose: req.purpose,
      });
      const meta: BrainMeta = { model: '', tier, costUsd: 0, capped: true, deferred: true, text: '' };
      return { meta, stream: (async function* () {})() };
    }
    tier = 'T1';
    capped = true;
    await audit.log('spend_cap', 'system', req.conversationId, {
      action: 'downgrade', month_to_date: mtd, cap, purpose: req.purpose,
    });
  }

  // T1 (Gemini) isn't wired until Phase 1 — fall back to the cheapest Anthropic model.
  const model =
    MODEL_PRICING[TIERS[tier].model ?? ''] ? TIERS[tier].model! : 'claude-haiku-4-5';

  const { system, messages } = assemble(
    capped ? `${req.userText}\n\n[system note: monthly spend cap reached — keep this reply brief]` : req.userText,
    req.state,
  );

  const meta: BrainMeta = { model, tier, costUsd: 0, capped, deferred: false, text: '' };
  const startedAt = Date.now();

  async function* gen(): AsyncGenerator<string> {
    let usage: Anthropic.Messages.Usage | undefined;
    try {
      for (let attempt = 0; ; attempt++) {
        try {
          const s = anthropic.messages.stream({
            model,
            max_tokens: req.maxTokens ?? 1024,
            system,
            messages,
            output_config: { effort: EFFORT[tier] },
          });
          for await (const ev of s) {
            if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') {
              meta.text += ev.delta.text;
              yield ev.delta.text;
            }
          }
          usage = (await s.finalMessage()).usage;
          break;
        } catch (err) {
          if (attempt >= 2) {
            await audit.log('error', 'system', req.conversationId, {
              where: 'brain.call', message: String(err),
            });
            if (!meta.text) { meta.text = FALLBACK; yield FALLBACK; }
            return;
          }
          await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
        }
      }
    } finally {
      if (usage) {
        meta.costUsd = anthropicCostUsd(model, usage);
        const latency = Date.now() - startedAt;
        await audit.modelCall({
          conversation_id: req.conversationId,
          purpose: req.purpose,
          tier,
          model,
          input_tokens: usage.input_tokens,
          cached_read_tokens: usage.cache_read_input_tokens ?? 0,
          cache_write_tokens: usage.cache_creation_input_tokens ?? 0,
          output_tokens: usage.output_tokens,
          cost_usd: meta.costUsd,
          latency_ms: latency,
        });
        await audit.log('model_call', 'calliad', req.conversationId, {
          model, tier, purpose: req.purpose,
          usage: {
            input_tokens: usage.input_tokens,
            output_tokens: usage.output_tokens,
            cache_read_input_tokens: usage.cache_read_input_tokens ?? 0,
            cache_creation_input_tokens: usage.cache_creation_input_tokens ?? 0,
          },
          cost_usd: meta.costUsd,
          latency_ms: latency,
        });
        await config.set('spend_month_to_date_usd', String(mtd + meta.costUsd));
      }
    }
  }

  return { meta, stream: gen() };
}

async function rollMonthIfNeeded(): Promise<void> {
  const stored = await config.get('spend_month');
  const current = new Date().toISOString().slice(0, 7);
  if (stored !== current) {
    await config.set('spend_month', current);
    await config.set('spend_month_to_date_usd', '0');
  }
}
