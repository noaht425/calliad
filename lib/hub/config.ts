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
  personality_axes: JSON.stringify({ warmth: 3, directness: 3, wit: 3, verbosity: 3, proactivity: 3 }),
  // Trust ladder: which confirm-tier action kinds run without asking first.
  auto_actions: '{}',
  // Learned behavior rules: when reflection / the rule compiler last ran.
  behavior_reflection_at: '',
  behavior_lifecycle_at: '',
  behavior_compiler_at: '',
  // Knowledge base: one-time backfill of old chat history into notes.
  notes_backfill_cursor: '',
  notes_backfill_done: '',
  // Tool-calling migration: '1' routes the calendar/task/class/note cluster
  // through model tool calls instead of the regex handlers. '0' = old path.
  chat_tools: process.env.CHAT_TOOLS ?? '1',
};

export async function getConfig(key: string): Promise<string> {
  // Operator settings controlled via env, not runtime state. Env wins when set;
  // the config row is only a fallback / record.
  if (key === 'spend_cap_usd_month' && process.env.SPEND_CAP_USD_MONTH) {
    return process.env.SPEND_CAP_USD_MONTH;
  }
  if (key === 'chat_tools' && process.env.CHAT_TOOLS) {
    return process.env.CHAT_TOOLS; // set CHAT_TOOLS=0 in Vercel to hard-disable
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
