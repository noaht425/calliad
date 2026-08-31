import { adminClient } from '@/lib/supabase.server';
import { audit } from '@/lib/hub/audit';
import { createCalendarEvent } from '@/lib/integrations/icloud-calendar-write';

// Graduated-authorization gate. Every world-changing action is proposed as a
// pending row; friction scales with risk_tier:
//   silent            → callers just do it (not routed here)
//   confirm           → one "yes"
//   named_consequence → Noah must restate the consequence (fees, irreversible)

export type ActionKind = 'create_event'; // extend: send_email, book, merge_pr, ...
export type RiskTier = 'silent' | 'confirm' | 'named_consequence';

export interface PendingAction {
  id: string;
  kind: ActionKind;
  summary: string;
  risk_tier: RiskTier;
  payload: Record<string, unknown>;
}

export async function proposeAction(input: {
  userId: string;
  kind: ActionKind;
  summary: string;
  riskTier: RiskTier;
  payload: Record<string, unknown>;
  createdBy: string; // conversation id
}): Promise<string> {
  const { data } = await adminClient
    .from('actions')
    .insert({
      kind: input.kind,
      summary: input.summary,
      risk_tier: input.riskTier,
      status: 'pending',
      payload: input.payload,
      created_by: input.createdBy,
    })
    .select('id')
    .single();
  await audit.log('action_proposed', 'calliad', input.createdBy, {
    action_id: data?.id, kind: input.kind, risk_tier: input.riskTier, summary: input.summary,
  });
  return data?.id ?? '';
}

export async function pendingFor(conversationId: string): Promise<PendingAction | null> {
  const { data } = await adminClient
    .from('actions')
    .select('id, kind, summary, risk_tier, payload')
    .eq('created_by', conversationId)
    .eq('status', 'pending')
    .order('ts', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as PendingAction) ?? null;
}

export async function decideAction(
  userId: string,
  actionId: string,
  decision: 'approved' | 'rejected',
  conversationId: string,
): Promise<{ ok: boolean; message: string }> {
  const { data: action } = await adminClient
    .from('actions').select('*').eq('id', actionId).eq('status', 'pending').maybeSingle();
  if (!action) return { ok: false, message: 'That request already expired.' };

  await adminClient.from('actions').update({ status: decision, decided_at: new Date().toISOString() }).eq('id', actionId);
  await audit.log('action_decided', 'noah', conversationId, { action_id: actionId, decision });

  if (decision === 'rejected') return { ok: true, message: 'Left it.' };

  // ── execute ──────────────────────────────────────────────────────────
  const payload = (action.payload ?? {}) as Record<string, unknown>;
  let result: { ok: boolean; message: string };
  try {
    if (action.kind === 'create_event') {
      const r = await createCalendarEvent(userId, {
        title: String(payload.title ?? 'Untitled'),
        start_at: String(payload.start_at),
        end_at: (payload.end_at as string | null) ?? null,
        all_day: Boolean(payload.all_day),
        location: (payload.location as string | null) ?? null,
      });
      result = r.ok
        ? { ok: true, message: `Done — it's on your calendar.` }
        : { ok: false, message: `Couldn't write to your calendar: ${r.error}` };
    } else {
      result = { ok: false, message: `Don't know how to run "${action.kind}" yet.` };
    }
  } catch (err) {
    result = { ok: false, message: `Failed: ${String(err)}` };
  }

  await adminClient.from('actions').update({
    status: result.ok ? 'done' : 'failed',
    executed_at: new Date().toISOString(),
    result: result.message,
  }).eq('id', actionId);
  await audit.log('action_executed', 'calliad', conversationId, { action_id: actionId, ok: result.ok, result: result.message });
  return result;
}
