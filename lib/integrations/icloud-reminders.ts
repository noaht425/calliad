import { randomUUID } from 'node:crypto';
import type { DAVCalendar } from 'tsdav';
import { adminClient } from '@/lib/supabase.server';
import { getICloudConnection } from '@/lib/integrations/icloud-calendar';
import { audit } from '@/lib/hub/audit';

// Apple Reminders over the same iCloud CalDAV connection as the calendar —
// Reminders lists are just VTODO-component calendars on the account. No extra
// auth. NB: Noah rarely ticks the checkbox, so `completed` is a weak signal
// (see the medication rule in the persona) — treat "not completed" as "maybe".

export interface Reminder {
  uid: string;
  url: string;
  etag?: string;
  list: string;
  title: string;
  due: string | null; // ISO
  completed: boolean;
  priority: number | null; // 1 (high) – 9 (low), iCal convention
  notes: string | null;
}

// ── tiny iCal helpers (the calendar module keeps its own private copies) ────
const unfold = (s: string) => s.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '');
function prop(block: string, name: string): { params: string; value: string } | null {
  const m = unfold(block).match(new RegExp(`^${name}([^:\\r\\n]*):(.*)$`, 'm'));
  return m ? { params: m[1] ?? '', value: (m[2] ?? '').trim() } : null;
}
function icalToISO(value: string, params: string): string {
  if (/VALUE=DATE\b/.test(params) || /^\d{8}$/.test(value)) {
    return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T00:00:00.000Z`;
  }
  const m = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/);
  if (!m) return value;
  const [, y, mo, d, h, mi, s, z] = m;
  return z
    ? `${y}-${mo}-${d}T${h}:${mi}:${s}.000Z`
    : new Date(+y, +mo - 1, +d, +h, +mi, +s).toISOString(); // floating → local
}
// tsdav's fetchCalendarObjects hard-codes a VEVENT comp-filter; override it or a
// VTODO calendar returns nothing.
const VTODO_FILTER = [
  { 'comp-filter': { _attributes: { name: 'VCALENDAR' }, 'comp-filter': { _attributes: { name: 'VTODO' } } } },
] as unknown as Parameters<import('tsdav').DAVClient['fetchCalendarObjects']>[0]['filters'];

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
const fmtDate = (iso: string) => {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
};

// ── list the VTODO calendars (Reminders lists) on the account ──────────────
export async function listReminderLists(userId: string): Promise<{ url: string; name: string }[]> {
  const conn = await getICloudConnection(userId);
  if (!conn) return [];
  const cals = await conn.client.fetchCalendars();
  return cals
    .filter((c) => ((c.components ?? []) as string[]).includes('VTODO'))
    .map((c) => ({ url: c.url, name: (c.displayName as string) ?? c.url }));
}

// ── read reminders ────────────────────────────────────────────────────────
export async function fetchReminders(
  userId: string,
  opts: { includeCompleted?: boolean; listUrl?: string } = {},
): Promise<Reminder[]> {
  const conn = await getICloudConnection(userId);
  if (!conn) return [];
  const lists = opts.listUrl
    ? [{ url: opts.listUrl, name: '' }]
    : await listReminderLists(userId);

  const out: Reminder[] = [];
  for (const list of lists) {
    try {
      const objs = await conn.client.fetchCalendarObjects({ calendar: { url: list.url } as DAVCalendar, filters: VTODO_FILTER });
      for (const o of objs) {
        for (const block of String(o.data ?? '').match(/BEGIN:VTODO[\s\S]*?END:VTODO/g) ?? []) {
          const uid = prop(block, 'UID')?.value;
          const title = prop(block, 'SUMMARY')?.value;
          if (!uid || !title) continue;
          // Apple replaces real reminders with these two placeholders once a list
          // is "upgraded" — CalDAV then can't see the actual items.
          if (/where are my reminders|upgraded these reminders/i.test(title)) continue;
          const status = prop(block, 'STATUS')?.value ?? '';
          const completed = status === 'COMPLETED' || /^PERCENT-COMPLETE:100/m.test(block);
          if (completed && !opts.includeCompleted) continue;
          const dueP = prop(block, 'DUE');
          const pr = prop(block, 'PRIORITY')?.value;
          out.push({
            uid,
            url: o.url,
            etag: o.etag,
            list: list.name || list.url.split('/').filter(Boolean).pop() || 'Reminders',
            title: title.replace(/\\,/g, ',').replace(/\\n/g, '\n'),
            due: dueP ? icalToISO(dueP.value, dueP.params) : null,
            completed,
            priority: pr ? Number(pr) || null : null,
            notes: prop(block, 'DESCRIPTION')?.value?.replace(/\\n/g, '\n').replace(/\\,/g, ',') ?? null,
          });
        }
      }
    } catch (e) {
      await audit.log('error', 'system', null, { where: 'fetchReminders', list: list.url, message: String(e) });
    }
  }
  return out;
}

// ── create ───────────────────────────────────────────────────────────────
export async function createReminder(
  userId: string,
  input: { title: string; due?: string | null; notes?: string | null; listUrl?: string },
): Promise<{ ok: boolean; uid?: string; list?: string; error?: string }> {
  const conn = await getICloudConnection(userId);
  if (!conn) return { ok: false, error: 'iCloud not connected' };
  const lists = await listReminderLists(userId);
  if (!lists.length) return { ok: false, error: 'no Reminders lists on this iCloud account' };
  const target = lists.find((l) => l.url === input.listUrl) ?? lists[0];

  const uid = `${randomUUID()}@calliad`;
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Calliad//Calliad//EN',
    'BEGIN:VTODO',
    `UID:${uid}`,
    `DTSTAMP:${fmtDate(new Date().toISOString())}`,
    `SUMMARY:${esc(input.title)}`,
    'STATUS:NEEDS-ACTION',
  ];
  if (input.due) lines.push(`DUE:${fmtDate(input.due)}`);
  if (input.notes) lines.push(`DESCRIPTION:${esc(input.notes)}`);
  lines.push('X-CALLIAD-SOURCE:calliad', 'END:VTODO', 'END:VCALENDAR');

  try {
    await conn.client.createCalendarObject({
      calendar: { url: target.url } as never,
      filename: `${uid}.ics`,
      iCalString: lines.join('\r\n'),
    });
    // Reflect it locally right away so it shows before the next sync.
    await adminClient.from('reminders').upsert(
      {
        user_id: userId, uid, list_name: target.name, title: input.title,
        due_at: input.due ?? null, completed: false, notes: input.notes ?? null,
        source: 'calliad', updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,uid' },
    );
    await audit.log('outbound_message', 'calliad', null, { action: 'create_reminder', title: input.title, list: target.name });
    return { ok: true, uid, list: target.name };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

// ── sync live reminders → the `reminders` table ───────────────────────────
export async function syncReminders(
  userId: string,
): Promise<{ synced: number; removed: number; lists: number; error?: string }> {
  const conn = await getICloudConnection(userId);
  if (!conn) return { synced: 0, removed: 0, lists: 0, error: 'not_connected' };

  const lists = await listReminderLists(userId);
  const live = await fetchReminders(userId, { includeCompleted: true });

  if (live.length || lists.length) {
    await adminClient.from('reminders').upsert(
      live.map((r) => ({
        user_id: userId,
        uid: r.uid,
        url: r.url,
        list_name: r.list,
        title: r.title,
        due_at: r.due,
        completed: r.completed,
        priority: r.priority,
        notes: r.notes,
        source: 'icloud',
        updated_at: new Date().toISOString(),
      })),
      { onConflict: 'user_id,uid' },
    );
  }

  // drop rows whose reminder no longer exists on the account
  const liveUids = new Set(live.map((r) => r.uid));
  const { data: existing } = await adminClient.from('reminders').select('uid').eq('user_id', userId);
  const stale = (existing ?? []).map((x) => x.uid).filter((u) => !liveUids.has(u));
  if (stale.length) await adminClient.from('reminders').delete().eq('user_id', userId).in('uid', stale);

  await audit.log('trigger_fired', 'cron', 'sync', { part: 'reminders', synced: live.length, removed: stale.length, lists: lists.length });
  return { synced: live.length, removed: stale.length, lists: lists.length };
}

// ── complete ─────────────────────────────────────────────────────────────
export async function completeReminder(userId: string, uid: string): Promise<{ ok: boolean; error?: string }> {
  const conn = await getICloudConnection(userId);
  if (!conn) return { ok: false, error: 'iCloud not connected' };
  const all = await fetchReminders(userId, { includeCompleted: true });
  const r = all.find((x) => x.uid === uid && !x.completed);
  if (!r) return { ok: false, error: 'reminder not found (or already done)' };

  try {
    const objs = await conn.client.fetchCalendarObjects({ calendar: { url: r.url } as DAVCalendar, filters: VTODO_FILTER });
    const obj = objs.find((o) => o.url === r.url) ?? objs[0];
    if (!obj?.data) return { ok: false, error: 'could not re-fetch the reminder' };
    let data = String(obj.data);
    if (/^STATUS:.*$/m.test(data)) data = data.replace(/^STATUS:.*$/m, 'STATUS:COMPLETED');
    else data = data.replace(/^END:VTODO$/m, 'STATUS:COMPLETED\r\nEND:VTODO');
    data = data.replace(/^END:VTODO$/m, `COMPLETED:${fmtDate(new Date().toISOString())}\r\nPERCENT-COMPLETE:100\r\nEND:VTODO`);
    await conn.client.updateCalendarObject({ calendarObject: { url: obj.url, data, etag: obj.etag } });
    await adminClient.from('reminders').update({ completed: true, updated_at: new Date().toISOString() }).eq('user_id', userId).eq('uid', uid);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}
