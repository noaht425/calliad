import { adminClient } from '@/lib/supabase.server';

// Structured "About You" fields. Stored as confirmed profile_facts so they also
// flow into the brain via the learned-facts block; this module is the typed
// read/write surface + a one-line summary for tool context.

export const PREF_FIELDS = {
  preferred_airlines: 'travel',
  preferred_hotels: 'travel',
  preferred_car_rental: 'travel',
  frequent_cities: 'travel',
  dietary_restrictions: 'food',
} as const;
export type PrefField = keyof typeof PREF_FIELDS;

export interface Prefs {
  preferred_airlines: string[];
  preferred_hotels: string[];
  preferred_car_rental: string[];
  frequent_cities: string[];
  dietary_restrictions: string[];
  has_pet: boolean;
}

export async function getPrefs(userId: string): Promise<Prefs> {
  const keys = [...Object.keys(PREF_FIELDS), 'has_pet'];
  const { data } = await adminClient
    .from('profile_facts')
    .select('key, value')
    .eq('user_id', userId)
    .in('key', keys);
  const byKey = new Map((data ?? []).map((r) => [r.key as string, r.value as string]));
  const list = (k: string) => (byKey.get(k) ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return {
    preferred_airlines: list('preferred_airlines'),
    preferred_hotels: list('preferred_hotels'),
    preferred_car_rental: list('preferred_car_rental'),
    frequent_cities: list('frequent_cities'),
    dietary_restrictions: list('dietary_restrictions'),
    has_pet: (byKey.get('has_pet') ?? '').toLowerCase() === 'yes',
  };
}

export async function setPrefList(userId: string, field: PrefField, values: string[]): Promise<void> {
  const section = PREF_FIELDS[field];
  const value = [...new Set(values.map((s) => s.trim()).filter(Boolean))].join(', ');
  if (!value) {
    await adminClient.from('profile_facts').delete().eq('user_id', userId).eq('section', section).eq('key', field);
    return;
  }
  await adminClient.from('profile_facts').upsert(
    { user_id: userId, section, key: field, value, source: 'settings', confirmed: true, updated_at: new Date().toISOString() },
    { onConflict: 'user_id,section,key' },
  );
}

export async function setHasPet(userId: string, hasPet: boolean): Promise<void> {
  if (hasPet) {
    await adminClient.from('profile_facts').upsert(
      { user_id: userId, section: 'home', key: 'has_pet', value: 'yes', source: 'settings', confirmed: true, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,section,key' },
    );
  } else {
    await adminClient.from('profile_facts').delete().eq('user_id', userId).eq('section', 'home').eq('key', 'has_pet');
  }
  // Reflect onto trips already on file so prep nudges are correct.
  await adminClient
    .from('trips')
    .update({ has_pet: hasPet, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .in('status', ['planned', 'active']);
}

/** One-line pref summary for tool context (flights, restaurant hand-off). */
export async function prefsLine(userId: string): Promise<string> {
  const p = await getPrefs(userId);
  const bits: string[] = [];
  if (p.preferred_airlines.length) bits.push(`preferred airlines: ${p.preferred_airlines.join(', ')}`);
  if (p.preferred_hotels.length) bits.push(`hotels: ${p.preferred_hotels.join(', ')}`);
  if (p.preferred_car_rental.length) bits.push(`car rental: ${p.preferred_car_rental.join(', ')}`);
  if (p.frequent_cities.length) bits.push(`often visits: ${p.frequent_cities.join(', ')}`);
  if (p.dietary_restrictions.length) bits.push(`dietary: ${p.dietary_restrictions.join(', ')}`);
  return bits.length ? `Noah's saved prefs — ${bits.join('; ')}.` : '';
}
