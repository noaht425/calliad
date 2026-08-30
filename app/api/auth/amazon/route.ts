import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

const SCOPES = 'alexa::household:lists:read alexa::household:lists:write';

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token');
  if (!token) return NextResponse.json({ error: 'token required' }, { status: 400 });

  // Verify the user is authenticated before starting OAuth
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const state = Buffer.from(JSON.stringify({ userId: user.id, token })).toString('base64');

  const params = new URLSearchParams({
    client_id: process.env.AMAZON_CLIENT_ID!,
    scope: SCOPES,
    response_type: 'code',
    redirect_uri: `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/amazon/callback`,
    state,
  });

  return NextResponse.redirect(`https://www.amazon.com/ap/oa?${params}`);
}
