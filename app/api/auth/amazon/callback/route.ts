import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase.server';

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code');
  const state = req.nextUrl.searchParams.get('state');
  const error = req.nextUrl.searchParams.get('error');

  if (error) return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/settings?amazon=denied`);
  if (!code || !state) return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/settings?amazon=error`);

  let userId: string;
  try {
    const decoded = JSON.parse(Buffer.from(state, 'base64').toString());
    userId = decoded.userId;
  } catch {
    return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/settings?amazon=error`);
  }

  // Exchange code for tokens
  const tokenRes = await fetch('https://api.amazon.com/auth/o2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/amazon/callback`,
      client_id: process.env.AMAZON_CLIENT_ID!,
      client_secret: process.env.AMAZON_CLIENT_SECRET!,
    }),
  });

  if (!tokenRes.ok) {
    console.error('[amazon callback] token exchange failed:', await tokenRes.text());
    return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/settings?amazon=error`);
  }

  const tokens = await tokenRes.json();
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

  await adminClient.from('connected_services').upsert({
    user_id: userId,
    service: 'amazon',
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token ?? null,
    token_expires_at: expiresAt,
  }, { onConflict: 'user_id,service' });

  return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/settings?amazon=connected`);
}
