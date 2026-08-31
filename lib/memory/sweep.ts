import Anthropic from '@anthropic-ai/sdk';
import { adminClient } from '@/lib/supabase.server';
import { audit } from '@/lib/hub/audit';
import { anthropicCostUsd } from '@/lib/router/tiers';
import { allOpenLoops, upsertLoop } from '@/lib/memory/loops';
import { findContacts, setRelationship, relationshipFor, type Relationship } from '@/lib/integrations/icloud-contacts';

// The recent-context window is ephemeral. This reviews it and proposes durable
// items worth writing to the DB — Noah picks which stick. (Doug's "ask if
// anything needs saving" idea.)

const anthropic = new Anthropic();

export interface SweepItem {
  type: 'fact' | 'relationship' | 'loop' | 'taste';
  summary: string;
  section?: string; // fact
  key?: string;
  value?: string;
  name?: string; // relationship
  relationship?: Relationship;
  note?: string;
  title?: string; // loop / taste
  body?: string;
  kind?: string; // taste
  verdict?: string;
  why?: string;
}

export async function sweepConversation(userId: string, conversationId: string): Promise<SweepItem[]> {
  const { data: msgs } = await adminClient
    .from('messages')
    .select('role, content')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(40);
  const turns = (msgs ?? []).reverse().filter((m) => m.role === 'user' || m.role === 'assistant');
  if (turns.length < 3) return [];

  const openLoops = (await allOpenLoops(userId).catch(() => [])).map((l) => l.title).join(' | ');
  const transcript = turns.map((m) => `${m.role === 'user' ? 'Noah' : 'Calliad'}: ${m.content}`).join('\n').slice(-8000);

  const started = Date.now();
  const msg = await anthropic.messages.create({
    model: 'claude-sonnet-5',
    max_tokens: 900,
    system:
      "Review a conversation between Noah and his assistant. Pull out ONLY things worth persisting to a database that would otherwise be lost when the chat context rolls off. " +
      'Types:\n' +
      '- "fact": a stable fact/preference/situation about Noah (section = one of identity, health, academics, work, food, travel, people, projects, interests, daily rhythm; key = short slug; value = a complete sentence).\n' +
      '- "relationship": Noah stated a person is his X (name = the person, relationship = family|friend|colleague|acquaintance, note = the exact term e.g. "niece").\n' +
      '- "loop": an open thread / decision / intention to follow up on, with no hard deadline (title + optional body).\n' +
      '- "taste": a reaction to a named book/show/film/game (title, kind = book|screen|game|music, verdict = loved|liked|fine|bailed|hated, why).\n' +
      `Skip: transient chatter, questions, anything already an open loop (${openLoops || 'none'}), and anything Noah already asked to remember. ` +
      'Be conservative — only propose what a thoughtful assistant would genuinely want on file. ' +
      'Return ONLY minified JSON: {"items":[{"type":"...","summary":"one line for Noah", ...typefields}]}. Empty items array is fine.',
    messages: [{ role: 'user', content: transcript }],
  });
  await audit.modelCall({
    conversation_id: conversationId, purpose: 'sweep', tier: 'T2', model: 'claude-sonnet-5',
    input_tokens: msg.usage.input_tokens, cached_read_tokens: msg.usage.cache_read_input_tokens ?? 0,
    cache_write_tokens: msg.usage.cache_creation_input_tokens ?? 0, output_tokens: msg.usage.output_tokens,
    cost_usd: anthropicCostUsd('claude-sonnet-5', msg.usage), latency_ms: Date.now() - started,
  });

  const raw = msg.content.filter((b) => b.type === 'text').map((b) => (b as Anthropic.TextBlock).text).join('').replace(/```json\n?|\n?```/g, '').trim();
  try {
    const j = JSON.parse(raw) as { items?: SweepItem[] };
    return (j.items ?? [])
      .filter((i) => i.type)
      .map((i) => ({ ...i, summary: i.summary || deriveSummary(i) }))
      .filter((i) => i.summary)
      .slice(0, 8);
  } catch {
    return [];
  }
}

function deriveSummary(i: SweepItem): string {
  if (i.type === 'fact') return i.value ?? `${i.section}/${i.key}`;
  if (i.type === 'relationship') return `${i.name} — ${i.note || i.relationship}`;
  if (i.type === 'loop') return i.title ?? '';
  if (i.type === 'taste') return `${i.title} — ${i.verdict}`;
  return '';
}

/** Persist the picked items. Returns a short recap line. */
export async function commitSweepItems(userId: string, items: SweepItem[]): Promise<string> {
  let n = 0;
  for (const i of items) {
    try {
      if (i.type === 'fact' && i.key && i.value) {
        await adminClient.from('profile_facts').upsert(
          { user_id: userId, section: i.section || 'identity', key: i.key, value: i.value, source: 'chat', confirmed: true, updated_at: new Date().toISOString() },
          { onConflict: 'user_id,section,key' },
        );
        n++;
      } else if (i.type === 'relationship' && i.name) {
        const rel = i.relationship ?? (i.note ? relationshipFor(i.note) : null);
        const match = (await findContacts(userId, i.name))[0];
        if (match && rel) { await setRelationship(userId, match.id, rel, i.note ?? null); n++; }
        else {
          await adminClient.from('profile_facts').upsert(
            { user_id: userId, section: 'people', key: i.name.toLowerCase().replace(/\s+/g, '_'), value: `${i.name} — ${i.note || rel || 'someone Noah knows'}`, source: 'chat', confirmed: true, updated_at: new Date().toISOString() },
            { onConflict: 'user_id,section,key' },
          );
          n++;
        }
      } else if (i.type === 'loop' && i.title) {
        await upsertLoop(userId, { title: i.title.slice(0, 160), body: i.body ?? null, source: 'chat', tags: ['from-sweep'] });
        n++;
      } else if (i.type === 'taste' && i.title) {
        await adminClient.from('taste_log').insert({
          user_id: userId, title: i.title, kind: i.kind || 'other', verdict: i.verdict || 'liked', why: i.why ?? null, dated: new Date().toISOString().slice(0, 10),
        });
        n++;
      }
    } catch { /* skip a bad item */ }
  }
  await audit.log('outbound_message', 'calliad', null, { action: 'sweep_commit', saved: n, of: items.length });
  return n ? `Saved ${n}.` : `Nothing saved.`;
}

export const isSaveRequest = (t: string) =>
  /\b(save (this|that|anything|our chat|the conversation|to memory)|anything (here |from this )?worth (saving|remembering|keeping)|checkpoint (this|the (chat|conversation))|commit (this|that) to memory|persist (this|that|anything)|remember (this conversation|all of this|any of this))\b/i.test(t);
