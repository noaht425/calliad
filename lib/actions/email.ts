import Anthropic from '@anthropic-ai/sdk';
import { adminClient } from '@/lib/supabase.server';
import { audit } from '@/lib/hub/audit';
import { anthropicCostUsd } from '@/lib/router/tiers';
import { t1Json, t1Available } from '@/lib/llm/gemini';

// Draft-email = compose + hand off. Nothing is sent: on approval Noah gets the
// finished subject/body and a mailto: link that opens his mail app pre-filled.
// No Gmail write scope, matching the flight/restaurant deep-link pattern.

const anthropic = new Anthropic();

/** Explicit "compose me an email" intent — NOT "remind me to email X" (that's a task). */
export const isEmailDraft = (t: string) =>
  /\b(draft|write|compose|put together|help me write)\s+(me\s+)?(an?\s+)?(email|e-mail|message|note|reply)\b/i.test(t) ||
  /\b(email|e-mail|write|message)\s+[A-Z][\w.'-]+(\s+[A-Z][\w.'-]+)?\s+(and\s+)?(say(ing)?|tell(ing)?|ask(ing)?|let(ting)?\s+(them|him|her)\s+know|to\s+say|that\s+)/i.test(t) ||
  /\breply to (that|the|his|her|their)\s+(email|message|mail)\b/i.test(t);

interface Draft { to_name: string | null; to_email: string | null; subject: string; body: string }

function parseAddr(fromAddr: string | null): { name: string | null; email: string | null } {
  if (!fromAddr) return { name: null, email: null };
  const m = fromAddr.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].trim() || null, email: m[2].trim() };
  return /@/.test(fromAddr) ? { name: null, email: fromAddr.trim() } : { name: fromAddr.trim(), email: null };
}

/** Best-effort: if Noah named a person but no address, look in the watched-label mail. */
async function resolveRecipient(userId: string, name: string | null, email: string | null): Promise<{ name: string | null; email: string | null }> {
  if (email || !name) return { name, email };
  const first = name.replace(/^(prof\.?|professor|dr\.?|mr\.?|ms\.?|mrs\.?)\s+/i, '').split(/\s+/)[0].toLowerCase();
  const { data } = await adminClient
    .from('email_items')
    .select('from_addr')
    .eq('user_id', userId)
    .ilike('from_addr', `%${first}%`)
    .order('received_at', { ascending: false })
    .limit(1);
  const hit = data?.[0]?.from_addr ? parseAddr(data[0].from_addr) : null;
  return hit?.email ? { name: name ?? hit.name, email: hit.email } : { name, email };
}

/** T2 composes the actual email; T1/regex pulls the recipient. Returns a review-ready draft. */
export async function composeEmail(userId: string, request: string): Promise<Draft & { costUsd: number }> {
  // recipient
  let toName: string | null = null;
  let toEmail: string | null = null;
  const addrInText = request.match(/[\w.+-]+@[\w-]+\.[\w.-]+/)?.[0] ?? null;
  if (addrInText) toEmail = addrInText;
  if (t1Available()) {
    const r = await t1Json<{ to_name: string | null; to_email: string | null }>(
      'email_recipient',
      `Who is this email to? "${request.slice(0, 400)}"\nReturn {"to_name":"person or role, or null","to_email":"address if stated, else null"}`,
      { maxOutputTokens: 60 },
    );
    toName = r?.to_name ?? toName;
    toEmail = toEmail ?? r?.to_email ?? null;
  }
  ({ name: toName, email: toEmail } = await resolveRecipient(userId, toName, toEmail).catch(() => ({ name: toName, email: toEmail })));

  // body — T2
  const started = Date.now();
  const msg = await anthropic.messages.create({
    model: 'claude-sonnet-5',
    max_tokens: 700,
    system:
      "Compose an email for Noah to send. He is a Classics student — plain, direct, warm-but-not-effusive, no corporate filler, no exclamation-mark padding. Match the formality to the recipient (a professor gets 'Dear Professor X' and a sign-off; a friend is looser). Keep it short. Return ONLY minified JSON: {\"subject\":\"...\",\"body\":\"...\"}. The body is the full message including greeting and sign-off (Noah's name at the end). No markdown.",
    messages: [{ role: 'user', content: request }],
  });
  const costUsd = anthropicCostUsd('claude-sonnet-5', msg.usage);
  await audit.modelCall({
    conversation_id: null, purpose: 'compose_email', tier: 'T2', model: 'claude-sonnet-5',
    input_tokens: msg.usage.input_tokens, cached_read_tokens: msg.usage.cache_read_input_tokens ?? 0,
    cache_write_tokens: msg.usage.cache_creation_input_tokens ?? 0, output_tokens: msg.usage.output_tokens,
    cost_usd: costUsd, latency_ms: Date.now() - started,
  });

  const rawText = msg.content.filter((b) => b.type === 'text').map((b) => (b as Anthropic.TextBlock).text).join('');
  let subject = '(no subject)';
  let body = rawText.trim();
  try {
    const parsed = JSON.parse(rawText.replace(/```json\n?|\n?```/g, '').trim()) as { subject?: string; body?: string };
    if (parsed.subject) subject = parsed.subject;
    if (parsed.body) body = parsed.body;
  } catch { /* keep raw text as the body */ }

  return { to_name: toName, to_email: toEmail, subject, body, costUsd };
}

export function buildMailto(d: { to_email: string | null; subject: string; body: string }): string {
  const to = d.to_email ?? '';
  return `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(d.subject)}&body=${encodeURIComponent(d.body)}`;
}

/** Gate executor for kind 'draft_email' — no send, just the hand-off. */
export function handoffEmail(payload: Record<string, unknown>): { ok: true; message: string } {
  const d = {
    to_email: (payload.to_email as string | null) ?? null,
    to_name: (payload.to_name as string | null) ?? null,
    subject: String(payload.subject ?? '(no subject)'),
    body: String(payload.body ?? ''),
  };
  const link = buildMailto(d);
  const who = d.to_email ?? d.to_name ?? 'the recipient';
  return {
    ok: true,
    message:
      `Here it is — nothing's been sent.\n\n**To:** ${who}\n**Subject:** ${d.subject}\n\n${d.body}\n\n` +
      `[Open in your mail app](${link})` +
      (d.to_email ? '' : `\n\n(No address on file — add it in the To: field.)`),
  };
}
