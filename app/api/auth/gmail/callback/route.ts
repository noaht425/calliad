import { NextRequest, NextResponse } from 'next/server';
import { exchangeGmailCode } from '@/lib/integrations/gmail';

export const runtime = 'nodejs';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://calliad-psi.vercel.app';

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  if (searchParams.get('error') || !code || !state) {
    return NextResponse.redirect(`${APP_URL}/settings?gmail=error`);
  }
  try {
    const userId = Buffer.from(state, 'base64url').toString('utf-8');
    await exchangeGmailCode(code, userId);
    return NextResponse.redirect(`${APP_URL}/settings?gmail=connected`);
  } catch (err) {
    console.error('[gmail callback]', err);
    return NextResponse.redirect(`${APP_URL}/settings?gmail=error`);
  }
}
