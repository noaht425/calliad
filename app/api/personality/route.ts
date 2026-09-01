import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { config } from '@/lib/hub/config';
import { familiarity, getVoiceProfile, regenerateVoiceProfile, PRESETS, getAxes, setAxes, AXES_META } from '@/lib/brain/persona';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function requireUser(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return null;
  const { data: { user } } = await supabase.auth.getUser(token);
  return user ?? null;
}

export async function GET(req: NextRequest) {
  const user = await requireUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const [fam, voice, preset, axes] = await Promise.all([
    familiarity(user.id),
    getVoiceProfile(),
    config.get('personality_preset').catch(() => 'default'),
    getAxes(),
  ]);
  return NextResponse.json({
    familiarity: fam,
    voiceProfile: voice,
    preset,
    presets: Object.entries(PRESETS).map(([key, v]) => ({ key, label: v.label })),
    axes,
    axesMeta: AXES_META,
  });
}

// PUT { voiceProfile } | { preset } | { regenerate: true }
export async function PUT(req: NextRequest) {
  const user = await requireUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { voiceProfile?: string; preset?: string; regenerate?: boolean; axes?: Record<string, number> };

  if (b.axes) {
    const next = await setAxes(b.axes);
    return NextResponse.json({ ok: true, axes: next });
  }
  if (b.regenerate) {
    const t = await regenerateVoiceProfile(user.id).catch(() => null);
    return NextResponse.json({ ok: true, voiceProfile: t ?? (await getVoiceProfile()), note: t ? undefined : 'not enough history yet' });
  }
  if (b.voiceProfile !== undefined) {
    await config.set('persona_addendum', b.voiceProfile.trim().slice(0, 1200));
    await config.set('persona_addendum_at', new Date().toISOString());
    return NextResponse.json({ ok: true });
  }
  if (b.preset !== undefined) {
    const ok = b.preset === 'default' || b.preset in PRESETS || b.preset.startsWith('custom:');
    if (!ok) return NextResponse.json({ error: 'bad preset' }, { status: 400 });
    await config.set('personality_preset', b.preset.slice(0, 1000));
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: 'nothing to update' }, { status: 400 });
}
