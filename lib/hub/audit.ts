import { adminClient } from '@/lib/supabase.server';

/**
 * Append-only audit trail. `audit_log` gets one row per meaningful step;
 * `model_calls` is the denormalized cost ledger. Neither is ever updated or
 * deleted. See supabase/migrations/0001_init.sql §4.
 */

export type AuditKind =
  | 'inbound_message' | 'trigger_fired' | 'route_decision' | 'model_call'
  | 'tool_call' | 'action_proposed' | 'action_decided' | 'action_executed'
  | 'outbound_message' | 'spend_cap' | 'killswitch' | 'error';

export type Actor = 'noah' | 'calliad' | 'system' | 'cron';

export async function logAudit(
  kind: AuditKind,
  actor: Actor,
  ref: string | null,
  payload: unknown,
): Promise<void> {
  const { error } = await adminClient
    .from('audit_log')
    .insert({ kind, actor, ref, payload });
  if (error) console.error('[audit] insert failed', kind, error.message);
}

export interface ModelCallRow {
  conversation_id: string | null;
  purpose: string;
  tier: string;
  model: string;
  input_tokens: number;
  cached_read_tokens: number;
  cache_write_tokens: number;
  output_tokens: number;
  cost_usd: number;
  latency_ms: number | null;
}

export async function logModelCall(row: ModelCallRow): Promise<void> {
  const { error } = await adminClient.from('model_calls').insert(row);
  if (error) console.error('[audit] model_calls insert failed', error.message);
}

export const audit = { log: logAudit, modelCall: logModelCall };
