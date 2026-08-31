import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { adminClient } from '@/lib/supabase.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// The conversation Noah is currently in — the most recently active thread across
// his surfaces (morning brief + PWA) in the last ~18h — with its full message
// list. Both the home chat and the global panel poll this so a thread continued
// on the phone shows up on the laptop (and vice-versa) without a reload.
export async function GET(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const cutoff = new Date(Date.now() - 18 * 3600 * 1000).toISOString();
  const { data: conv } = await adminClient
    .from('conversations')
    .select('id, last_at')
    .in('surface', ['cron', 'pwa'])
    .gte('last_at', cutoff)
    .order('last_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!conv) return NextResponse.json({ conversation: null });

  const { data: messages } = await adminClient
    .from('messages')
    .select('role, content')
    .eq('conversation_id', conv.id)
    .order('created_at', { ascending: true });

  return NextResponse.json({
    conversation: {
      id: conv.id,
      lastAt: conv.last_at,
      messages: (messages ?? []).filter((m) => m.role === 'user' || m.role === 'assistant'),
    },
  });
}
