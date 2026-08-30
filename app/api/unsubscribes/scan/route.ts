import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { adminClient } from '@/lib/supabase.server';
import { GoogleGenerativeAI } from '@google/generative-ai';

export const runtime = 'nodejs';
export const maxDuration = 60;

const genai = new GoogleGenerativeAI(process.env.GOOGLE_AI_KEY!);

export async function POST(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Fetch all inbox captures (no limit — this is a one-time catchup scan)
  const { data: all } = await adminClient
    .from('captures')
    .select('id, transcript, summary, metadata, created_at, source')
    .eq('user_id', user.id)
    .eq('status', 'inbox')
    .order('created_at', { ascending: false });

  // Filter to those containing unsubscribe signals
  const candidates = (all ?? []).filter((cap) => {
    const meta = (cap.metadata ?? {}) as Record<string, unknown>;
    if (meta.unsubscribe_checked) return false;
    const text = ((cap.summary ?? '') + ' ' + (cap.transcript ?? '')).toLowerCase();
    return text.includes('unsub');
  });

  if (!candidates.length) {
    return NextResponse.json({ scanned: 0, detected: 0, archived: 0 });
  }

  const model = genai.getGenerativeModel({ model: 'gemini-2.5-flash-lite' });
  let detected = 0;
  let archived = 0;

  for (const cap of candidates) {
    const text = ((cap.summary ?? '') + '\n' + (cap.transcript ?? '')).slice(0, 800);
    try {
      const result = await model.generateContent(
        `Is this text about an unsubscribe action — either the user unsubscribed from something, or a confirmation that an unsubscribe went through? Return JSON only:\n{"is_unsubscribe": boolean, "sender_name": "Publication Name or null", "sender_domain": "domain.com or null"}\n\nText: "${text}"`
      );
      const raw = result.response.text();
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) continue;
      const parsed = JSON.parse(jsonMatch[0]);

      if (parsed.is_unsubscribe && parsed.sender_name && parsed.sender_domain) {
        const domain = (parsed.sender_domain as string).toLowerCase().trim();

        // Add to unsubscribes if not already tracked
        const { data: existing } = await adminClient
          .from('unsubscribes')
          .select('id')
          .eq('user_id', user.id)
          .eq('sender_domain', domain)
          .maybeSingle();

        if (!existing) {
          await adminClient.from('unsubscribes').insert({
            user_id: user.id,
            sender_name: (parsed.sender_name as string).trim(),
            sender_domain: domain,
            unsubscribed_at: (cap.created_at as string).slice(0, 10),
          });
          detected++;
        }

        // Archive the capture — it's been logged, no need to keep it in inbox
        await adminClient.from('captures')
          .update({ status: 'archived' })
          .eq('id', cap.id)
          .eq('user_id', user.id);
        archived++;
      }

      // Mark as checked regardless
      const meta = (cap.metadata ?? {}) as Record<string, unknown>;
      await adminClient.from('captures')
        .update({ metadata: { ...meta, unsubscribe_checked: true } })
        .eq('id', cap.id)
        .eq('user_id', user.id);
    } catch {
      // Skip on error, continue with others
    }
  }

  return NextResponse.json({ scanned: candidates.length, detected, archived });
}
