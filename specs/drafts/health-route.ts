// Calliad hub — app/api/health/route.ts (draft, 2026-08-30)
// GET /api/health — unauthenticated liveness + at-a-glance state.
// Design: specs/hub-skeleton.md §7.
//
// TODO on drop-in: import the real config helper from the fork.

import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic'; // never cache — always reflect live state

declare const config: { get(key: string): Promise<string> };

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
      killswitch,                                   // 'off' | 'pause_proactive' | 'pause_all'
      spendMonthToDate: parseFloat(spendMonthToDate),
      spendCap: parseFloat(spendCap),
      spendMonth,                                   // 'YYYY-MM'
      ts: new Date().toISOString(),
    });
  } catch (err) {
    // Health should still return 200-with-degraded rather than 500 so uptime
    // checks distinguish "process up, DB flaky" from "process down".
    return NextResponse.json(
      { ok: false, error: 'config_unavailable', detail: String(err), ts: new Date().toISOString() },
      { status: 503 },
    );
  }
}
