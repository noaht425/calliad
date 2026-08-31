import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { getWeatherLocation, setWeatherLocation, geocodeCity } from '@/lib/weather/location';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function requireUser(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return null;
  const { data: { user } } = await supabase.auth.getUser(token);
  return user ?? null;
}

// GET → current { lat, lon, label }
export async function GET(req: NextRequest) {
  if (!(await requireUser(req))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json(await getWeatherLocation());
}

// POST { city } | { lat, lon, label } → resolve + save
export async function POST(req: NextRequest) {
  if (!(await requireUser(req))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const b = await req.json().catch(() => ({}));

  let loc: { lat: number; lon: number; label: string } | null = null;
  if (typeof b.lat === 'number' && typeof b.lon === 'number') {
    loc = { lat: b.lat, lon: b.lon, label: (b.label as string)?.trim() || 'current location' };
  } else if (b.city?.trim()) {
    loc = await geocodeCity(b.city);
    if (!loc) return NextResponse.json({ error: `Couldn't find "${b.city}".` }, { status: 404 });
  } else {
    return NextResponse.json({ error: 'city or lat/lon required' }, { status: 400 });
  }

  await setWeatherLocation(loc);
  return NextResponse.json(loc);
}
