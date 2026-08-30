import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const alexaState = sp.get('state') ?? '';
  const alexaRedirectUri = sp.get('redirect_uri') ?? '';

  // Encode Alexa's state + redirect_uri so we can recover them after the LWA round-trip
  const ourState = Buffer.from(JSON.stringify({ alexaState, alexaRedirectUri })).toString('base64');

  const lwaParams = new URLSearchParams({
    client_id: process.env.AMAZON_CLIENT_ID!,
    scope: 'alexa::household:lists:read alexa::household:lists:write profile',
    response_type: 'code',
    redirect_uri: `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/alexa/lwa-callback`,
    state: ourState,
  });

  return NextResponse.redirect(`https://www.amazon.com/ap/oa?${lwaParams}`);
}
