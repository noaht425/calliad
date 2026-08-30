import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { adminClient } from '@/lib/supabase.server';

export async function GET(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: { user } } = await supabase.auth.getUser(token);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Find the To-Do folder
  const { data: project } = await adminClient
    .from('folders')
    .select('id')
    .eq('user_id', user.id)
    .ilike('name', '%to-do%')
    .limit(1)
    .maybeSingle();

  if (!project) return NextResponse.json([]);

  const { data, error } = await adminClient
    .from('captures')
    .select('id, summary, metadata, created_at')
    .eq('user_id', user.id)
    .eq('folder_id', project.id)
    .eq('status', 'folder')
    .contains('tags', ['todo'])
    .order('created_at', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}
