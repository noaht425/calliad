// Telegram Bot API — the "reach anywhere" channel. Calliad both receives here
// (app/api/telegram webhook) and sends here (replies + proactive notifications).
// Free API, no per-message cost. Dark when TELEGRAM_BOT_TOKEN is unset.

const TOKEN = () => process.env.TELEGRAM_BOT_TOKEN ?? '';
const API = () => `https://api.telegram.org/bot${TOKEN()}`;
const FILE_API = () => `https://api.telegram.org/file/bot${TOKEN()}`;

export const telegramEnabled = () => Boolean(TOKEN());

async function call<T = unknown>(method: string, body: Record<string, unknown>): Promise<T | null> {
  if (!telegramEnabled()) return null;
  try {
    const r = await fetch(`${API()}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const j = (await r.json()) as { ok: boolean; result?: T; description?: string };
    if (!j.ok) {
      console.error(`[telegram] ${method} failed: ${j.description}`);
      return null;
    }
    return j.result ?? null;
  } catch (err) {
    console.error(`[telegram] ${method} error`, err);
    return null;
  }
}

// Telegram hard-caps a message at 4096 chars; split on paragraph/line boundaries.
function chunk(text: string, size = 3800): string[] {
  if (text.length <= size) return [text];
  const out: string[] = [];
  let buf = '';
  for (const line of text.split('\n')) {
    if (buf.length + line.length + 1 > size) {
      if (buf) out.push(buf);
      buf = line;
    } else {
      buf = buf ? `${buf}\n${line}` : line;
    }
  }
  if (buf) out.push(buf);
  return out;
}

/** Send a plain-text message (chunked if long). Returns true if all parts sent. */
export async function sendTelegram(chatId: number | string, text: string): Promise<boolean> {
  if (!text.trim()) return false;
  let ok = true;
  for (const part of chunk(text)) {
    const r = await call('sendMessage', {
      chat_id: chatId,
      text: part,
      link_preview_options: { is_disabled: true },
    });
    ok = ok && r !== null;
  }
  return ok;
}

/** "typing…" indicator — best-effort, fire and forget. */
export async function sendChatAction(chatId: number | string, action = 'typing'): Promise<void> {
  await call('sendChatAction', { chat_id: chatId, action });
}

/** Download a Telegram file as a Blob (voice notes, photos). Throws with a
 *  descriptive message on any failure so callers can surface / log the reason. */
export async function fetchTelegramFile(fileId: string): Promise<{ blob: Blob; name: string }> {
  const gf = await fetch(`${API()}/getFile`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ file_id: fileId }),
    signal: AbortSignal.timeout(15_000),
  });
  const gj = (await gf.json().catch(() => ({}))) as {
    ok?: boolean; result?: { file_path?: string; file_size?: number }; description?: string;
  };
  if (!gj.ok || !gj.result?.file_path) {
    throw new Error(`getFile ${gf.status}: ${gj.description ?? 'no file_path'}`);
  }
  const filePath = gj.result.file_path;
  const r = await fetch(`${FILE_API()}/${filePath}`, { signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`download HTTP ${r.status} (${filePath})`);
  const ab = await r.arrayBuffer();
  const type = r.headers.get('content-type') || 'application/octet-stream';
  return { blob: new Blob([ab], { type }), name: filePath.split('/').pop() || 'file' };
}

// ── inbound update shapes (only the fields we use) ──────────────────────────
export interface TgMessage {
  message_id: number;
  from?: { id: number; username?: string; first_name?: string; is_bot?: boolean };
  chat: { id: number; type: string };
  date: number;
  text?: string;
  caption?: string;
  voice?: { file_id: string; duration?: number; mime_type?: string };
  audio?: { file_id: string; duration?: number; mime_type?: string };
  photo?: { file_id: string; width: number; height: number; file_size?: number }[];
}
export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  edited_message?: TgMessage;
}
