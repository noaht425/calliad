import { adminClient } from '@/lib/supabase.server';
import { audit } from '@/lib/hub/audit';
import { t1Json } from '@/lib/llm/gemini';
import { embed } from '@/lib/memory/embed';
import { saveNote } from '@/lib/memory/notes';
import { trackCorrectionCandidate } from '@/lib/brain/behavior';

// Learning from mistakes, not just remembering them.
//  - the nightly behaviour sweep only catches *behavioural* corrections and
//    ignores factual ones ("that's wrong, tutors aren't clunky").
//  - it also runs a day late.
// This closes both: the moment a correction lands in chat, classify it —
//   factual  → a `correction` note, recalled by meaning on later turns
//   behavioural → straight into the candidate tracker (real-time, not nightly)
// and inject any past correction that bears on the current turn into the prompt.

const CORRECTION_LEAD =
  /\b(no,?\s|nope\b|actually,?\s|not quite\b|that'?s (wrong|not right|not correct|incorrect|not true|inaccurate)|you'?re wrong\b|that'?s not (right|correct|true|it)\b|isn'?t (right|correct|true)\b|(?:^|[^a-z])wrong\b|incorrect\b|you (said|told me|claimed|got .* wrong)\b|not .{1,40}\bit'?s\b|it'?s .{1,40}\bnot\b|where'?d you get\b|that'?s backwards\b|that'?s a (misconception|mischaracter))/i;

/** Cheap gate — is this message pushing back on something Calliad said? */
export function looksLikeCorrection(text: string): boolean {
  const t = text.trim();
  if (t.length < 3 || t.length > 800) return false;
  return CORRECTION_LEAD.test(t);
}

interface CorrectionClass {
  kind: 'factual' | 'behavioral' | 'none';
  // factual
  note?: string;   // "Calliad said X about T; correct: Y" — standalone, keeps specifics
  topic?: string;  // a few words, for retrieval
  // behavioral
  pattern_key?: string;
  pattern_description?: string;
  proposed_rule?: string;
}

const NORM = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Called from the chat route's waitUntil tail with the assistant turn that was
 * just corrected and Noah's correcting message. No-ops unless the message reads
 * like a correction.
 */
export async function captureCorrection(
  userId: string,
  priorAssistant: string,
  userText: string,
  conversationId: string | null,
): Promise<void> {
  if (!priorAssistant || !looksLikeCorrection(userText)) return;

  const c = await t1Json<CorrectionClass>(
    'correction_capture',
    `In a chat with their assistant "Calliad", the user is pushing back on Calliad's last message.\n\n` +
      `Calliad said:\n"${priorAssistant.slice(0, 700)}"\n\n` +
      `User replied:\n"${userText.slice(0, 500)}"\n\n` +
      `Classify:\n` +
      `- "factual": Calliad got something substantively wrong and the user set it straight — a fact, a ` +
      `number, a name, OR a domain concept: what something is for, how a category of thing works, what ` +
      `role it plays. "You called tutors non-synergistic, but a tutor's job is consistency — it fetches ` +
      `any card" is factual (a knowledge error), not opinion. If the user gives a REASON Calliad's ` +
      `characterisation is wrong, it's factual.\n` +
      `- "behavioral": the user wants Calliad to ACT differently as a standing habit (ask first, be terser, ` +
      `stop doing X).\n` +
      `- "none": a rephrase, the user fixing a detail in their OWN request ("I meant Tuesday"), a pure ` +
      `matter of taste with no right answer ("I'd rather play aggro"), or the user is simply mistaken.\n\n` +
      `Reply JSON:\n` +
      `{"kind":"factual"|"behavioral"|"none",` +
      `"note":"for factual: a standalone note naming BOTH the wrong claim and the correct fact, with the ` +
      `real names/values — e.g. 'Calliad called Diabolic Tutor clunky and non-synergistic; tutors are ` +
      `consistency pieces that fetch any card, judged on speed and opportunity cost, not theme synergy'. <=240 chars",` +
      `"topic":"for factual: 2-5 words naming the subject, for retrieval",` +
      `"pattern_key":"for behavioral: short_snake_case_slug",` +
      `"pattern_description":"for behavioral: lowercase, e.g. 'calling flexible cards clunky'",` +
      `"proposed_rule":"for behavioral: clear imperative to Calliad, <=160 chars"}`,
    { conversationId, maxOutputTokens: 300 },
  );
  if (!c || c.kind === 'none') return;

  if (c.kind === 'behavioral' && c.pattern_key && c.proposed_rule) {
    await trackCorrectionCandidate(userId, {
      pattern_key: c.pattern_key,
      pattern_description: c.pattern_description || c.pattern_key.replace(/_/g, ' '),
      proposed_rule: c.proposed_rule,
    }).catch(() => {});
    await audit.log('tool_call', 'calliad', conversationId, { tool: 'correction_capture', kind: 'behavioral', key: c.pattern_key });
    return;
  }

  if (c.kind === 'factual' && c.note?.trim()) {
    const note = c.note.trim().slice(0, 400);
    // dedupe against recent corrections
    const { data: recent } = await adminClient
      .from('notes')
      .select('content')
      .eq('user_id', userId)
      .eq('kind', 'correction')
      .order('created_at', { ascending: false })
      .limit(30);
    if ((recent ?? []).some((r) => NORM(r.content as string) === NORM(note))) return;

    await saveNote(userId, note, {
      kind: 'correction',
      source: 'auto',
      meta: { topic: c.topic ?? null, from_conversation: conversationId },
    });
    await audit.log('tool_call', 'calliad', conversationId, { tool: 'correction_capture', kind: 'factual', topic: c.topic });
  }
}

interface KindHit { content: string; similarity: number; created_at: string }

/**
 * Prompt block: past corrections whose subject bears on this turn. Injected so
 * Calliad doesn't repeat a mistake Noah already fixed — broader than the
 * "what did I say about X" notes recall, which only fires on explicit questions.
 */
export async function correctionsBlock(userId: string, text: string): Promise<string> {
  const t = text.trim();
  if (t.length < 8) return '';
  const vec = await embed(t).catch(() => null);
  if (!vec) return '';

  const { data } = await adminClient.rpc('match_notes_of_kind', {
    query_embedding: vec,
    match_user_id: userId,
    match_kind: 'correction',
    match_count: 4,
  });
  const hits = ((data ?? []) as KindHit[]).filter((h) => h.similarity >= 0.5);
  if (!hits.length) return '';

  return (
    `## You've corrected me on this before\n` +
    `Apply these — don't repeat the mistake:\n` +
    hits.map((h) => `- ${h.content}`).join('\n')
  );
}
