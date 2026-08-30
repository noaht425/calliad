import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

// STUB — replaced by the real brain route in Track D1 (router → brain → SSE).
export async function POST(_req: NextRequest) {
  return NextResponse.json(
    { error: 'not_implemented', detail: 'chat route is stubbed until Track D1' },
    { status: 501 },
  );
}
