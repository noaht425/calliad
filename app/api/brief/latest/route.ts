import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { adminClient } from '@/lib/supabase.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// The most recent brief conversation from the last ~18h, with its messages — for
// the home screen to show on load.
export async function GET(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const cutoff = new Date(Date.now() - 18 * 3600 * 1000).toISOString();
  const { data: conv } = await adminClient
    .from('conversations')
    .select('id, started_at')
    .eq('surface', 'cron')
    .gte('started_at', cutoff)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!conv) return NextResponse.json({ brief: null });

  const { data: messages } = await adminClient
    .from('messages')
    .select('role, content')
    .eq('conversation_id', conv.id)
    .order('created_at', { ascending: true });

  return NextResponse.json({
    brief: {
      conversationId: conv.id,
      startedAt: conv.started_at,
      messages: (messages ?? []).filter((m) => m.role === 'user' || m.role === 'assistant'),
    },
  });
}
