import { NextResponse } from 'next/server';
import { config } from '@/lib/hub/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const [killswitch, spendMonthToDate, spendCap, spendMonth] = await Promise.all([
      config.get('killswitch_level'),
      config.get('spend_month_to_date_usd'),
      config.get('spend_cap_usd_month'),
      config.get('spend_month'),
    ]);
    return NextResponse.json({
      ok: true,
      killswitch,
      spendMonthToDate: parseFloat(spendMonthToDate),
      spendCap: parseFloat(spendCap),
      spendMonth,
      ts: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: 'config_unavailable', detail: String(err), ts: new Date().toISOString() },
      { status: 503 },
    );
  }
}
