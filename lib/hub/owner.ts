import { adminClient } from '@/lib/supabase.server';

/** Every account id (single-user for now, but this generalises the cron loops). */
export async function ownerUserIds(): Promise<string[]> {
  const { data } = await adminClient.auth.admin.listUsers();
  return (data?.users ?? []).map((u) => u.id);
}
