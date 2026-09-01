import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { getPrefs, setPrefList, setHasPet, PREF_FIELDS, type PrefField } from '@/lib/profile/prefs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function requireUser(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return null;
  const { data: { user } } = await supabase.auth.getUser(token);
  return user ?? null;
}

export async function GET(req: NextRequest) {
  const user = await requireUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json(await getPrefs(user.id));
}

// PUT { field, values: string[] }  |  { has_pet: boolean }
export async function PUT(req: NextRequest) {
  const user = await requireUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { field?: string; values?: string[]; has_pet?: boolean };

  if (typeof b.has_pet === 'boolean') {
    await setHasPet(user.id, b.has_pet);
    return NextResponse.json({ ok: true });
  }
  if (b.field && b.field in PREF_FIELDS && Array.isArray(b.values)) {
    await setPrefList(user.id, b.field as PrefField, b.values);
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: 'field+values or has_pet required' }, { status: 400 });
}
