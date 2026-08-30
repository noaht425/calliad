import { NextRequest, NextResponse } from 'next/server';
import { DAVClient } from 'tsdav';
import { adminClient } from '@/lib/supabase.server';
import { parseVCard } from '@/lib/vcard-parse';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: { user }, error: authErr } = await adminClient.auth.getUser(token);
  if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: svc } = await adminClient
    .from('connected_services')
    .select('access_token, metadata')
    .eq('user_id', user.id)
    .eq('service', 'icloud_calendar')
    .single();

  if (!svc?.access_token) return NextResponse.json({ error: 'iCloud not connected' }, { status: 400 });

  const m = (svc.metadata ?? {}) as Record<string, string>;
  if (!m.apple_id) return NextResponse.json({ error: 'Apple ID missing' }, { status: 400 });

  const client = new DAVClient({
    serverUrl: 'https://contacts.icloud.com',
    credentials: { username: m.apple_id, password: svc.access_token },
    authMethod: 'Basic',
    defaultAccountType: 'carddav',
  });
  await client.login();

  const addressBooks = await client.fetchAddressBooks();
  const contacts: ReturnType<typeof parseVCard>[] = [];

  for (const ab of addressBooks) {
    const vcards = await client.fetchVCards({ addressBook: ab });
    for (const vc of vcards) {
      if (!vc.data) continue;
      const parsed = parseVCard(String(vc.data));
      if (parsed?.name) contacts.push(parsed);
    }
  }

  contacts.sort((a, b) => a!.name.localeCompare(b!.name));
  return NextResponse.json(contacts);
}
