import { google } from 'googleapis';
import { adminClient } from './supabase.server';
import { runTripReconciliation, linkCaptureToTrip } from './trip-intelligence';

export const runtime = 'nodejs';

const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];

// Gmail's built-in Travel category covers airlines, hotels, car rental, and most
// standard travel — Google's ML does this better than any domain list. The
// Calliad label is user-curated for non-standard emails (custom operators, study
// programs, etc.) that Gmail's classifier misses.
const TRAVEL_SEARCH = 'category:travel newer_than:365d';
const CALLIAD_SEARCH = 'label:Calliad';
const TRAVEL_SEARCH_EXTENDED = 'category:travel newer_than:3y';

function makeOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://calliad.vercel.app'}/api/auth/gmail/callback`
  );
}

export function getGmailAuthUrl(userId: string): string {
  const oauth2 = makeOAuthClient();
  return oauth2.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
    state: Buffer.from(userId).toString('base64url'),
  });
}

export async function exchangeGmailCode(
  code: string,
  userId: string
): Promise<void> {
  const oauth2 = makeOAuthClient();
  const { tokens } = await oauth2.getToken(code);
  oauth2.setCredentials(tokens);

  const gmail = google.gmail({ version: 'v1', auth: oauth2 });
  const profile = await gmail.users.getProfile({ userId: 'me' });
  const email = profile.data.emailAddress ?? '';

  await adminClient.from('connected_services').upsert({
    user_id: userId,
    service: 'gmail',
    access_token: tokens.access_token ?? '',
    token_expires_at: tokens.expiry_date
      ? new Date(tokens.expiry_date).toISOString()
      : null,
    metadata: {
      refresh_token: tokens.refresh_token,
      email,
      last_scanned_at: null,
      processed_email_ids: [],
    },
  }, { onConflict: 'user_id,service' });
}

async function getAuthenticatedClient(userId: string) {
  const { data } = await adminClient
    .from('connected_services')
    .select('access_token, token_expires_at, metadata')
    .eq('user_id', userId)
    .eq('service', 'gmail')
    .single();

  if (!data?.metadata?.refresh_token) return null;

  const oauth2 = makeOAuthClient();
  oauth2.setCredentials({
    access_token: data.access_token,
    refresh_token: data.metadata.refresh_token as string,
    expiry_date: data.token_expires_at ? new Date(data.token_expires_at).getTime() : undefined,
  });

  oauth2.on('tokens', async (tokens) => {
    const patch: Record<string, unknown> = {};
    if (tokens.access_token) patch.access_token = tokens.access_token;
    if (tokens.expiry_date) patch.token_expires_at = new Date(tokens.expiry_date).toISOString();
    if (Object.keys(patch).length) {
      await adminClient.from('connected_services').update(patch)
        .eq('user_id', userId).eq('service', 'gmail');
    }
  });

  return { oauth2, metadata: data.metadata as Record<string, unknown> };
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function extractTextFromParts(parts: unknown[]): { plain: string; html: string } {
  let plain = '';
  let html = '';
  for (const part of parts) {
    const p = part as Record<string, unknown>;
    if (p.mimeType === 'text/plain' && p.body) {
      const body = p.body as Record<string, unknown>;
      if (body.data) plain += Buffer.from(body.data as string, 'base64').toString('utf-8');
    } else if (p.mimeType === 'text/html' && p.body) {
      const body = p.body as Record<string, unknown>;
      if (body.data) html += Buffer.from(body.data as string, 'base64').toString('utf-8');
    } else if (p.parts) {
      const nested = extractTextFromParts(p.parts as unknown[]);
      plain += nested.plain;
      html += nested.html;
    }
  }
  return { plain, html };
}

async function extractTravelEvents(emailText: string, subject: string, receivedDate?: string) {
  const { GoogleGenerativeAI } = await import('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_KEY!);
  const model = genAI.getGenerativeModel({ model: 'gemini-3.6-flash' });

  const dateAnchor = receivedDate
    ? `This email was received on ${receivedDate}. Use this as the authoritative year anchor — if a date in the email omits the year (e.g. "Mon, Oct 16"), use the year from this received date (${receivedDate.slice(0, 4)}) rather than guessing.`
    : `Current year: ${new Date().getFullYear()}. Use this as a fallback for any dates missing a year.`;
  const prompt = `You are parsing a travel confirmation email. Extract structured travel information.

${dateAnchor}

Subject: ${subject}

Email body:
${emailText.slice(0, 4000)}

Return JSON only, no markdown. If this is not a travel confirmation, return null.

Rules:
- If the email is a cancellation, refund, void, or "booking cancelled" notification, set is_travel: false and return an empty events array. Do not create trip records for cancelled bookings.
- If the email is a check-in reminder, boarding pass, or status update (not the original confirmation), still extract the travel events.
- Always use 4-digit years (YYYY) in all dates.
- For hotels and car rentals, always extract both check-in/pickup (start_date) AND check-out/return (end_date). Look for "Check-out", "Departure date", "Return date", or equivalent fields.
- LOCATION FORMAT — this is critical for deduplication. Always write location as EXACTLY "City, Country" (two comma-separated parts only):
  • US cities: "Chicago, USA" — never "Chicago, IL" or "Chicago, Illinois, USA"
  • Canadian cities: "Calgary, Canada" — never "Calgary, AB, Canada" or "Calgary, Alberta, Canada"
  • All other cities: "Rome, Italy" — never "Rome, Lazio, Italy" or just "Rome"
  • No state, province, airport code, or neighborhood
  • For flights: use the DESTINATION city (where the traveler will stay), not the departure city and not the airport code
  • If a hotel is booked in the same email: use the hotel's city as the location for all events in that email

Schema:
{
  "is_travel": boolean,
  "travelers": ["Full Name 1", "Full Name 2"],
  "events": [
    {
      "type": "flight" | "hotel" | "car_rental" | "restaurant" | "activity" | "cruise" | "train" | "other",
      "title": string,
      "start_date": "YYYY-MM-DD",
      "start_time": "HH:MM" | null,
      "end_date": "YYYY-MM-DD" | null,
      "end_time": "HH:MM" | null,
      "location": string,
      "confirmation_number": string | null,
      "notes": string | null
    }
  ],
  "summary": string
}

Extract traveler full names from passenger lists, guest names, or "booked for" fields. Include all named travelers.`;

  const result = await model.generateContent(prompt);
  const raw = result.response.text().replace(/```json\n?|\n?```/g, '').trim();
  try {
    return JSON.parse(raw) as {
      is_travel: boolean;
      travelers: string[];
      events: Array<{
        type: string; title: string; start_date: string; start_time: string | null;
        end_date: string | null; end_time: string | null; location: string;
        confirmation_number: string | null; notes: string | null;
      }>;
      summary: string;
    };
  } catch {
    return null;
  }
}

export async function scanGmailForTravel(userId: string): Promise<{ captured: number; skipped: number; dupes_skipped: number }> {
  const client = await getAuthenticatedClient(userId);
  if (!client) return { captured: 0, skipped: 0, dupes_skipped: 0 };

  const { oauth2, metadata } = client;
  const gmail = google.gmail({ version: 'v1', auth: oauth2 });
  const processedIds = (metadata.processed_email_ids as string[]) ?? [];

  const [travelRes, calliadRes] = await Promise.all([
    gmail.users.messages.list({ userId: 'me', q: TRAVEL_SEARCH, maxResults: 50 }),
    gmail.users.messages.list({ userId: 'me', q: CALLIAD_SEARCH, maxResults: 20 }),
  ]);

  console.log('[gmail] category:travel results:', travelRes.data.messages?.length ?? 0);
  console.log('[gmail] label:Calliad results:', calliadRes.data.messages?.length ?? 0);

  // Calliad-labeled emails always get their own slots — bypass processedIds so
  // a previously-skipped email that the user later labels still gets picked up.
  const calliadMessages = (calliadRes.data.messages ?? []).filter((m) => m.id).slice(0, 5);
  const calliadIds = new Set(calliadMessages.map((m) => m.id!));

  // Travel emails: apply normal processedIds filter; exclude any overlap with calliad
  const travelNewMessages = (travelRes.data.messages ?? [])
    .filter((m) => m.id && !processedIds.includes(m.id!) && !calliadIds.has(m.id!))
    .slice(0, 20);

  const toProcess = [...calliadMessages, ...travelNewMessages];
  console.log('[gmail] to process:', toProcess.length, '(calliad:', calliadMessages.length, 'travel:', travelNewMessages.length, ')');

  let captured = 0;
  let skippedDupes = 0;
  const newProcessedIds = [...processedIds];

  for (const msg of toProcess) {
    if (!msg.id) continue;
    try {
      const full = await gmail.users.messages.get({
        userId: 'me',
        id: msg.id,
        format: 'full',
      });

      const headers = full.data.payload?.headers ?? [];
      const subject = headers.find((h) => h.name?.toLowerCase() === 'subject')?.value ?? '(no subject)';
      const from = headers.find((h) => h.name?.toLowerCase() === 'from')?.value ?? '';
      const receivedDate = full.data.internalDate
        ? new Date(parseInt(full.data.internalDate)).toISOString().slice(0, 10)
        : undefined;

      let bodyText = '';
      if (full.data.payload?.parts) {
        const { plain, html } = extractTextFromParts(full.data.payload.parts);
        bodyText = plain.trim() || stripHtml(html);
      } else if (full.data.payload?.body?.data) {
        const raw = Buffer.from(full.data.payload.body.data, 'base64').toString('utf-8');
        const mimeType = full.data.payload.mimeType ?? '';
        bodyText = mimeType.includes('html') ? stripHtml(raw) : raw;
      }

      if (!bodyText.trim()) {
        newProcessedIds.push(msg.id);
        continue;
      }

      const parsed = await extractTravelEvents(bodyText, subject, receivedDate);

      if (!parsed?.is_travel || !parsed.events?.length) {
        // Don't add to processedIds on AI rejection — category:travel means Gmail
        // already classified this as travel, so let it be re-evaluated next scan
        // rather than permanently blocking it.
        continue;
      }

      // DB-level dedup: skip if we've already captured this Gmail message ID.
      // The processedIds array in connected_services is a fast pre-filter but
      // gets trimmed to 500 entries — this check is permanent.
      const { data: existingTravel } = await adminClient
        .from('captures')
        .select('id')
        .eq('user_id', userId)
        .filter('metadata->>gmail_message_id', 'eq', msg.id)
        .limit(1);

      if (existingTravel && existingTravel.length > 0) {
        newProcessedIds.push(msg.id);
        skippedDupes++;
        continue;
      }

      const types = [...new Set(parsed.events.map((e) => e.type))];
      const tags = ['travel', ...types];

      // Auto-archive if every event is already in the past — no inbox clutter
      const now = new Date();
      const allInPast = parsed.events.every((e) => {
        const end = e.end_date ?? e.start_date;
        return end && new Date(end) < now;
      });

      // Compute embedding so this capture is searchable via semantic search
      const captureText = `${parsed.summary ?? ''} ${subject} ${bodyText.slice(0, 1000)}`.trim();
      let emailEmbedding: number[] | null = null;
      try {
        const embedRes = await fetch(
          `https://generativelanguage.googleapis.com/v1/models/gemini-embedding-001:embedContent?key=${process.env.GOOGLE_AI_KEY}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: 'models/gemini-embedding-001',
              content: { parts: [{ text: captureText }] },
              outputDimensionality: 768,
            }),
          }
        );
        if (embedRes.ok) {
          const embedJson = await embedRes.json() as { embedding: { values: number[] } };
          emailEmbedding = embedJson.embedding.values;
        }
      } catch (embedErr) {
        console.error('[gmail] embedding failed:', embedErr);
      }

      const { data: newCapture } = await adminClient.from('captures').insert({
        user_id: userId,
        source: 'email',
        transcript: `From: ${from}\nSubject: ${subject}\n\n${bodyText.slice(0, 2000)}`,
        summary: parsed.summary,
        tags,
        status: allInPast ? 'archived' : 'inbox',
        transcription_status: 'done',
        embedding: emailEmbedding,
        metadata: { calendar_events: parsed.events, travelers: parsed.travelers ?? [], gmail_message_id: msg.id, gmail_thread_id: full.data.threadId ?? msg.id },
      }).select('id').single();

      if (newCapture?.id) {
        // Synchronous fast trip link — ensures trip_id is set before function returns
        await linkCaptureToTrip(userId, newCapture.id, parsed.events, parsed.travelers ?? []);
        // Full reconciliation (action cards, calendar compare) in background
        runTripReconciliation(userId, newCapture.id, parsed.events).catch((err) =>
          console.error('[gmail] trip reconciliation error:', err)
        );
      }

      captured++;
      newProcessedIds.push(msg.id);
    } catch (err) {
      console.error('[gmail] error processing message', msg.id, err);
      newProcessedIds.push(msg.id!);
    }
  }

  // Keep only the last 500 IDs to avoid unbounded growth
  const trimmed = newProcessedIds.slice(-500);
  await adminClient.from('connected_services')
    .update({
      metadata: {
        ...metadata,
        processed_email_ids: trimmed,
        last_scanned_at: new Date().toISOString(),
        auth_error: false,
      },
    })
    .eq('user_id', userId)
    .eq('service', 'gmail');

  return { captured, skipped: toProcess.length - captured - skippedDupes, dupes_skipped: skippedDupes };
}

// Fetch every message matching a query, following nextPageToken until exhausted.
// Cap at maxTotal to stay within Vercel's function timeout.
async function listAllMessages(
  gmail: ReturnType<typeof google.gmail>,
  query: string,
  maxTotal = 500
): Promise<{ id?: string | null }[]> {
  const all: { id?: string | null }[] = [];
  let pageToken: string | undefined;
  do {
    const res = await gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults: 100,
      ...(pageToken ? { pageToken } : {}),
    });
    all.push(...(res.data.messages ?? []));
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken && all.length < maxTotal);
  return all;
}

// Convert a days count to Gmail's native newer_than unit for reliability.
// Gmail handles y/m natively; large raw day counts (e.g. 730d) may be unreliable.
function daysToGmailUnit(days: number): string {
  if (days >= 365 && days % 365 === 0) return `${days / 365}y`;
  if (days >= 30 && days % 30 === 0) return `${days / 30}m`;
  if (days >= 365) return `${Math.round(days / 365)}y`;
  if (days >= 30) return `${Math.round(days / 30)}m`;
  return `${days}d`;
}

export async function scanGmailForTravelExtended(userId: string, days = 1095): Promise<{ captured: number; skipped: number; dupes_skipped: number; total_fetched: number; auth_error?: boolean; timedOut?: boolean }> {
  const client = await getAuthenticatedClient(userId);
  if (!client) {
    await markGmailAuthError(userId, true);
    return { captured: 0, skipped: 0, dupes_skipped: 0, total_fetched: 0, auth_error: true };
  }

  const { oauth2 } = client;
  const gmail = google.gmail({ version: 'v1', auth: oauth2 });

  const gmailWindow = daysToGmailUnit(days);
  const travelQuery = `category:travel newer_than:${gmailWindow}`;
  let travelMessages: { id?: string | null }[];
  let calliadMessages: { id?: string | null }[];
  try {
    [travelMessages, calliadMessages] = await Promise.all([
      listAllMessages(gmail, travelQuery, 2000),
      listAllMessages(gmail, CALLIAD_SEARCH, 500),
    ]);
  } catch (err) {
    console.error('[gmail-extended] failed to list messages — Gmail auth may be expired:', err);
    await markGmailAuthError(userId, true);
    return { captured: 0, skipped: 0, dupes_skipped: 0, total_fetched: 0, auth_error: true };
  }

  const seen = new Set<string>();
  // Reverse to oldest-first so repeated runs progressively advance back in time.
  // Dupe-check ensures already-captured emails are skipped cheaply.
  const allMessages = [...travelMessages, ...calliadMessages]
    .filter((m) => m.id && !seen.has(m.id) && seen.add(m.id!))
    .reverse();

  let captured = 0;
  let skippedDupes = 0;
  let timedOut = false;
  const startTime = Date.now();

  for (const msg of allMessages) {
    if (!msg.id) continue;
    if (Date.now() - startTime > 270_000) { timedOut = true; break; }
    try {
      const { data: existing } = await adminClient
        .from('captures')
        .select('id')
        .eq('user_id', userId)
        .filter('metadata->>gmail_message_id', 'eq', msg.id)
        .limit(1);

      if (existing && existing.length > 0) { skippedDupes++; continue; }

      const full = await gmail.users.messages.get({ userId: 'me', id: msg.id, format: 'full' });
      const headers = full.data.payload?.headers ?? [];
      const subject = headers.find((h) => h.name?.toLowerCase() === 'subject')?.value ?? '(no subject)';
      const from = headers.find((h) => h.name?.toLowerCase() === 'from')?.value ?? '';
      const receivedDate = full.data.internalDate
        ? new Date(parseInt(full.data.internalDate)).toISOString().slice(0, 10)
        : undefined;

      let bodyText = '';
      if (full.data.payload?.parts) {
        const { plain, html } = extractTextFromParts(full.data.payload.parts);
        bodyText = plain.trim() || stripHtml(html);
      } else if (full.data.payload?.body?.data) {
        const raw = Buffer.from(full.data.payload.body.data, 'base64').toString('utf-8');
        const mimeType = full.data.payload.mimeType ?? '';
        bodyText = mimeType.includes('html') ? stripHtml(raw) : raw;
      }

      if (!bodyText.trim()) continue;

      const parsed = await extractTravelEvents(bodyText, subject, receivedDate);
      if (!parsed?.is_travel || !parsed.events?.length) continue;

      const types = [...new Set(parsed.events.map((e) => e.type))];
      const tags = ['travel', ...types];

      const now = new Date();
      const allInPast = parsed.events.every((e) => {
        const end = e.end_date ?? e.start_date;
        return end && new Date(end) < now;
      });

      // Skip embedding in bulk scan — saves ~2-3s per email so we can process more
      // emails before Vercel's 300s limit. Embeddings can be backfilled separately.
      const { data: newCapture } = await adminClient.from('captures').insert({
        user_id: userId,
        source: 'email',
        transcript: `From: ${from}\nSubject: ${subject}\n\n${bodyText.slice(0, 2000)}`,
        summary: parsed.summary,
        tags,
        status: allInPast ? 'archived' : 'inbox',
        transcription_status: 'done',
        metadata: { calendar_events: parsed.events, travelers: parsed.travelers ?? [], gmail_message_id: msg.id, gmail_thread_id: full.data.threadId ?? msg.id },
      }).select('id').single();

      if (newCapture?.id) {
        // Await fast DB-only trip link so every capture gets a trip_id before
        // the Vercel function returns. Full reconciliation (action cards, calendar
        // comparison) runs via the regular incremental scan or on-demand.
        await linkCaptureToTrip(userId, newCapture.id, parsed.events, parsed.travelers ?? []);
      }
      captured++;
    } catch (err) {
      console.error('[gmail-extended] error processing message', msg.id, err);
    }
  }

  // Reconcile any captures that were created in a previous scan run but whose
  // trip link was never completed (fire-and-forget killed by function timeout).
  const { data: orphans } = await adminClient
    .from('captures')
    .select('id, metadata')
    .eq('user_id', userId)
    .eq('source', 'email')
    .eq('transcription_status', 'done')
    .is('trip_id', null)
    .limit(50);

  for (const orphan of orphans ?? []) {
    const meta = (orphan.metadata as Record<string, unknown>) ?? {};
    const events = (meta.calendar_events as Array<{ type: string; title: string; start_date: string; start_time: string | null; end_date: string | null; end_time: string | null; location: string; confirmation_number: string | null; notes: string | null }> | undefined) ?? [];
    const travelers = (meta.travelers as string[] | undefined) ?? [];
    if (events.length) {
      await linkCaptureToTrip(userId, orphan.id, events, travelers).catch(() => {});
    }
  }

  if (!timedOut) await markGmailAuthError(userId, false);
  // Don't update processed_email_ids for extended scan — the regular scan manages that list
  return { captured, skipped: allMessages.length - captured - skippedDupes, dupes_skipped: skippedDupes, total_fetched: allMessages.length, timedOut };
}

// ─── SENT EMAIL SCANNER ──────────────────────────────────────────────────────

const SENT_SEARCH = 'in:sent newer_than:180d';

interface SentEmailInsight {
  capture_worthy: boolean;
  summary: string;
  awaiting_reply: boolean;
  follow_up_days: number;
  tags: string[];
  commitments: Array<{ text: string; due_date: string | null; person: string | null }>;
  project_tag: string | null;
  project_signal?: {
    detected: boolean;
    company: string | null;
    topic: string | null;
    phase: 'inquiry' | 'quote' | 'proposal' | 'agreement' | 'payment' | 'completion' | null;
  };
}

async function extractSentEmailInsights(
  emailText: string,
  subject: string,
  toAddresses: string[],
  sentDate: string,
  knownProjectTags: { tag: string; name: string }[] = [],
): Promise<SentEmailInsight | null> {
  const { GoogleGenerativeAI } = await import('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_KEY!);
  const model = genAI.getGenerativeModel({ model: 'gemini-3.6-flash' });

  const projectTagsSection = knownProjectTags.length > 0
    ? `\nKnown user projects (if this email relates to one, set project_tag to its tag, otherwise null):\n${knownProjectTags.map((p) => `- ${p.tag}: ${p.name}`).join('\n')}\n`
    : '';

  const prompt = `You are analyzing an email I SENT — written by me, not received by me.

Subject: ${subject}
To: ${toAddresses.join(', ')}
Sent: ${sentDate}
${projectTagsSection}
Email body:
${emailText.slice(0, 3000)}

Determine if this sent email is worth tracking as an action item or open loop.

Return JSON only, no markdown:
{
  "capture_worthy": boolean,
  "summary": "One sentence: what I sent and why it matters to track",
  "awaiting_reply": boolean,
  "follow_up_days": 3,
  "tags": ["home", "finance", "work", "legal", "medical", "renovation", etc.],
  "project_tag": null,
  "commitments": [
    {"text": "exact commitment I made", "due_date": "YYYY-MM-DD or null", "person": "their name or null"}
  ],
  "project_signal": {
    "detected": false,
    "company": null,
    "topic": null,
    "phase": null
  }
}

capture_worthy=TRUE when the email involves:
- A commitment I made ("I'll send X", "I'll call them", "let me get back to you")
- An ongoing project (renovation, purchase, subscription, legal matter, job application)
- A request for a decision or information where I'm waiting for a reply
- Money, invoices, contracts, or important logistics
- Something I sent where I need confirmation of receipt or action

capture_worthy=FALSE for:
- "Thanks!", "Sounds good", "See you then", "On my way"
- Simple confirmations where nothing else needs to happen
- Social pleasantries with no follow-up needed
- Short FYI replies where I don't need anything back

awaiting_reply=true only if I need a response from them to move forward.
follow_up_days: 1 if urgent/time-sensitive, 3 for normal business, 7 for low-priority or social.
commitments: only explicit commitments I made — not vague pleasantries.

project_signal.detected=true when this email is part of a multi-step project with a company or contractor:
- Home improvement (roofing, landscaping, flooring, remodeling, HVAC, electrical, plumbing)
- Legal matter (attorney, title company, HOA, permit)
- Purchase project (appliance, vehicle, significant purchase with installation or follow-up)
- Medical procedure with ongoing coordination
company: the contractor or company name (e.g. "Redmond Roofing", "New Leaf Creations")
topic: a short description of the project (e.g. "roof replacement", "landscaping", "hardwood floors")
phase: one of "inquiry", "quote", "proposal", "agreement", "payment", "completion" — whichever best describes this email's role in the project`;

  const result = await model.generateContent(prompt);
  const raw = result.response.text().replace(/```json\n?|\n?```/g, '').trim();
  try {
    return JSON.parse(raw) as SentEmailInsight;
  } catch {
    return null;
  }
}

export async function scanGmailSent(userId: string): Promise<{ captured: number; skipped: number; dupes_skipped: number }> {
  const client = await getAuthenticatedClient(userId);
  if (!client) return { captured: 0, skipped: 0, dupes_skipped: 0 };

  const { oauth2, metadata } = client;
  const gmail = google.gmail({ version: 'v1', auth: oauth2 });
  const processedSentIds = (metadata.processed_sent_ids as string[] | undefined) ?? [];
  const userEmail = (metadata.email as string | undefined) ?? '';

  const res = await gmail.users.messages.list({ userId: 'me', q: SENT_SEARCH, maxResults: 30 });
  const newMessages = (res.data.messages ?? [])
    .filter((m) => m.id && !processedSentIds.includes(m.id!))
    .slice(0, 20);

  const { data: taggedProjects } = await adminClient
    .from('projects')
    .select('id, folder_id, project_tag, title')
    .eq('user_id', userId)
    .not('project_tag', 'is', null);
  const knownProjectTags = (taggedProjects ?? []).map((p) => ({ tag: p.project_tag as string, name: p.title as string }));

  let captured = 0;
  let skippedDupes = 0;
  const newProcessedIds = [...processedSentIds];

  for (const msg of newMessages) {
    if (!msg.id) continue;
    try {
      const { data: existingCapture } = await adminClient
        .from('captures')
        .select('id')
        .eq('user_id', userId)
        .filter('metadata->>gmail_message_id', 'eq', msg.id)
        .limit(1);

      if (existingCapture && existingCapture.length > 0) {
        newProcessedIds.push(msg.id);
        skippedDupes++;
        continue;
      }

      const full = await gmail.users.messages.get({ userId: 'me', id: msg.id, format: 'full' });
      const headers = full.data.payload?.headers ?? [];
      const subject = headers.find((h) => h.name?.toLowerCase() === 'subject')?.value ?? '(no subject)';
      const to = headers.find((h) => h.name?.toLowerCase() === 'to')?.value ?? '';
      const toAddresses = to.split(/[,;]/).map((a) => a.trim()).filter(Boolean);
      const sentDate = full.data.internalDate
        ? new Date(parseInt(full.data.internalDate)).toISOString().slice(0, 10)
        : new Date().toISOString().slice(0, 10);

      let bodyText = '';
      if (full.data.payload?.parts) {
        const { plain, html } = extractTextFromParts(full.data.payload.parts);
        bodyText = plain.trim() || stripHtml(html);
      } else if (full.data.payload?.body?.data) {
        const raw = Buffer.from(full.data.payload.body.data, 'base64').toString('utf-8');
        const mimeType = full.data.payload.mimeType ?? '';
        bodyText = mimeType.includes('html') ? stripHtml(raw) : raw;
      }

      if (!bodyText.trim()) {
        newProcessedIds.push(msg.id);
        continue;
      }

      const parsed = await extractSentEmailInsights(bodyText, subject, toAddresses, sentDate, knownProjectTags);

      if (!parsed?.capture_worthy) {
        newProcessedIds.push(msg.id);
        continue;
      }

      const followUpAt = parsed.awaiting_reply
        ? new Date(new Date(sentDate).getTime() + parsed.follow_up_days * 86400000).toISOString().slice(0, 10)
        : null;

      const tags = ['sent', ...parsed.tags];
      if (parsed.commitments.length) tags.push('commitment');
      if (parsed.awaiting_reply) tags.push('follow-up');

      // If Gemini matched a known project tag, file directly to that project
      const matchedProject = parsed.project_tag
        ? (taggedProjects ?? []).find((p) => p.project_tag === parsed.project_tag)
        : null;

      const status = matchedProject ? 'folder' : (parsed.awaiting_reply || parsed.commitments.length > 0 ? 'inbox' : 'archived');

      await adminClient.from('captures').insert({
        user_id: userId,
        source: 'sent_email',
        transcript: `To: ${to}\nSubject: ${subject}\n\n${bodyText.slice(0, 2000)}`,
        summary: parsed.summary,
        tags,
        status,
        ...(matchedProject ? { project_id: matchedProject.id, folder_id: matchedProject.folder_id ?? null } : {}),
        transcription_status: 'done',
        metadata: {
          gmail_message_id: msg.id,
          gmail_thread_id: full.data.threadId ?? msg.id,
          subject,
          to_addresses: toAddresses,
          sent_date: sentDate,
          awaiting_reply: parsed.awaiting_reply,
          follow_up_at: followUpAt,
          follow_up_checked: false,
          commitments: parsed.commitments,
          user_email: userEmail,
        },
      });

      captured++;
      newProcessedIds.push(msg.id);
    } catch (err) {
      console.error('[gmail-sent] error processing message', msg.id, err);
      newProcessedIds.push(msg.id!);
    }
  }

  const trimmed = newProcessedIds.slice(-500);
  await adminClient.from('connected_services')
    .update({ metadata: { ...metadata, processed_sent_ids: trimmed, auth_error: false } })
    .eq('user_id', userId)
    .eq('service', 'gmail');

  return { captured, skipped: newMessages.length - captured - skippedDupes, dupes_skipped: skippedDupes };
}

export async function checkFollowUps(userId: string): Promise<{ checked: number; cards_created: number }> {
  const client = await getAuthenticatedClient(userId);
  if (!client) return { checked: 0, cards_created: 0 };

  const { oauth2 } = client;
  const gmail = google.gmail({ version: 'v1', auth: oauth2 });

  const now = new Date();

  // Fetch pending follow-up captures and filter client-side (avoids JSONB operator uncertainty)
  const { data: sentCaptures } = await adminClient
    .from('captures')
    .select('id, metadata')
    .eq('user_id', userId)
    .eq('source', 'sent_email')
    .eq('status', 'inbox')
    .limit(30);

  const overdue = (sentCaptures ?? []).filter((cap) => {
    const meta = cap.metadata as Record<string, unknown>;
    if (!meta.awaiting_reply) return false;
    if (meta.follow_up_checked) return false;
    const followUpAt = meta.follow_up_at as string | undefined;
    return followUpAt ? new Date(followUpAt) <= now : false;
  });

  let checked = 0;
  let cardsCreated = 0;

  for (const cap of overdue) {
    const meta = cap.metadata as Record<string, unknown>;
    const threadId = meta.gmail_thread_id as string | undefined;
    const userEmail = meta.user_email as string | undefined;
    const subject = meta.subject as string | undefined;
    const toAddresses = (meta.to_addresses as string[] | undefined) ?? [];
    const sentDate = meta.sent_date as string | undefined;

    if (!threadId) continue;

    try {
      const thread = await gmail.users.threads.get({ userId: 'me', id: threadId });
      const messages = thread.data.messages ?? [];

      // A reply exists if any message in the thread is from someone other than the user
      const gotReply = messages.some((m) => {
        const fromHeader = m.payload?.headers?.find((h) => h.name?.toLowerCase() === 'from')?.value ?? '';
        return userEmail ? !fromHeader.toLowerCase().includes(userEmail.toLowerCase()) : false;
      });

      await adminClient.from('captures')
        .update({ metadata: { ...meta, follow_up_checked: true, got_reply: gotReply } })
        .eq('id', cap.id);

      if (!gotReply) {
        const anomalyId = `follow_up:${cap.id}`;
        const { count } = await adminClient
          .from('captures')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', userId)
          .eq('source', 'action')
          .in('status', ['inbox', 'archived'])
          .contains('metadata', { anomaly_id: anomalyId });

        if ((count ?? 0) === 0) {
          const daysAgo = sentDate
            ? Math.round((Date.now() - new Date(sentDate).getTime()) / 86400000)
            : (meta.follow_up_days as number | undefined) ?? 3;
          // Pull the display name from the first address ("Doug Turner <doug@x>" → "Doug Turner")
          const toName = toAddresses[0]?.match(/^"?([^"<]+)"?\s*<?/)?.[1]?.trim() ?? toAddresses[0] ?? 'them';

          await adminClient.from('captures').insert({
            user_id: userId,
            source: 'action',
            transcript: `You sent "${subject}" to ${toName} ${daysAgo} day${daysAgo !== 1 ? 's' : ''} ago and haven't heard back. Want me to draft a follow-up message?`,
            summary: `Follow up with ${toName} re: ${subject}`,
            tags: ['follow-up', 'sent'],
            status: 'inbox',
            transcription_status: 'done',
            metadata: {
              action_type: 'follow_up',
              anomaly_id: anomalyId,
              source_capture_id: cap.id,
              subject,
              to_addresses: toAddresses,
              to_name: toName,
              sent_date: sentDate,
            },
          });
          cardsCreated++;
        }
      }
      checked++;
    } catch (err) {
      console.error('[gmail-followups] error checking thread', threadId, err);
    }
  }

  return { checked, cards_created: cardsCreated };
}

export async function scanGmailSentExtended(userId: string, days = 365): Promise<{ captured: number; skipped: number; dupes_skipped: number; total_fetched: number; auth_error?: boolean; timedOut?: boolean }> {
  const client = await getAuthenticatedClient(userId);
  if (!client) return { captured: 0, skipped: 0, dupes_skipped: 0, total_fetched: 0, auth_error: true };

  const { oauth2 } = client;
  const gmail = google.gmail({ version: 'v1', auth: oauth2 });

  const gmailWindow = daysToGmailUnit(days);
  let messages: { id?: string | null }[];
  try {
    messages = await listAllMessages(gmail, `in:sent newer_than:${gmailWindow}`, 2000);
  } catch (err) {
    console.error('[gmail-sent-extended] failed to list messages — Gmail auth may be expired:', err);
    return { captured: 0, skipped: 0, dupes_skipped: 0, total_fetched: 0, auth_error: true };
  }
  // Clean up any duplicate sent_email captures from previous runs with the broken dedup check.
  // Keeps the oldest capture for each gmail_message_id; safe to run every time.
  const { data: allSentCaptures } = await adminClient
    .from('captures')
    .select('id, metadata, created_at')
    .eq('user_id', userId)
    .eq('source', 'sent_email')
    .order('created_at', { ascending: true });
  if (allSentCaptures && allSentCaptures.length > 0) {
    const seen = new Map<string, boolean>();
    const toDelete: string[] = [];
    for (const cap of allSentCaptures) {
      const gmailId = ((cap.metadata as Record<string, unknown>)?.gmail_message_id as string | undefined);
      if (!gmailId) continue;
      if (seen.has(gmailId)) {
        toDelete.push(cap.id);
      } else {
        seen.set(gmailId, true);
      }
    }
    if (toDelete.length > 0) {
      console.log(`[gmail-sent-extended] removing ${toDelete.length} duplicate captures`);
      await adminClient.from('captures').delete().in('id', toDelete);
    }
  }

  // Oldest-first so repeated runs progressively fill in history
  const ordered = [...messages].reverse();

  const { data: taggedProjectsExt } = await adminClient
    .from('projects')
    .select('id, folder_id, project_tag, title')
    .eq('user_id', userId)
    .not('project_tag', 'is', null);
  const knownProjectTagsExt = (taggedProjectsExt ?? []).map((p) => ({ tag: p.project_tag as string, name: p.title as string }));

  let captured = 0;
  let skippedDupes = 0;
  let timedOut = false;
  const startTime = Date.now();

  for (const msg of ordered) {
    if (!msg.id) continue;
    if (Date.now() - startTime > 270_000) { timedOut = true; break; }
    try {
      const { data: existing } = await adminClient
        .from('captures')
        .select('id')
        .eq('user_id', userId)
        .filter('metadata->>gmail_message_id', 'eq', msg.id)
        .limit(1);

      if (existing && existing.length > 0) { skippedDupes++; continue; }

      const full = await gmail.users.messages.get({ userId: 'me', id: msg.id, format: 'full' });
      const headers = full.data.payload?.headers ?? [];
      const subject = headers.find((h) => h.name?.toLowerCase() === 'subject')?.value ?? '(no subject)';
      const to = headers.find((h) => h.name?.toLowerCase() === 'to')?.value ?? '';
      const toAddresses = to.split(/[,;]/).map((a) => a.trim()).filter(Boolean);
      const sentDate = full.data.internalDate
        ? new Date(parseInt(full.data.internalDate)).toISOString().slice(0, 10)
        : new Date().toISOString().slice(0, 10);

      let bodyText = '';
      if (full.data.payload?.parts) {
        const { plain, html } = extractTextFromParts(full.data.payload.parts);
        bodyText = plain.trim() || stripHtml(html);
      } else if (full.data.payload?.body?.data) {
        const raw = Buffer.from(full.data.payload.body.data, 'base64').toString('utf-8');
        const mimeType = full.data.payload.mimeType ?? '';
        bodyText = mimeType.includes('html') ? stripHtml(raw) : raw;
      }

      if (!bodyText.trim()) continue;

      const parsed = await extractSentEmailInsights(bodyText, subject, toAddresses, sentDate, knownProjectTagsExt);
      if (!parsed?.capture_worthy) {
        console.log(`[gmail-sent-extended] skip not-worthy: "${subject}" → ${JSON.stringify({ awaiting_reply: parsed?.awaiting_reply, commitments: parsed?.commitments?.length })}`);
        continue;
      }

      const followUpAt = parsed.awaiting_reply
        ? new Date(new Date(sentDate).getTime() + parsed.follow_up_days * 86400000).toISOString().slice(0, 10)
        : null;

      const tags = ['sent', ...parsed.tags];
      if (parsed.commitments.length) tags.push('commitment');
      if (parsed.awaiting_reply) tags.push('follow-up');

      const matchedProjectExt = parsed.project_tag
        ? (taggedProjectsExt ?? []).find((p) => p.project_tag === parsed.project_tag)
        : null;

      const statusExt = matchedProjectExt ? 'folder' : (parsed.awaiting_reply || parsed.commitments.length > 0 ? 'inbox' : 'archived');

      console.log(`[gmail-sent-extended] capturing: "${subject}" → status=${statusExt} project_tag=${parsed.project_tag ?? 'none'}`);

      await adminClient.from('captures').insert({
        user_id: userId,
        source: 'sent_email',
        transcript: `To: ${to}\nSubject: ${subject}\n\n${bodyText.slice(0, 2000)}`,
        summary: parsed.summary,
        tags,
        status: statusExt,
        ...(matchedProjectExt ? { project_id: matchedProjectExt.id, folder_id: matchedProjectExt.folder_id ?? null } : {}),
        transcription_status: 'done',
        metadata: {
          gmail_message_id: msg.id,
          gmail_thread_id: full.data.threadId ?? msg.id,
          subject,
          to_addresses: toAddresses,
          sent_date: sentDate,
          awaiting_reply: parsed.awaiting_reply,
          follow_up_at: followUpAt,
          follow_up_checked: false,
          commitments: parsed.commitments,
          ...(parsed.project_signal?.detected ? { project_signal: parsed.project_signal } : {}),
        },
      });
      captured++;
    } catch (err) {
      console.error('[gmail-sent-extended] error processing message', msg.id, err);
    }
  }

  console.log(`[gmail-sent-extended] done: total=${ordered.length} captured=${captured} dupes_skipped=${skippedDupes} timedOut=${timedOut}`);
  await detectAndCreateProjectSuggestions(userId);
  return { captured, skipped: ordered.length - captured - skippedDupes, dupes_skipped: skippedDupes, total_fetched: ordered.length, timedOut };
}

const COMMON_EMAIL_PROVIDERS = new Set([
  'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com',
  'me.com', 'aol.com', 'comcast.net', 'live.com', 'msn.com', 'att.net', 'verizon.net',
]);

function extractDomainCompany(email: string): string | null {
  const m = email.match(/@([\w.-]+)/);
  if (!m) return null;
  const domain = m[1].toLowerCase();
  if (COMMON_EMAIL_PROVIDERS.has(domain)) return null;
  const name = domain.split('.')[0];
  return name.charAt(0).toUpperCase() + name.slice(1);
}

async function detectAndCreateProjectSuggestions(userId: string): Promise<void> {
  const { data: caps } = await adminClient
    .from('captures')
    .select('id, metadata, tags')
    .eq('user_id', userId)
    .eq('source', 'sent_email');

  if (!caps?.length) return;

  // Cluster by Gemini-detected project_signal (future captures) or by email domain (existing captures)
  const clusters = new Map<string, { company: string; topic: string | null; ids: string[] }>();

  for (const cap of caps) {
    const meta = (cap.metadata ?? {}) as Record<string, unknown>;
    const ps = meta.project_signal as { detected?: boolean; company?: string | null; topic?: string | null } | undefined;

    if (ps?.detected && ps.company) {
      const key = `signal:${ps.company.toLowerCase().replace(/\s+/g, '-')}`;
      if (!clusters.has(key)) clusters.set(key, { company: ps.company, topic: ps.topic ?? null, ids: [] });
      clusters.get(key)!.ids.push(cap.id);
    } else {
      const toAddresses = (meta.to_addresses as string[] | undefined) ?? [];
      for (const addr of toAddresses) {
        const company = extractDomainCompany(addr);
        if (!company) continue;
        const domain = addr.match(/@([\w.-]+)/)?.[1] ?? '';
        const key = `domain:${domain}`;
        if (!clusters.has(key)) clusters.set(key, { company, topic: null, ids: [] });
        clusters.get(key)!.ids.push(cap.id);
        break;
      }
    }
  }

  for (const [key, cluster] of clusters) {
    if (cluster.ids.length < 3) continue;

    const { data: existing } = await adminClient
      .from('captures')
      .select('id')
      .eq('user_id', userId)
      .eq('source', 'action')
      .filter('metadata->>action_type', 'eq', 'project_suggestion')
      .filter('metadata->>cluster_key', 'eq', key)
      .limit(1);

    if (existing?.length) continue;

    const topicPart = cluster.topic ? ` about ${cluster.topic}` : '';
    const message = `I noticed ${cluster.ids.length} emails with ${cluster.company}${topicPart}. Looks like a project — want me to create a folder to track it?`;

    await adminClient.from('captures').insert({
      user_id: userId,
      source: 'action',
      transcript: message,
      summary: `Potential project: ${cluster.company}${cluster.topic ? ` — ${cluster.topic}` : ''}`,
      tags: ['project-suggestion'],
      status: 'inbox',
      transcription_status: 'done',
      metadata: {
        action_type: 'project_suggestion',
        cluster_key: key,
        company: cluster.company,
        topic: cluster.topic,
        capture_ids: cluster.ids,
        email_count: cluster.ids.length,
      },
    });

    console.log(`[project-detect] suggestion created for "${cluster.company}" (${cluster.ids.length} emails)`);
  }
}

async function markGmailAuthError(userId: string, hasError: boolean) {
  const { data } = await adminClient
    .from('connected_services')
    .select('metadata')
    .eq('user_id', userId)
    .eq('service', 'gmail')
    .single();
  if (!data) return;
  const m = (data.metadata as Record<string, unknown>) ?? {};
  await adminClient.from('connected_services')
    .update({ metadata: { ...m, auth_error: hasError } })
    .eq('user_id', userId)
    .eq('service', 'gmail');
}

export async function checkUnsubscribeMonitoring(userId: string): Promise<{ checked: number; newly_failed: number }> {
  const client = await getAuthenticatedClient(userId);
  if (!client) return { checked: 0, newly_failed: 0 };

  const { oauth2 } = client;
  const gmail = google.gmail({ version: 'v1', auth: oauth2 });

  // Only check entries that haven't already failed
  const { data: unsubscribes } = await adminClient
    .from('unsubscribes')
    .select('id, sender_domain, unsubscribed_at')
    .eq('user_id', userId)
    .is('last_marketing_email_at', null);

  let checked = 0;
  let newly_failed = 0;

  for (const unsub of unsubscribes ?? []) {
    try {
      const afterDate = (unsub.unsubscribed_at as string).replace(/-/g, '/');
      // Check promotions then updates — either counts as a marketing email
      for (const category of ['category:promotions', 'category:updates']) {
        const q = `from:${unsub.sender_domain} after:${afterDate} ${category}`;
        const res = await gmail.users.messages.list({ userId: 'me', q, maxResults: 1 });
        if (res.data.messages?.length) {
          const msg = await gmail.users.messages.get({
            userId: 'me', id: res.data.messages[0].id!, format: 'minimal',
          });
          const receivedAt = msg.data.internalDate
            ? new Date(parseInt(msg.data.internalDate)).toISOString()
            : new Date().toISOString();
          await adminClient.from('unsubscribes')
            .update({ last_marketing_email_at: receivedAt })
            .eq('id', unsub.id);
          newly_failed++;
          break;
        }
      }
      checked++;
    } catch (err) {
      console.error('[unsubscribe-monitor] error checking', unsub.sender_domain, err);
    }
  }

  return { checked, newly_failed };
}

export async function getGmailStatus(userId: string) {
  const { data } = await adminClient
    .from('connected_services')
    .select('metadata, token_expires_at')
    .eq('user_id', userId)
    .eq('service', 'gmail')
    .single();

  if (!data) return { connected: false };
  const m = data.metadata as Record<string, unknown> ?? {};
  return {
    connected: true,
    email: m.email as string ?? '',
    lastScannedAt: m.last_scanned_at as string ?? null,
    authError: (m.auth_error as boolean | undefined) ?? false,
  };
}
