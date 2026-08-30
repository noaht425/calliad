import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { adminClient } from '@/lib/supabase.server';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: { user } } = await supabase.auth.getUser(token);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayDate = todayStart.toISOString().slice(0, 10);

  // Find todo folder first (needed for todo count)
  const { data: todoFolder } = await adminClient
    .from('folders').select('id')
    .eq('user_id', user.id).ilike('name', '%to-do%')
    .limit(1).maybeSingle();

  const [todoResult, tripResult, captureResult] = await Promise.all([
    todoFolder
      ? adminClient.from('captures')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', user.id)
          .eq('folder_id', todoFolder.id)
          .eq('status', 'folder')
          .contains('tags', ['todo'])
      : Promise.resolve({ count: 0, data: null, error: null }),

    adminClient.from('trips')
      .select('destination, start_date')
      .eq('user_id', user.id)
      .gte('start_date', todayDate)
      .order('start_date')
      .limit(1)
      .maybeSingle(),

    adminClient.from('captures')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .gte('created_at', todayStart.toISOString())
      .neq('source', 'assistant')
      .in('status', ['inbox', 'folder']),
  ]);

  const openTodos = todoResult.count ?? 0;
  const newCapturesCount = captureResult.count ?? 0;

  let nextTrip: { destination: string; daysUntil: number } | null = null;
  if (tripResult.data) {
    const tripDate = new Date(tripResult.data.start_date);
    const msPerDay = 1000 * 60 * 60 * 24;
    const daysUntil = Math.round((tripDate.getTime() - todayStart.getTime()) / msPerDay);
    nextTrip = { destination: tripResult.data.destination, daysUntil };
  }

  return NextResponse.json({ openTodos, nextTrip, newCapturesCount });
}
