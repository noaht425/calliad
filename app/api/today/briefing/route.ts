import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { supabase } from '@/lib/supabase';
import { getUserContext, buildSystemPrompt } from '@/lib/context';

export const runtime = 'nodejs';

const genai = new GoogleGenerativeAI(process.env.GOOGLE_AI_KEY!);

export async function GET(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const ctx = await getUserContext(user.id);
  const systemPrompt = buildSystemPrompt(ctx);
  const userName = ((ctx.profile?.full_name as string | undefined) ?? '').split(' ')[0] || 'there';
  const now = new Date();
  const timeOfDay = now.getHours() < 12 ? 'morning' : now.getHours() < 17 ? 'afternoon' : 'evening';
  const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: (ctx.profile?.timezone as string | undefined) ?? 'America/Los_Angeles' });

  const model = genai.getGenerativeModel({
    model: 'gemini-3.6-flash',
    systemInstruction: systemPrompt || undefined,
  });

  const result = await model.generateContent(
    `Write a brief, warm opening message to ${userName} for this ${timeOfDay} (${dateStr}).

2–3 sentences max. Be specific — mention what's actually relevant right now (a trip coming up, something on the calendar today, an open to-do, a birthday soon). If nothing urgent, be conversational and inviting.

End with an open question or invitation to chat — not "How can I help?" but something more specific to their situation.

Don't say "Good ${timeOfDay}" literally. Don't use filler. Sound like you know them.`
  );

  const briefing = result.response.text().trim();
  return NextResponse.json({ briefing });
}
