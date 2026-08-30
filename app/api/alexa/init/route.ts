import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase.server';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  // Localhost-only — Vercel sets x-vercel-forwarded-for on deployed requests; local dev does not
  const host = req.headers.get('host') ?? '';
  const setupHeader = req.headers.get('x-alexa-setup');
  const vercelForwarded = req.headers.get('x-vercel-forwarded-for');

  if (vercelForwarded || !host.startsWith('localhost') || setupHeader !== 'local') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const body = await req.json() as {
    cookie?: string;
    csrf?: string;
    formerRegistrationData?: unknown;
    macDms?: unknown;
  };

  if (!body.cookie || !body.csrf) {
    return NextResponse.json({ error: 'cookie and csrf are required' }, { status: 400 });
  }

  // Single-user personal app — find the first (only) registered user
  const { data: { users } } = await adminClient.auth.admin.listUsers({ perPage: 1 });
  if (!users?.length) {
    return NextResponse.json(
      { error: 'No Calliad user found — log in to Calliad in your browser first' },
      { status: 400 }
    );
  }

  const userId = users[0].id;

  await adminClient.from('connected_services').upsert(
    {
      user_id: userId,
      service: 'alexa',
      access_token: body.cookie,
      token_expires_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
      metadata: {
        csrf: body.csrf,
        former_registration_data: body.formerRegistrationData ?? null,
        mac_dms: body.macDms ?? null,
        auto_refresh_enabled: false,
        last_refreshed_at: new Date().toISOString(),
      },
    },
    { onConflict: 'user_id,service' }
  );

  return NextResponse.json({ ok: true });
}
