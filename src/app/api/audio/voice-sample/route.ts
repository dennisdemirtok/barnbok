import { NextResponse } from 'next/server';
import { hasTtsKey, isQuality, synthesize, VOICE_SAMPLE_TEXT, TtsQuality } from '@/lib/tts';
import { voiceById } from '@/lib/tts-voices';
import { serverSupabase, SERVER_IMAGES_BUCKET } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Röstprov: några sekunder så att man hör rösten innan man väljer.
// Provet görs en gång per röst och sparas sedan i molnet - nästa lyssnare
// kostar ingenting hos ElevenLabs.
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const voiceId = params.get('voiceId') || '';
  const qualityParam = params.get('quality');
  const quality: TtsQuality = isQuality(qualityParam) ? qualityParam : 'best';
  if (!/^[A-Za-z0-9]{10,40}$/.test(voiceId)) {
    return NextResponse.json({ error: 'Okänt röst-id' }, { status: 400 });
  }

  const db = serverSupabase();
  const path = `voice-samples/${voiceId}-${quality}.mp3`;
  const publicUrl = db.storage.from(SERVER_IMAGES_BUCKET).getPublicUrl(path).data.publicUrl;

  const cached = await fetch(publicUrl, { cache: 'no-store' }).catch(() => null);
  if (cached?.ok) {
    return NextResponse.redirect(publicUrl, 302);
  }

  if (!hasTtsKey()) {
    return NextResponse.json({ error: 'Ljudbok är inte påslaget på servern' }, { status: 503 });
  }

  try {
    const mp3 = await synthesize(VOICE_SAMPLE_TEXT, voiceId, quality);
    await db.storage.from(SERVER_IMAGES_BUCKET).upload(path, mp3, { contentType: 'audio/mpeg', upsert: true });
    return new NextResponse(new Uint8Array(mp3), {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Length': String(mp3.length),
        'Cache-Control': 'no-store',
        'X-Voice': voiceById(voiceId).name,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okänt fel';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
