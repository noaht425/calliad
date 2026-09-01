import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { listTrips, getTrip, setTripStatus, deleteTrip, type Trip } from '@/lib/travel/trips';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function requireUser(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return null;
  const { data: { user } } = await supabase.auth.getUser(token);
  return user ?? null;
}

// GET            → all trips
// GET ?id=<uuid> → one trip
export async function GET(req: NextRequest) {
  const user = await requireUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const id = req.nextUrl.searchParams.get('id');
  if (id) {
    const trip = await getTrip(user.id, id);
    return trip ? NextResponse.json({ trip }) : NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  return NextResponse.json({ items: await listTrips(user.id) });
}

// PATCH { id, status }
export async function PATCH(req: NextRequest) {
  const user = await requireUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { id?: string; status?: Trip['status'] };
  if (!b.id || !b.status) return NextResponse.json({ error: 'id + status required' }, { status: 400 });
  if (!['planned', 'active', 'done', 'cancelled'].includes(b.status)) return NextResponse.json({ error: 'bad status' }, { status: 400 });
  await setTripStatus(user.id, b.id, b.status);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const user = await requireUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  await deleteTrip(user.id, id);
  return NextResponse.json({ ok: true });
}
