import { adminClient } from '@/lib/supabase.server';

/**
 * The `config` table — runtime flags + spend counters. One row per key.
 * See supabase/migrations/0001_init.sql.
 */

const SEED: Record<string, string> = {
  killswitch_level: 'off',
  spend_cap_usd_month: process.env.SPEND_CAP_USD_MONTH ?? '10',
  spend_month: new Date().toISOString().slice(0, 7),
  spend_month_to_date_usd: '0',
  // Where the brief's weather is for. JSON {lat,lon,label}. Default: Trinity / Hartford.
  weather_location: JSON.stringify({ lat: 41.7637, lon: -72.6851, label: 'Hartford' }),
  // Personality: generated "voice profile" + when it was last regenerated + the
  // user's default stance preset.
  persona_addendum: '',
  persona_addendum_at: '',
  personality_preset: 'default',
};

export async function getConfig(key: string): Promise<string> {
  // The monthly spend cap is an operator setting, controlled via env — not runtime
  // state. Env wins when set; the config row is only a fallback / record.
  if (key === 'spend_cap_usd_month' && process.env.SPEND_CAP_USD_MONTH) {
    return process.env.SPEND_CAP_USD_MONTH;
  }

  const { data } = await adminClient.from('config').select('value').eq('key', key).maybeSingle();
  if (data) return data.value;
  // self-heal: a fresh DB may not be seeded yet
  if (key in SEED) {
    await setConfig(key, SEED[key]);
    return SEED[key];
  }
  throw new Error(`config: unknown key "${key}"`);
}

export async function setConfig(key: string, value: string): Promise<void> {
  await adminClient
    .from('config')
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
}

export const config = { get: getConfig, set: setConfig };
