import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { adminClient } from '@/lib/supabase.server';
import type { CaptureSource } from '@/lib/types';

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const audio = form.get('audio') as File | null;
    const source = (form.get('source') as CaptureSource) ?? 'pwa_button';
    const locationLat = form.get('location_lat') ? Number(form.get('location_lat')) : null;
    const locationLng = form.get('location_lng') ? Number(form.get('location_lng')) : null;
    const locationLabel = form.get('location_label') as string | null;

    const token = req.headers.get('authorization')?.replace('Bearer ', '');
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    let rawAudioUrl: string | undefined;
    if (audio) {
      const ext = audio.type.includes('mp4') ? 'mp4' : 'webm';
      const path = `${user.id}/${Date.now()}.${ext}`;
      const { error: uploadErr } = await adminClient.storage
        .from('audio')
        .upload(path, audio, { contentType: audio.type });
      if (uploadErr) return NextResponse.json({ error: 'Storage upload failed', detail: uploadErr.message }, { status: 500 });
      rawAudioUrl = path;
    }

    const { data, error } = await adminClient
      .from('captures')
      .insert({
        user_id: user.id,
        raw_audio_url: rawAudioUrl,
        transcript: '',
        source,
        location_lat: locationLat,
        location_lng: locationLng,
        location_label: locationLabel,
        transcription_status: audio ? 'pending' : 'done',
      })
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    console.error('[captures POST]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const token = req.headers.get('authorization')?.replace('Bearer ', '');
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status') ?? 'inbox';
    const folderId = searchParams.get('folder_id');
    const tripId = searchParams.get('trip_id');

    let query = adminClient
      .from('captures')
      .select('id,user_id,raw_audio_url,transcript,summary,tags,folder_id,trip_id,source,location_lat,location_lng,location_label,status,transcription_status,metadata,created_at,updated_at')
      .eq('user_id', user.id)
      .eq('status', status)
      .order('created_at', { ascending: false });

    if (folderId) query = query.eq('folder_id', folderId);
    if (tripId) query = query.eq('trip_id', tripId);

    const { data, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  } catch (err) {
    console.error('[captures GET]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
