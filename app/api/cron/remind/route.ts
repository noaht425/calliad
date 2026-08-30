import { NextRequest, NextResponse } from 'next/server';
import webpush from 'web-push';
import { adminClient } from '@/lib/supabase.server';

export const runtime = 'nodejs';

webpush.setVapidDetails(
  'mailto:dougt425@gmail.com',
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!
);

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret');
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const now = new Date().toISOString();

  // Find all todo captures where remind_at has passed
  const { data: todoCaps } = await adminClient
    .from('captures')
    .select('id, user_id, transcript, metadata')
    .eq('status', 'folder')
    .eq('source', 'assistant')
    .contains('tags', ['todo']);

  if (!todoCaps?.length) return NextResponse.json({ sent: 0 });

  let sent = 0;
  const processed = new Set<string>();

  for (const cap of todoCaps) {
    const meta = (cap.metadata ?? {}) as Record<string, unknown>;
    const remindAt = meta.remind_at as string | undefined;
    if (!remindAt || remindAt > now) continue;
    if (processed.has(cap.id)) continue;
    processed.add(cap.id);

    // Create inbox reminder card
    await adminClient.from('captures').insert({
      user_id: cap.user_id,
      source: 'assistant',
      transcript: `Reminder: ${cap.transcript}`,
      summary: `Reminder: ${cap.transcript}`,
      tags: ['todo', 'reminder'],
      status: 'inbox',
      transcription_status: 'done',
    });

    // Clear remind_at so it doesn't fire again
    await adminClient.from('captures')
      .update({ metadata: { ...meta, remind_at: null } })
      .eq('id', cap.id);

    // Send push notification to all user's subscriptions
    const { data: subs } = await adminClient
      .from('push_subscriptions')
      .select('endpoint, p256dh, auth')
      .eq('user_id', cap.user_id);

    for (const sub of subs ?? []) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify({
            title: 'Calliad reminder',
            body: cap.transcript,
            tag: `todo-${cap.id}`,
            url: '/todos',
          })
        );
        sent++;
      } catch (err: unknown) {
        // 410 Gone = subscription expired; remove it
        if ((err as { statusCode?: number }).statusCode === 410) {
          await adminClient.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
        }
      }
    }
  }

  return NextResponse.json({ sent });
}
