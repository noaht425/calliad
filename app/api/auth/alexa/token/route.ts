import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase.server';

export async function POST(req: NextRequest) {
  const text = await req.text();
  const body = new URLSearchParams(text);

  // Alexa uses HTTP Basic auth per our Account Linking config; fall back to body params
  const authHeader = req.headers.get('authorization') ?? '';
  let clientId: string | null = null;
  let clientSecret: string | null = null;

  if (authHeader.startsWith('Basic ')) {
    const decoded = Buffer.from(authHeader.slice(6), 'base64').toString();
    const sep = decoded.indexOf(':');
    clientId = decoded.slice(0, sep);
    clientSecret = decoded.slice(sep + 1);
  } else {
    clientId = body.get('client_id');
    clientSecret = body.get('client_secret');
  }

  if (clientId !== 'calliad-skill' || clientSecret !== process.env.ALEXA_SKILL_CLIENT_SECRET) {
    return NextResponse.json({ error: 'invalid_client' }, { status: 401 });
  }

  const grantType = body.get('grant_type');
  const code = body.get('code');

  if (grantType !== 'authorization_code' || !code) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  const { data: authCode } = await adminClient
    .from('alexa_auth_codes')
    .select('user_id, expires_at')
    .eq('code', code)
    .single();

  if (!authCode || new Date(authCode.expires_at) < new Date()) {
    return NextResponse.json({ error: 'invalid_grant' }, { status: 400 });
  }

  await adminClient.from('alexa_auth_codes').delete().eq('code', code);

  // The access_token we return is the Calliad user_id.
  // Alexa passes it in every skill request so we always know which user to act for.
  return NextResponse.json({
    access_token: authCode.user_id,
    token_type: 'Bearer',
    expires_in: 31536000,
  });
}
