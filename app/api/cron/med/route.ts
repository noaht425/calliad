import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase.server';
import { audit } from '@/lib/hub/audit';
import { config } from '@/lib/hub/config';
import { checkSecret } from '@/lib/hub/guard';
import { medCheckin } from '@/lib/health/meds';

export const runtime = 'nodejs';
export const maxDuration = 60;

const TZ = process.env.TZ_DEFAULT ?? 'America/New_York';

// The daily medication check-in. Not a Vercel cron (Hobby cap is 2, both used) —
// ping this from an external scheduler / iOS automation around 11am local.
// `?followup=1` allows a second send if the first went unanswered; the nudge
// cron also calls medCheckin({followUp:true}) as an afternoon backstop.
async function handle(req: NextRequest) {
  const denied = checkSecret(req, 'CRON_SECRET', ['x-cron-secret']);
  if (denied) return denied;

  const kill = await config.get('killswitch_level');
  if (kill === 'pause_all' || kill === 'pause_proactive') {
    return NextResponse.json({ ok: true, skipped: `killswitch ${kill}` });
  }
  const hour = parseInt(new Date().toLocaleString('en-US', { timeZone: TZ, hour: 'numeric', hour12: false }).replace(/\D/g, ''), 10);
  if (hour >= 1 && hour < 7) return NextResponse.json({ ok: true, skipped: 'quiet hours' });

  const followUp = req.nextUrl.searchParams.get('followup') === '1';
  const { data: svc } = await adminClient.from('connected_services').select('user_id');
  const userIds = [...new Set((svc ?? []).map((r) => r.user_id))];

  const results = [];
  for (const userId of userIds) {
    const r = await medCheckin(userId, { followUp }).catch((e) => ({ sent: false, reason: String(e) }));
    results.push({ userId, ...r });
  }
  await audit.log('trigger_fired', 'cron', 'med', { at: new Date().toISOString(), followUp, results });
  return NextResponse.json({ ok: true, results });
}

export const GET = handle;
export const POST = handle;
