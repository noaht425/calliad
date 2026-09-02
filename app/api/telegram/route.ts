import { NextRequest } from 'next/server';
import { waitUntil } from '@vercel/functions';
import { randomUUID } from 'node:crypto';
import { adminClient } from '@/lib/supabase.server';
import { audit } from '@/lib/hub/audit';
import {
  sendTelegram, sendChatAction, fetchTelegramFile, telegramEnabled,
  type TgUpdate, type TgMessage,
} from '@/lib/integrations/telegram';
import { transcribe } from '@/lib/llm/groq';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://calliad-psi.vercel.app';

const HELP =
  "I'm Calliad. Send a message, a voice note, or a photo and I'll answer here — " +
  "same brain as the app. Anything you can do in chat works: tasks, calendar, watchers, questions.";

function ok() {
  return new Response('ok', { status: 200 });
}

/** The single owner account. Prefers CAPTURE_USER_EMAIL, else the only user. */
async function ownerUserId(): Promise<string | null> {
  const { data } = await adminClient.auth.admin.listUsers();
  const email = process.env.CAPTURE_USER_EMAIL;
  const u = (email ? data.users.find((x) => x.email === email) : data.users[0]) ?? null;
  return u?.id ?? null;
}

function senderAllowed(msg: TgMessage): boolean {
  const uname = (process.env.TELEGRAM_ALLOWED_USERNAME ?? '').replace(/^@/, '').toLowerCase();
  const uid = process.env.TELEGRAM_ALLOWED_USER_ID ?? '';
  const from = msg.from;
  if (!from) return false;
  if (uname && from.username && from.username.toLowerCase() === uname) return true;
  if (uid && String(from.id) === uid) return true;
  // If neither gate is configured, allow the first person to message (single-user setup).
  return !uname && !uid;
}

/** One durable Telegram thread, reused across messages. */
async function telegramConversationId(): Promise<string> {
  const { data } = await adminClient
    .from('conversations')
    .select('id')
    .eq('surface', 'telegram')
    .order('last_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (data?.id) return data.id as string;
  const id = randomUUID();
  await adminClient.from('conversations').insert({
    id, surface: 'telegram', started_at: new Date().toISOString(), last_at: new Date().toISOString(),
  });
  return id;
}

/** Run a turn through the same orchestrator the PWA uses; collect the reply. */
async function runBrainTurn(userId: string, conversationId: string, text: string, images: string[]): Promise<string> {
  const res = await fetch(`${APP_URL}/api/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.TICK_SECRET ?? ''}`,
      'x-calliad-user': userId,
    },
    body: JSON.stringify({ text, images, conversationId, surface: 'telegram' }),
    signal: AbortSignal.timeout(55_000),
  });
  if (!res.ok || !res.body) {
    return "Something broke on my end — try that again in a minute.";
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let out = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split('\n\n');
    buf = parts.pop() ?? '';
    for (const part of parts) {
      const line = part.split('\n').find((l) => l.startsWith('data:'));
      if (!line) continue;
      try {
        const j = JSON.parse(line.slice(5).trim());
        if (typeof j.delta === 'string') out += j.delta;
      } catch { /* keep-alive / non-JSON */ }
    }
  }
  return out.trim() || "…";
}

async function handleMessage(msg: TgMessage): Promise<void> {
  const chatId = msg.chat.id;

  const { data: link } = await adminClient
    .from('telegram_links')
    .select('user_id')
    .eq('chat_id', chatId)
    .maybeSingle();

  // ── not linked yet ─────────────────────────────────────────────────────
  if (!link) {
    if (!senderAllowed(msg)) {
      if ((msg.text ?? '').startsWith('/start')) await sendTelegram(chatId, 'This assistant is private.');
      return;
    }
    const userId = await ownerUserId();
    if (!userId) { await sendTelegram(chatId, 'Not set up yet — no owner account found.'); return; }
    await adminClient.from('telegram_links').upsert(
      { user_id: userId, chat_id: chatId, username: msg.from?.username ?? null, linked_at: new Date().toISOString() },
      { onConflict: 'user_id' },
    );
    await audit.log('trigger_fired', 'system', String(chatId), { event: 'telegram_linked', username: msg.from?.username });
    await sendTelegram(chatId, `Linked. ${HELP}`);
    return;
  }

  const userId = link.user_id as string;
  const rawText = (msg.text ?? msg.caption ?? '').trim();

  if (rawText === '/start' || rawText === '/help') { await sendTelegram(chatId, HELP); return; }

  let text = rawText;
  const images: string[] = [];

  // voice note → transcribe
  const voice = msg.voice ?? msg.audio;
  if (voice?.file_id) {
    const f = await fetchTelegramFile(voice.file_id).catch(() => null);
    if (f) {
      try {
        const { text: t } = await transcribe(f.blob, f.name || 'voice.ogg', {});
        if (t.trim()) text = t.trim();
      } catch (err) {
        await audit.log('error', 'system', String(chatId), { where: 'telegram.transcribe', message: String(err) });
      }
    }
    if (!text.trim()) { await sendTelegram(chatId, "Didn't catch that — try again."); return; }
  }

  // photo → attach the largest rendition
  if (msg.photo?.length) {
    const biggest = msg.photo[msg.photo.length - 1];
    const f = await fetchTelegramFile(biggest.file_id).catch(() => null);
    if (f) {
      const b64 = Buffer.from(await f.blob.arrayBuffer()).toString('base64');
      if (b64.length < 7_000_000) images.push(`data:image/jpeg;base64,${b64}`);
    }
  }

  if (!text && !images.length) return;

  await sendChatAction(chatId, 'typing');
  const conversationId = await telegramConversationId();
  const reply = await runBrainTurn(userId, conversationId, text, images).catch(
    () => "Something broke on my end — try that again in a minute.",
  );
  await sendTelegram(chatId, reply);
}

export async function POST(req: NextRequest) {
  if (!telegramEnabled()) return ok();

  // Telegram sends this header when the webhook was registered with a secret_token.
  // Fail closed: without a configured secret we can't tell a real update from a
  // forged one, so we don't process anything.
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret || req.headers.get('x-telegram-bot-api-secret-token') !== secret) {
    return ok(); // stay quiet; don't give Telegram a reason to retry
  }

  let update: TgUpdate;
  try { update = (await req.json()) as TgUpdate; } catch { return ok(); }

  const msg = update.message ?? update.edited_message;
  if (!msg?.chat?.id || msg.from?.is_bot) return ok();

  // Ack immediately; do the slow work (STT + brain) after the response.
  waitUntil(handleMessage(msg).catch((err) => console.error('[telegram] handle', err)));
  return ok();
}
