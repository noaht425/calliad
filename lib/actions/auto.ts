import { adminClient } from '@/lib/supabase.server';
import { audit } from '@/lib/hub/audit';
import { config } from '@/lib/hub/config';
import { createCalendarEvent, updateCalendarEvent, deleteCalendarEvent, type CalendarChange } from '@/lib/integrations/icloud-calendar-write';

// The trust ladder. A `confirm`-tier action whose kind Noah has pre-authorised
// runs immediately instead of waiting for a "yes", but only reversible, local
// ones, and every run is recorded so "undo" can reverse it. Send / buy / delete
// never appear here.

export const AUTO_KINDS = [
  {
    kind: 'create_event',
    label: 'Add calendar events',
    help: 'When the title and time are clear, put it straight on your calendar instead of asking first. Say "undo" to take it back.',
  },
  {
    kind: 'update_event',
    label: 'Reschedule and rename events',
    help: 'When it\'s clear which event and what the change is, make it instead of asking first. Say "undo" to put it back.',
  },
] as const;
export type AutoKind = (typeof AUTO_KINDS)[number]['kind'];

export async function getAutoAllow(): Promise<Record<string, boolean>> {
  try {
    const v = JSON.parse(await config.get('auto_actions'));
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

export async function setAutoAllow(patch: Record<string, boolean>): Promise<Record<string, boolean>> {
  const next = { ...(await getAutoAllow()), ...patch };
  await config.set('auto_actions', JSON.stringify(next));
  return next;
}

export async function isAutoAllowed(kind: AutoKind): Promise<boolean> {
  return (await getAutoAllow())[kind] === true;
}

/** Create a calendar event with no confirm gate; record it for undo. */
export async function runAutoCreateEvent(
  userId: string,
  ev: {
    title: string; start_at: string; end_at?: string | null; all_day?: boolean; location?: string | null;
    city?: string | null; region?: string | null; country?: string | null; lat?: number | null; lon?: number | null;
    attendees?: { name: string; email: string }[];
  },
  conversationId: string,
): Promise<{ ok: boolean; error?: string }> {
  const r = await createCalendarEvent(userId, {
    title: ev.title,
    start_at: ev.start_at,
    end_at: ev.end_at ?? null,
    all_day: !!ev.all_day,
    location: ev.location ?? null,
    city: ev.city ?? null,
    region: ev.region ?? null,
    country: ev.country ?? null,
    lat: ev.lat ?? null,
    lon: ev.lon ?? null,
    attendees: ev.attendees ?? [],
  });
  await adminClient.from('actions').insert({
    kind: 'create_event',
    summary: `${ev.title} — ${ev.start_at}`,
    risk_tier: 'silent',
    status: r.ok ? 'done' : 'failed',
    payload: { ...ev, uid: r.uid, auto: true },
    created_by: conversationId,
    decided_at: new Date().toISOString(),
    executed_at: new Date().toISOString(),
    result: r.ok ? 'auto' : (r.error ?? 'failed'),
  });
  await audit.log('action_executed', 'calliad', conversationId, { kind: 'create_event', auto: true, ok: r.ok });
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

/** Update a calendar event with no confirm gate; stash the prior values so
 *  "undo" can put them back. `prev` holds only the fields `change` touches. */
export async function runAutoUpdateEvent(
  userId: string,
  uid: string,
  title: string,
  change: CalendarChange,
  prev: CalendarChange,
  conversationId: string,
): Promise<{ ok: boolean; error?: string }> {
  const r = await updateCalendarEvent(userId, uid, change);
  await adminClient.from('actions').insert({
    kind: 'update_event',
    summary: `Update "${title}"`,
    risk_tier: 'silent',
    status: r.ok ? 'done' : 'failed',
    payload: { uid, title, change, prev, auto: true },
    created_by: conversationId,
    decided_at: new Date().toISOString(),
    executed_at: new Date().toISOString(),
    result: r.ok ? 'auto' : (r.error ?? 'failed'),
  });
  await audit.log('action_executed', 'calliad', conversationId, { kind: 'update_event', auto: true, ok: r.ok });
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

/** Record a schedule import (many events at once) for undo. The events
 *  themselves are already created by the time this is called. */
export async function recordScheduleImport(
  info: { label: string; uids: string[]; created: number; skipped: number },
  conversationId: string,
): Promise<void> {
  await adminClient.from('actions').insert({
    kind: 'create_schedule',
    summary: `${info.label} — ${info.created} event${info.created === 1 ? '' : 's'} added${info.skipped ? `, ${info.skipped} already there` : ''}`,
    risk_tier: 'silent',
    status: 'done',
    payload: { uids: info.uids, label: info.label, auto: true },
    created_by: conversationId,
    decided_at: new Date().toISOString(),
    executed_at: new Date().toISOString(),
    result: 'auto',
  });
  await audit.log('action_executed', 'calliad', conversationId, { kind: 'create_schedule', auto: true, created: info.created });
}

const UNDO_WINDOW_MS = 30 * 60_000;

export function isUndo(t: string): boolean {
  return /^\s*(undo(\s+(that|it|the last( one)?|that change))?|nope,?\s+undo|scratch that|take that back|revert( that| it)?|(change|put|move) (that|it) back|(never ?mind,?\s+)?(undo|remove|delete)\s+(that|the)\s+(event|calendar)( entry)?)\s*[.!]?\s*$/i.test(t);
}

/** Reverse the most recent auto-action in this conversation, if it's recent. */
export async function undoLastAuto(userId: string, conversationId: string): Promise<string | null> {
  const { data: row } = await adminClient
    .from('actions')
    .select('id, kind, payload, executed_at')
    .eq('created_by', conversationId)
    .eq('status', 'done')
    .order('executed_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!row) return null;

  const p = (row.payload ?? {}) as Record<string, unknown>;
  if (!p.auto) return null;
  if (!row.executed_at || Date.now() - Date.parse(row.executed_at as string) > UNDO_WINDOW_MS) return null;

  if (row.kind === 'create_event' && p.uid) {
    const r = await deleteCalendarEvent(userId, String(p.uid));
    if (!r.ok) return `Tried to undo that, but couldn't remove it: ${r.error}.`;
    await adminClient.from('actions').update({ status: 'undone' }).eq('id', row.id);
    await audit.log('action_executed', 'noah', conversationId, { kind: 'undo', of: row.id });
    return `Undone, took "${String(p.title ?? 'that event')}" back off your calendar.`;
  }
  if (row.kind === 'update_event' && p.uid && p.prev) {
    const r = await updateCalendarEvent(userId, String(p.uid), p.prev as CalendarChange);
    if (!r.ok) return `Tried to undo that, but couldn't change it back: ${r.error}.`;
    await adminClient.from('actions').update({ status: 'undone' }).eq('id', row.id);
    await audit.log('action_executed', 'noah', conversationId, { kind: 'undo', of: row.id });
    return `Undone, put "${String(p.title ?? 'that event')}" back the way it was.`;
  }
  if (row.kind === 'create_schedule' && Array.isArray(p.uids)) {
    let removed = 0;
    for (const uid of p.uids as string[]) {
      const r = await deleteCalendarEvent(userId, uid).catch(() => ({ ok: false }));
      if (r.ok) removed++;
    }
    await adminClient.from('actions').update({ status: 'undone' }).eq('id', row.id);
    await audit.log('action_executed', 'noah', conversationId, { kind: 'undo', of: row.id, removed });
    return `Undone, removed ${removed} event${removed === 1 ? '' : 's'} from "${String(p.label ?? 'that import')}".`;
  }
  return null;
}
