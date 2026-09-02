import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase.server';
import { audit } from '@/lib/hub/audit';
import { runLocationRules } from '@/lib/location/rules';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST from an iOS Shortcuts personal automation:
//   header  x-location-token: <LOCATION_TOKEN>
//   body    { "place": "home", "event": "arrive" | "leave", "lat"?, "lon"? }
async function ownerUserId(): Promise<string | null> {
  const { data } = await adminClient.auth.admin.listUsers();
  const email = process.env.CAPTURE_USER_EMAIL;
  return ((email ? data.users.find((u) => u.email === email) : data.users[0])?.id) ?? null;
}

export async function POST(req: NextRequest) {
  const tok = req.headers.get('x-location-token');
  if (!process.env.LOCATION_TOKEN || tok !== process.env.LOCATION_TOKEN) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const b = (await req.json().catch(() => ({}))) as { place?: string; event?: string; lat?: number; lon?: number };
  const place = (b.place ?? '').trim().slice(0, 60);
  const event = b.event === 'leave' ? 'leave' : b.event === 'arrive' ? 'arrive' : null;
  if (!place || !event) return NextResponse.json({ error: 'place and event ("arrive"|"leave") required' }, { status: 400 });

  const userId = await ownerUserId();
  if (!userId) return NextResponse.json({ error: 'no owner account' }, { status: 500 });

  const { data: row } = await adminClient
    .from('location_events')
    .insert({
      user_id: userId, place, event,
      lat: typeof b.lat === 'number' ? b.lat : null,
      lon: typeof b.lon === 'number' ? b.lon : null,
    })
    .select('id, user_id, place, event, at')
    .single();
  await audit.log('inbound_message', 'noah', null, { kind: 'location', place, event });

  let fired: string[] = [];
  if (row) {
    fired = await runLocationRules(row).catch((e) => { console.error('[location] rules', e); return []; });
    await adminClient.from('location_events').update({ handled: true }).eq('id', row.id);
  }
  return NextResponse.json({ ok: true, fired });
}
