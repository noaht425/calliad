import { adminClient } from './supabase.server';
import { GoogleGenerativeAI } from '@google/generative-ai';

const genai = new GoogleGenerativeAI(process.env.GOOGLE_AI_KEY!);

export async function detectUnsubscribesFromCaptures(userId: string): Promise<{ detected: number; archived: number }> {
  // Scan all inbox captures that mention unsubscribing and haven't been checked yet
  const { data: candidates } = await adminClient
    .from('captures')
    .select('id, transcript, summary, metadata, created_at, status')
    .eq('user_id', userId)
    .eq('status', 'inbox')
    .order('created_at', { ascending: false });

  const toCheck = (candidates ?? []).filter((cap) => {
    const meta = (cap.metadata ?? {}) as Record<string, unknown>;
    if (meta.unsubscribe_checked) return false;
    const text = ((cap.summary ?? '') + ' ' + (cap.transcript ?? '')).toLowerCase();
    return text.includes('unsub');
  });

  if (!toCheck.length) return { detected: 0, archived: 0 };

  const model = genai.getGenerativeModel({ model: 'gemini-3.6-flash' });
  let detected = 0;
  let archived = 0;

  for (const cap of toCheck) {
    const text = ((cap.summary ?? '') + '\n' + (cap.transcript ?? '')).slice(0, 800);
    try {
      const result = await model.generateContent(
        `Is this text about an unsubscribe action — either the user unsubscribed from something, or a confirmation email that an unsubscribe went through? Return JSON only:\n{"is_unsubscribe": boolean, "sender_name": "Publication Name or null", "sender_domain": "domain.com or null"}\n\nText: "${text}"`
      );
      const raw = result.response.text().replace(/```json\n?|\n?```/g, '').trim();
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        const meta = (cap.metadata ?? {}) as Record<string, unknown>;
        await adminClient.from('captures').update({ metadata: { ...meta, unsubscribe_checked: true } }).eq('id', cap.id).eq('user_id', userId);
        continue;
      }
      const parsed = JSON.parse(jsonMatch[0]);

      if (parsed.is_unsubscribe && parsed.sender_name && parsed.sender_domain) {
        const domain = (parsed.sender_domain as string).toLowerCase().trim();
        const { data: existing } = await adminClient
          .from('unsubscribes')
          .select('id')
          .eq('user_id', userId)
          .eq('sender_domain', domain)
          .maybeSingle();

        if (!existing) {
          await adminClient.from('unsubscribes').insert({
            user_id: userId,
            sender_name: (parsed.sender_name as string).trim(),
            sender_domain: domain,
            unsubscribed_at: (cap.created_at as string).slice(0, 10),
          });
          detected++;
        }

        // Archive the capture — it's been logged
        await adminClient.from('captures').update({ status: 'archived' }).eq('id', cap.id).eq('user_id', userId);
        archived++;
      }
    } catch {
      // Skip this capture on error
    }

    // Mark as checked regardless of outcome
    const meta = (cap.metadata ?? {}) as Record<string, unknown>;
    await adminClient.from('captures')
      .update({ metadata: { ...meta, unsubscribe_checked: true } })
      .eq('id', cap.id)
      .eq('user_id', userId);
  }

  return { detected, archived };
}
