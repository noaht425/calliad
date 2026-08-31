import { adminClient } from '@/lib/supabase.server';
import { t1Json, t1Available } from '@/lib/llm/gemini';

// profile_facts — structured, confirmable. profile.md stays human-authoritative;
// this is what Calliad learns and Noah confirms, merged into the profile slice.

const SECTIONS = ['identity', 'health', 'academics', 'work', 'languages', 'food', 'geographic', 'travel', 'people', 'recurring', 'daily rhythm', 'projects', 'interests', 'working style'];

export const isExplicitRemember = (t: string) =>
  /\b(remember that|note that|keep in mind that|for (future )?reference[,:]?|from now on,? ?i|fyi,? ?i (like|prefer|am|have|hate|use|need)|make a note that|jot down that)\b/i.test(t);

export async function saveFactFromText(userId: string, text: string): Promise<string | null> {
  if (!t1Available()) return null;
  const out = await t1Json<{ ok: boolean; section: string; key: string; value: string }>(
    'save_fact',
    `Noah is telling Calliad something to remember about him. Extract it as a structured fact.
"${text.slice(0, 500)}"
Return {"ok":true|false,"section":"one of: ${SECTIONS.join(', ')}","key":"short slug e.g. coffee_order","value":"the fact as a complete statement"}
ok=false if there's nothing concrete and durable to store.`,
    { maxOutputTokens: 120 },
  );
  if (!out?.ok || !out.key || !out.value) return null;
  const section = SECTIONS.includes(out.section) ? out.section : 'identity';

  await adminClient.from('profile_facts').upsert(
    { user_id: userId, section, key: out.key, value: out.value, source: 'chat', confirmed: true, updated_at: new Date().toISOString() },
    { onConflict: 'user_id,section,key' },
  );
  return out.value;
}

export async function listFacts(userId: string) {
  const { data } = await adminClient
    .from('profile_facts')
    .select('id, section, key, value, confirmed')
    .eq('user_id', userId)
    .order('section');
  return data ?? [];
}
