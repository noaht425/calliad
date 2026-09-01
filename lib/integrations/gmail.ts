import { google } from 'googleapis';
import { adminClient } from '@/lib/supabase.server';

// Phase 1 Gmail: read one label. No sending, no travel parsing — just pull recent
// messages from the watched label into email_items so the brief can reason over them.
// OAuth + token-refresh pattern is Doug's, kept as-is.

const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];
const DEFAULT_LABEL = 'Calliad';
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://calliad-psi.vercel.app';

function makeOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${APP_URL}/api/auth/gmail/callback`,
  );
}

export function getGmailAuthUrl(userId: string): string {
  return makeOAuthClient().generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
    state: Buffer.from(userId).toString('base64url'),
  });
}

export async function exchangeGmailCode(code: string, userId: string): Promise<void> {
  const oauth2 = makeOAuthClient();
  const { tokens } = await oauth2.getToken(code);
  oauth2.setCredentials(tokens);
  const gmail = google.gmail({ version: 'v1', auth: oauth2 });
  const profile = await gmail.users.getProfile({ userId: 'me' });

  await adminClient.from('connected_services').upsert(
    {
      user_id: userId,
      service: 'gmail',
      access_token: tokens.access_token ?? '',
      refresh_token: tokens.refresh_token ?? null,
      token_expires_at: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
      metadata: {
        email: profile.data.emailAddress ?? '',
        label: DEFAULT_LABEL,
        last_scanned_at: null,
      },
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,service' },
  );
}

async function getAuthenticatedClient(userId: string) {
  const { data } = await adminClient
    .from('connected_services')
    .select('access_token, refresh_token, token_expires_at, metadata')
    .eq('user_id', userId)
    .eq('service', 'gmail')
    .maybeSingle();

  if (!data?.refresh_token) return null;

  const oauth2 = makeOAuthClient();
  oauth2.setCredentials({
    access_token: data.access_token ?? undefined,
    refresh_token: data.refresh_token,
    expiry_date: data.token_expires_at ? new Date(data.token_expires_at).getTime() : undefined,
  });

  oauth2.on('tokens', async (tokens) => {
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (tokens.access_token) patch.access_token = tokens.access_token;
    if (tokens.expiry_date) patch.token_expires_at = new Date(tokens.expiry_date).toISOString();
    await adminClient.from('connected_services').update(patch).eq('user_id', userId).eq('service', 'gmail');
  });

  return { oauth2, metadata: (data.metadata ?? {}) as Record<string, unknown> };
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function extractBody(parts: unknown[]): { plain: string; html: string } {
  let plain = '';
  let html = '';
  for (const part of parts) {
    const p = part as Record<string, unknown>;
    const body = p.body as Record<string, unknown> | undefined;
    if (p.mimeType === 'text/plain' && body?.data) {
      plain += Buffer.from(body.data as string, 'base64').toString('utf-8');
    } else if (p.mimeType === 'text/html' && body?.data) {
      html += Buffer.from(body.data as string, 'base64').toString('utf-8');
    } else if (p.parts) {
      const n = extractBody(p.parts as unknown[]);
      plain += n.plain; html += n.html;
    }
  }
  return { plain, html };
}

export async function scanGmailLabel(
  userId: string,
  opts: { newerThanDays?: number; max?: number } = {},
): Promise<{ captured: number; skipped: number; label: string } | { error: string }> {
  const client = await getAuthenticatedClient(userId);
  if (!client) return { error: 'not_connected' };

  const label = (client.metadata.label as string | undefined) ?? DEFAULT_LABEL;
  const newer = opts.newerThanDays ?? 30;
  const max = opts.max ?? 25;
  const gmail = google.gmail({ version: 'v1', auth: client.oauth2 });

  let list;
  try {
    list = await gmail.users.messages.list({
      userId: 'me',
      q: `label:${label} newer_than:${newer}d`,
      maxResults: max,
    });
  } catch (err) {
    return { error: `gmail_list_failed: ${String(err)}` };
  }

  let captured = 0;
  let skipped = 0;

  for (const msg of list.data.messages ?? []) {
    if (!msg.id) continue;
    const { data: existing } = await adminClient
      .from('email_items')
      .select('id')
      .eq('user_id', userId)
      .eq('gmail_message_id', msg.id)
      .maybeSingle();
    if (existing) { skipped++; continue; }

    try {
      const full = await gmail.users.messages.get({ userId: 'me', id: msg.id, format: 'full' });
      const headers = full.data.payload?.headers ?? [];
      const h = (n: string) => headers.find((x) => x.name?.toLowerCase() === n)?.value ?? '';
      const received = full.data.internalDate
        ? new Date(parseInt(full.data.internalDate)).toISOString()
        : null;

      let bodyText = '';
      if (full.data.payload?.parts) {
        const { plain, html } = extractBody(full.data.payload.parts);
        bodyText = (plain.trim() || stripHtml(html)).slice(0, 4000);
      } else if (full.data.payload?.body?.data) {
        const raw = Buffer.from(full.data.payload.body.data, 'base64').toString('utf-8');
        bodyText = (full.data.payload.mimeType?.includes('html') ? stripHtml(raw) : raw).slice(0, 4000);
      }

      await adminClient.from('email_items').insert({
        user_id: userId,
        gmail_message_id: msg.id,
        gmail_thread_id: full.data.threadId ?? msg.id,
        label,
        from_addr: h('from'),
        subject: h('subject') || '(no subject)',
        snippet: full.data.snippet ?? null,
        body_text: bodyText || null,
        received_at: received,
      });
      captured++;
    } catch (err) {
      console.error('[gmail] message', msg.id, err);
    }
  }

  await adminClient
    .from('connected_services')
    .update({ metadata: { ...client.metadata, label, last_scanned_at: new Date().toISOString() } })
    .eq('user_id', userId)
    .eq('service', 'gmail');

  return { captured, skipped, label };
}

/**
 * Scan an arbitrary Gmail search query into email_items, tagged with `labelTag`
 * so consumers (travel parser, unsubscribe verifier) can filter. Shares the
 * fetch/store shape with scanGmailLabel.
 */
export async function scanGmailQuery(
  userId: string,
  q: string,
  labelTag: string,
  opts: { max?: number } = {},
): Promise<{ captured: number; skipped: number } | { error: string }> {
  const client = await getAuthenticatedClient(userId);
  if (!client) return { error: 'not_connected' };
  const gmail = google.gmail({ version: 'v1', auth: client.oauth2 });

  let list;
  try {
    list = await gmail.users.messages.list({ userId: 'me', q, maxResults: opts.max ?? 25 });
  } catch (err) {
    return { error: `gmail_list_failed: ${String(err)}` };
  }

  let captured = 0;
  let skipped = 0;
  for (const msg of list.data.messages ?? []) {
    if (!msg.id) continue;
    const { data: existing } = await adminClient
      .from('email_items').select('id').eq('user_id', userId).eq('gmail_message_id', msg.id).maybeSingle();
    if (existing) { skipped++; continue; }
    try {
      const full = await gmail.users.messages.get({ userId: 'me', id: msg.id, format: 'full' });
      const headers = full.data.payload?.headers ?? [];
      const h = (n: string) => headers.find((x) => x.name?.toLowerCase() === n)?.value ?? '';
      const received = full.data.internalDate ? new Date(parseInt(full.data.internalDate)).toISOString() : null;
      let bodyText = '';
      if (full.data.payload?.parts) {
        const { plain, html } = extractBody(full.data.payload.parts);
        bodyText = (plain.trim() || stripHtml(html)).slice(0, 6000);
      } else if (full.data.payload?.body?.data) {
        const raw = Buffer.from(full.data.payload.body.data, 'base64').toString('utf-8');
        bodyText = (full.data.payload.mimeType?.includes('html') ? stripHtml(raw) : raw).slice(0, 6000);
      }
      await adminClient.from('email_items').insert({
        user_id: userId,
        gmail_message_id: msg.id,
        gmail_thread_id: full.data.threadId ?? msg.id,
        label: labelTag,
        from_addr: h('from'),
        subject: h('subject') || '(no subject)',
        snippet: full.data.snippet ?? null,
        body_text: bodyText || null,
        received_at: received,
      });
      captured++;
    } catch (err) {
      console.error('[gmail] scanGmailQuery', msg.id, err);
    }
  }
  return { captured, skipped };
}

export async function getGmailStatus(userId: string) {
  const { data } = await adminClient
    .from('connected_services')
    .select('metadata')
    .eq('user_id', userId)
    .eq('service', 'gmail')
    .maybeSingle();
  if (!data) return { connected: false };
  const m = (data.metadata ?? {}) as Record<string, unknown>;
  return {
    connected: true,
    email: (m.email as string) ?? '',
    label: (m.label as string) ?? DEFAULT_LABEL,
    lastScannedAt: (m.last_scanned_at as string) ?? null,
  };
}
