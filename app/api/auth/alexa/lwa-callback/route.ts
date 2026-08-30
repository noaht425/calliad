import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase.server';
import { v4 as uuid } from 'uuid';

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const code = sp.get('code');
  const state = sp.get('state');
  const error = sp.get('error');

  const errorRedirect = `${process.env.NEXT_PUBLIC_APP_URL}/settings?alexa=error`;

  if (error || !code || !state) return NextResponse.redirect(errorRedirect);

  let alexaState: string, alexaRedirectUri: string;
  try {
    const parsed = JSON.parse(Buffer.from(state, 'base64').toString());
    alexaState = parsed.alexaState;
    alexaRedirectUri = parsed.alexaRedirectUri;
  } catch {
    return NextResponse.redirect(errorRedirect);
  }

  // Exchange LWA auth code for tokens
  const tokenRes = await fetch('https://api.amazon.com/auth/o2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/alexa/lwa-callback`,
      client_id: process.env.AMAZON_CLIENT_ID!,
      client_secret: process.env.AMAZON_CLIENT_SECRET!,
    }),
  });

  if (!tokenRes.ok) {
    console.error('[alexa/lwa-callback] token exchange failed:', await tokenRes.text());
    return NextResponse.redirect(errorRedirect);
  }

  const tokens = await tokenRes.json();

  // Get Amazon profile to identify the Calliad user
  const profileRes = await fetch('https://api.amazon.com/user/profile', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });

  if (!profileRes.ok) {
    console.error('[alexa/lwa-callback] profile fetch failed:', await profileRes.text());
    return NextResponse.redirect(errorRedirect);
  }

  const amazonProfile = await profileRes.json();

  // Match to Calliad user by email
  const { data: { users } } = await adminClient.auth.admin.listUsers();
  const calliadUser = users.find((u) => u.email === amazonProfile.email);

  if (!calliadUser) {
    console.error('[alexa/lwa-callback] no Calliad user for Amazon email:', amazonProfile.email);
    return NextResponse.redirect(errorRedirect);
  }

  // Persist LWA tokens so Calliad can call the Lists API proactively
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
  await adminClient.from('connected_services').upsert({
    user_id: calliadUser.id,
    service: 'amazon',
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token ?? null,
    token_expires_at: expiresAt,
  }, { onConflict: 'user_id,service' });

  // Issue a short-lived code for Alexa to exchange at our token endpoint
  const ourCode = uuid();
  await adminClient.from('alexa_auth_codes').insert({
    code: ourCode,
    user_id: calliadUser.id,
    expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  });

  // Redirect back to Alexa with our code + original state
  const redirectParams = new URLSearchParams({ code: ourCode, state: alexaState });
  return NextResponse.redirect(`${alexaRedirectUri}?${redirectParams}`);
}
