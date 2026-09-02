import { randomUUID } from 'node:crypto';
import { adminClient } from '@/lib/supabase.server';

// One rolling conversation shared by every surface (PWA, Telegram, the morning
// brief). A turn from any of them appends here; the PWA's /api/conversation/current
// poll keeps the app in step. Rolls over to a fresh thread once the last one has
// been quiet for ~18h, matching that endpoint's window.

const WINDOW_MS = 18 * 60 * 60 * 1000;
const SURFACES = ['pwa', 'cron', 'telegram'] as const;

export async function currentThreadId(
  createSurface: (typeof SURFACES)[number] = 'telegram',
): Promise<string> {
  const { data } = await adminClient
    .from('conversations')
    .select('id, last_at')
    .in('surface', SURFACES as unknown as string[])
    .order('last_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (data?.id && data.last_at && Date.now() - Date.parse(data.last_at as string) < WINDOW_MS) {
    return data.id as string;
  }

  const id = randomUUID();
  await adminClient.from('conversations').insert({
    id,
    surface: createSurface,
    started_at: new Date().toISOString(),
    last_at: new Date().toISOString(),
  });
  return id;
}
