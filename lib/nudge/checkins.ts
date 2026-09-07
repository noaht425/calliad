import { randomUUID } from 'node:crypto';
import { adminClient } from '@/lib/supabase.server';
import { call } from '@/lib/brain/call';
import { audit } from '@/lib/hub/audit';
import { enqueueNotification } from '@/lib/hub/notify';
import { ownerUserIds } from '@/lib/hub/owner';
import { setLoopStatus } from '@/lib/memory/loops';
import type { TurnState } from '@/lib/brain/prompt';

const TZ = process.env.TZ_DEFAULT ?? 'America/New_York';
const STALE_MS = 3 * 86_400_000; // past this, the moment's gone — close it silently

// Social follow-ups. detectFromTurn files a loop tagged 'checkin' when Noah
// mentions something a friend would remember to ask about (an interview, a
// first shift, being unwell). When it comes due the tick worker turns it into
// one short, warm "how did that go?" and closes the loop.

interface CheckinLoop { id: string; title: string; body: string | null; due_at: string | null }

async function forUser(userId: string): Promise<number> {
  const { data } = await adminClient
    .from('open_loops')
    .select('id, title, body, due_at')
    .eq('user_id', userId)
    .eq('status', 'open')
    .contains('tags', ['checkin'])
    .not('due_at', 'is', null)
    .lte('due_at', new Date().toISOString())
    .order('due_at', { ascending: true })
    .limit(3);

  let sent = 0;
  for (const loop of (data ?? []) as CheckinLoop[]) {
    // missed the window — just close it, don't ask about something days gone
    if (loop.due_at && Date.now() - Date.parse(loop.due_at) > STALE_MS) {
      await setLoopStatus(userId, loop.id, 'dropped').catch(() => {});
      continue;
    }

    const what = loop.title.replace(/^check in:\s*/i, '').trim();
    const now = new Date();
    const conversationId = randomUUID();
    await adminClient.from('conversations').insert({
      id: conversationId, surface: 'cron', started_at: now.toISOString(), last_at: now.toISOString(),
      title: `Check-in: ${what}`.slice(0, 80),
    });

    const instruction =
      `Earlier, Noah mentioned: "${what}". It should be over by now. Check in the way a friend would: one short, warm line asking how it went${loop.body ? ` (${loop.body})` : ''}. No pressure, no follow-up questions stacked on, and if it was something hard don't be chirpy about it. Just the message.`;

    const state: TurnState = { now, tz: TZ, recent: [] };
    let text = '';
    try {
      const { meta, stream } = await call({
        purpose: 'brief', tier: 'T2', proactive: true, conversationId, userText: instruction, state, maxTokens: 200,
      });
      for await (const d of stream) text += d;
      if (meta.deferred) { text = ''; }
      if (text) {
        await adminClient.from('messages').insert({ conversation_id: conversationId, role: 'assistant', content: text });
        await audit.log('outbound_message', 'calliad', conversationId, {
          text, surface: 'cron', purpose: 'checkin', what, tier: meta.tier, model: meta.model, cost_usd: meta.costUsd,
        });
      }
    } catch (e) {
      console.error('[checkins] compose', e);
    }

    if (!text) continue; // spend-cap / error — leave the loop open, try next tick

    const r = await enqueueNotification(userId, {
      kind: 'checkin',
      title: 'Checking in',
      body: text,
      dedupeKey: `checkin:${loop.id}`,
    });
    await setLoopStatus(userId, loop.id, 'done').catch(() => {});
    if (r === 'queued') sent++;
  }
  return sent;
}

export async function runCheckins(): Promise<{ enqueued: number }> {
  let enqueued = 0;
  for (const uid of await ownerUserIds()) {
    enqueued += await forUser(uid).catch((e) => {
      console.error('[checkins] forUser', e);
      return 0;
    });
  }
  return { enqueued };
}
