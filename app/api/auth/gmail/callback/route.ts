import { NextRequest, NextResponse } from 'next/server';
import { exchangeGmailCode } from '@/lib/gmail';

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const error = searchParams.get('error');

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://calliad.vercel.app';

  if (error || !code || !state) {
    return NextResponse.redirect(`${appUrl}/settings?gmail=error`);
  }

  try {
    const userId = Buffer.from(state, 'base64url').toString('utf-8');
    await exchangeGmailCode(code, userId);
    return NextResponse.redirect(`${appUrl}/settings?gmail=connected`);
  } catch (err) {
    console.error('[gmail callback]', err);
    return NextResponse.redirect(`${appUrl}/settings?gmail=error`);
  }
}
