import { adminClient } from '@/lib/supabase.server';
import { audit } from '@/lib/hub/audit';
import { embed } from '@/lib/memory/embed';
import { t1Json } from '@/lib/llm/gemini';

const TZ = process.env.TZ_DEFAULT ?? 'America/New_York';

export interface NoteHit {
  content: string;
  kind: string;
  created_at: string;
  similarity: number;
}

// ── chat intent ─────────────────────────────────────────────────────────
const CAPTURE =
  /\b(note (that|to self)|make a note|jot (this|that|it)? ?down|for the record|keep (this|that|it)? ?in mind|write (this|that|it)? ?down|note[:\-]\s|save this (note|down|as a note)|remember this[:\-])/i;

export const isNoteCapture = (t: string) => CAPTURE.test(t);

export function extractNote(t: string): string {
  return t
    .replace(
      /^.*?\b(note (that|to self)|make a note( that| of| saying| about)?|jot (this|that|it)? ?down( that)?|for the record[,:]?|keep (this|that|it)? ?in mind[,:]?|write (this|that|it)? ?down( that)?|note[:\-]|save this( note| down| as a note)?[:\-]?|remember this[:\-]?)\s*/i,
      '',
    )
    .replace(/^(that|:)\s+/i, '')
    .trim();
}

const RECALL =
  /\b(what (did|have) i (say|said|mention|note|write|tell you)\b.*\b(about|regarding|on|re)\b|when did i\b|did i ever\b|have i (mentioned|noted|told you|written|said anything)|what do i know about|remind me what i\b|what was that (thing|note|detail) about|look ?up my notes?|search my notes?|did i (write|note) (down |anything )?about|according to my notes|check my notes)\b/i;

export const isRecallQuestion = (t: string) => RECALL.test(t);

// Broader: any factual lookup ("what's the storage code", "where's the spare
// key", "when's the deadline for X"). Used only as a fallback when nothing else
// answered the turn — so a loose match is fine.
const LOOKUP_Q =
  /^(what|where|when|which|who|how (much|many|long|old))\b.*\?\s*$|^(what|where|when|which|who)('| i)?s?\s+(the|my|our|his|her|their)\b/i;

export const isLookupQuestion = (t: string) => LOOKUP_Q.test(t.trim());

// ── store / search ──────────────────────────────────────────────────────
export async function saveNote(
  userId: string,
  content: string,
  opts: { kind?: string; source?: string; meta?: Record<string, unknown> } = {},
): Promise<boolean> {
  const c = content.trim();
  if (c.length < 3) return false;
  const vec = await embed(c).catch(() => null);
  const { error } = await adminClient.from('notes').insert({
    user_id: userId,
    content: c.slice(0, 8000),
    kind: opts.kind ?? 'note',
    source: opts.source ?? 'chat',
    meta: opts.meta ?? {},
    embedding: vec,
  });
  if (!error) await audit.log('tool_call', 'calliad', null, { tool: 'note_save', chars: c.length, embedded: !!vec });
  return !error;
}

export async function searchNotes(userId: string, query: string, limit = 6): Promise<NoteHit[]> {
  const vec = await embed(query).catch(() => null);
  if (vec) {
    const { data } = await adminClient.rpc('match_notes', {
      query_embedding: vec,
      match_user_id: userId,
      match_count: limit,
    });
    if (data) return data as NoteHit[];
  }
  // no embedding (key/quota) → crude text fallback
  const terms = query.replace(/[^a-z0-9\s]/gi, ' ').split(/\s+/).filter((w) => w.length > 3).slice(0, 4);
  let q = adminClient.from('notes').select('content, kind, created_at').eq('user_id', userId);
  if (terms.length) q = q.or(terms.map((t) => `content.ilike.%${t}%`).join(','));
  const { data } = await q.order('created_at', { ascending: false }).limit(limit);
  return (data ?? []).map((r) => ({ ...(r as Omit<NoteHit, 'similarity'>), similarity: 0 }));
}

export function notesRecallBlock(rows: NoteHit[]): string {
  const kept = rows.filter((r) => r.similarity === 0 || r.similarity > 0.55);
  if (!kept.length) {
    return `## Your notes\nSemantic search found nothing that actually matches. Tell Noah you don't have a note on that — don't guess.`;
  }
  const lines = kept.map(
    (r) =>
      `- [${new Date(r.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: TZ })}] ${r.content}`,
  );
  return (
    `## Your notes (Noah's own saved notes — most relevant first)\n${lines.join('\n')}\n\n` +
    `Answer from these. If they don't fully cover the question, say what you do have and what's missing.`
  );
}

// ── page / API ──────────────────────────────────────────────────────────
export async function listNotes(userId: string, limit = 200): Promise<{ id: string; content: string; kind: string; created_at: string }[]> {
  const { data } = await adminClient
    .from('notes')
    .select('id, content, kind, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  return data ?? [];
}

export async function deleteNote(userId: string, id: string): Promise<void> {
  await adminClient.from('notes').delete().eq('user_id', userId).eq('id', id);
}

// ── auto-index a chat turn (waitUntil tail) ─────────────────────────────
const NORM = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** If the user's message states a durable fact/detail, save a concise note so
 *  "what's the storage code" works later without them saying "note that…". */
export async function maybeIndexTurn(userId: string, userText: string, assistantText: string): Promise<void> {
  const t = userText.trim();
  if (t.length < 25) return;
  if (/^\s*(yes|yeah|yep|no|nope|ok|okay|sure|thanks|thank you|nvm|never ?mind|undo|stop)\b/i.test(t)) return;
  if (/\?\s*$/.test(t) && t.length < 90) return; // a short question, not a statement

  const j = await t1Json<{ worth: boolean; note: string }>(
    'note_index',
    `In a chat with their assistant, the user said:\n"${t.slice(0, 700)}"\n` +
      (assistantText ? `Assistant replied: "${assistantText.slice(0, 250)}"\n\n` : '\n') +
      `Does the user's message state a DURABLE personal fact or detail worth remembering long-term — ` +
      `a name, number, code, address, date, login hint, preference, plan, decision, or relationship detail ` +
      `("X is at Y", "the code is Z", "we decided…", "my … is …")? ` +
      `Ignore small talk, questions, one-off requests, and anything transient. ` +
      `If yes, write it as one concise standalone note (≤200 chars, third person, keep the specifics). ` +
      `Reply JSON: {"worth": boolean, "note": "..."}`,
    { maxOutputTokens: 200 },
  );
  if (!j?.worth || !j.note?.trim()) return;
  const note = j.note.trim().slice(0, 400);

  const { data: recent } = await adminClient
    .from('notes')
    .select('content')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(40);
  if ((recent ?? []).some((r) => NORM(r.content as string) === NORM(note))) return;

  await saveNote(userId, note, { kind: 'chat', source: 'auto', meta: { from: t.slice(0, 200) } });
}
