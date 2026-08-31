import { NextRequest } from 'next/server';
import { waitUntil } from '@vercel/functions';
import { randomUUID } from 'node:crypto';
import { supabase } from '@/lib/supabase';
import { adminClient } from '@/lib/supabase.server';
import { route, type Mode } from '@/lib/router/route';
import { call } from '@/lib/brain/call';
import { audit } from '@/lib/hub/audit';
import { getIntegrationContext } from '@/lib/integrations/context';
import { relevantLoops } from '@/lib/memory/loops';
import { detectLoopsFromTurn } from '@/lib/memory/detect';
import { captureLink } from '@/lib/capture/link';
import { runMorphology } from '@/lib/tools/morphology';
import type { TurnState } from '@/lib/brain/prompt';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TZ = process.env.TZ_DEFAULT ?? 'America/New_York';
const enc = new TextEncoder();
const sse = (obj: unknown) => enc.encode(`data: ${JSON.stringify(obj)}\n\n`);

export async function POST(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return json({ error: 'Unauthorized' }, 401);
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return json({ error: 'Unauthorized' }, 401);

  let body: { text?: string; conversationId?: string };
  try { body = await req.json(); } catch { return json({ error: 'Body must be JSON' }, 400); }
  const text = body.text?.trim();
  if (!text) return json({ error: 'text required' }, 400);

  // ── conversation ────────────────────────────────────────────────────────
  let conversationId = body.conversationId;
  let currentMode: Mode = 'default';
  if (conversationId) {
    const { data } = await adminClient.from('conversations').select('id, mode').eq('id', conversationId).maybeSingle();
    if (!data) conversationId = undefined;
    else currentMode = (data.mode as Mode) ?? 'default';
  }
  if (!conversationId) {
    conversationId = randomUUID();
    await adminClient.from('conversations').insert({
      id: conversationId, surface: 'pwa', started_at: new Date().toISOString(), last_at: new Date().toISOString(),
    });
  }

  await audit.log('inbound_message', 'noah', conversationId, { text, surface: 'pwa' });
  await adminClient.from('messages').insert({ conversation_id: conversationId, role: 'user', content: text });
  await adminClient.from('conversations').update({ last_at: new Date().toISOString() }).eq('id', conversationId);

  // ── frictionless capture: one URL, not a question, little other text ──
  const urls = text.match(/https?:\/\/[^\s<>"')]+/g);
  const withoutUrls = text.replace(/https?:\/\/[^\s<>"')]+/g, ' ').replace(/\s+/g, ' ').trim();
  const looksLikeQuestion = /\?\s*$/.test(text) || /^(what|who|why|how|when|where|is|are|should|can|could|do|does|tell me|explain|summar)\b/i.test(withoutUrls);
  const isCapture =
    urls?.length === 1 && !looksLikeQuestion && withoutUrls.split(' ').filter(Boolean).length <= 10;
  if (urls && isCapture) {
    const r = await captureLink(user.id, urls[0], { source: 'chat' });
    const reply = r.ok
      ? r.deduped
        ? `Already on your ${r.item.kind} list: ${r.item.title ?? r.item.url}.`
        : `Filed under ${r.item.kind}: ${r.item.title ?? r.item.url}.${r.item.descriptor ? ` ${r.item.descriptor}` : ''}`
      : `Couldn't grab that link — ${r.error}.`;
    await adminClient.from('messages').insert({ conversation_id: conversationId, role: 'assistant', content: reply });
    await audit.log('outbound_message', 'calliad', conversationId, { text: reply, surface: 'pwa', reason: 'capture' });
    return streamResponse(conversationId, (async function* () { yield sse({ delta: reply }); yield sse({ done: true }); })());
  }

  // ── route ───────────────────────────────────────────────────────────────
  const decision = await route({ source: 'pwa', kind: 'message', text, conversationId, currentMode });
  if (decision.setMode && decision.setMode !== currentMode) {
    await adminClient.from('conversations').update({ mode: decision.setMode }).eq('id', conversationId);
  }

  if (decision.handled === 'rule') {
    const reply = decision.directReply ?? '';
    if (reply) {
      await adminClient.from('messages').insert({ conversation_id: conversationId, role: 'assistant', content: reply });
      await audit.log('outbound_message', 'calliad', conversationId, { text: reply, surface: 'pwa', reason: decision.reason });
    }
    return streamResponse(conversationId, async function* () {
      if (reply) yield sse({ delta: reply });
      yield sse({ done: true });
    }());
  }

  // ── brain ───────────────────────────────────────────────────────────────
  const effectiveMode: Mode = decision.setMode ?? decision.mode;
  const [recent, integrations, loops, toolResult] = await Promise.all([
    recentTurns(conversationId, text),
    getIntegrationContext(user.id, { daysAhead: 14, emailLimit: 8 }).catch(() => undefined),
    relevantLoops(user.id, { dueWithinDays: 21 }).catch(() => []),
    decision.tools.includes('morphology') ? runMorphology(text).catch(() => undefined) : Promise.resolve(undefined),
  ]);
  const state: TurnState = {
    now: new Date(), tz: TZ, recent, integrations, loops,
    mode: effectiveMode === 'default' ? undefined : effectiveMode,
    toolResult,
  };
  const { meta, stream } = await call({
    purpose: 'chat',
    tier: decision.tier,
    proactive: false,
    conversationId,
    userText: text,
    state,
  });

  const body$ = async function* () {
    try {
      for await (const delta of stream) yield sse({ delta });
    } catch (err) {
      yield sse({ error: String(err) });
    }
    // stream is fully drained here → meta.text / meta.costUsd populated
    const finalText = meta.text || 'Something broke on my end — try that again in a minute.';
    await adminClient.from('messages').insert({ conversation_id: conversationId, role: 'assistant', content: finalText });
    await audit.log('outbound_message', 'calliad', conversationId, {
      text: finalText, surface: 'pwa', tier: meta.tier, model: meta.model, cost_usd: meta.costUsd, capped: meta.capped,
    });
    yield sse({ done: true, costUsd: meta.costUsd, mode: effectiveMode });
    // T1 pass: file any open loop this exchange opened. waitUntil keeps the
    // serverless function alive until it finishes (a bare promise would be reaped).
    waitUntil(
      detectLoopsFromTurn(user.id, text, finalText, conversationId).catch((e) =>
        console.error('[chat] loop detect', e),
      ),
    );
  }();

  return streamResponse(conversationId, body$);
}

// ── helpers ───────────────────────────────────────────────────────────────
async function recentTurns(conversationId: string, currentText: string) {
  const { data } = await adminClient
    .from('messages')
    .select('role, content')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
    .limit(21);
  return (data ?? [])
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))
    // drop the just-inserted current user message — brain.call adds it back as the turn
    .filter((m, i, arr) => !(i === arr.length - 1 && m.role === 'user' && m.content === currentText));
}

function streamResponse(conversationId: string, gen: AsyncGenerator<Uint8Array>) {
  const stream = new ReadableStream({
    async pull(controller) {
      const { value, done } = await gen.next();
      if (done) controller.close();
      else controller.enqueue(value);
    },
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'x-conversation-id': conversationId,
    },
  });
}

function json(obj: unknown, status: number) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}
