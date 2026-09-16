import { NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { hasTtsKey, previewText, synthesize, estimateSeconds, isQuality, TtsQuality } from '@/lib/tts';
import { voiceById } from '@/lib/tts-voices';
import { loadBookForJob } from '@/lib/job-queue';
import { serverSupabase, SERVER_IMAGES_BUCKET } from '@/lib/supabase-server';
import { BookProject } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// Provlyssning: bokens första sidor som ljud, innan hela ljudboken görs.
// Provet sparas i molnet per bok, röst och läge - samma prov görs aldrig om.
// Ändras bokens text får provet ett nytt namn och skapas på nytt.
export async function POST(request: Request) {
  try {
    const body = await request.json() as { bookId?: string; book?: Partial<BookProject>; voiceId?: string; maxWords?: number; quality?: string };
    return deliver({
      bookId: body.bookId,
      book: body.book,
      voiceId: body.voiceId,
      maxWords: body.maxWords,
      quality: isQuality(body.quality) ? body.quality : 'best',
    });
  } catch (error) {
    return fail(error);
  }
}

// Samma prov som en vanlig adress, så att en <audio> kan spela det direkt
// och ett sparat prov aldrig kostar något nytt.
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const quality = params.get('quality');
    return deliver({
      bookId: params.get('bookId') || undefined,
      voiceId: params.get('voiceId') || undefined,
      maxWords: Number(params.get('maxWords')) || undefined,
      quality: isQuality(quality) ? quality : 'best',
    });
  } catch (error) {
    return fail(error);
  }
}

async function deliver(input: { bookId?: string; book?: Partial<BookProject>; voiceId?: string; maxWords?: number; quality: TtsQuality }) {
  const voice = voiceById(input.voiceId);
  const voiceId = input.voiceId && /^[A-Za-z0-9]{10,40}$/.test(input.voiceId) ? input.voiceId : voice.id;

  let book: Partial<BookProject> | null = input.book ?? null;
  if (!book && input.bookId) {
    const loaded = await loadBookForJob(input.bookId);
    if (loaded) book = { title: loaded.title, author: loaded.author, spreads: loaded.spreads };
  }
  if (!book?.spreads?.length) {
    return NextResponse.json({ error: 'Hittade ingen text att läsa upp' }, { status: 400 });
  }

  const text = previewText(book as BookProject, Math.min(Math.max(input.maxWords ?? 280, 60), 600));
  const db = serverSupabase();
  const stamp = createHash('sha1').update(text).digest('hex').slice(0, 8);
  const path = input.bookId
    ? `books/${input.bookId}/audio/prov-${voiceId}-${input.quality}-${stamp}.mp3`
    : null;

  // Redan gjort prov spelas upp igen utan att kosta något
  if (path) {
    const publicUrl = db.storage.from(SERVER_IMAGES_BUCKET).getPublicUrl(path).data.publicUrl;
    const cached = await fetch(publicUrl, { cache: 'no-store' }).catch(() => null);
    if (cached?.ok) return NextResponse.redirect(publicUrl, 302);
  }

  if (!hasTtsKey()) {
    return NextResponse.json({ error: 'Ljudbok är inte påslaget på servern (ELEVENLABS_API_KEY saknas)' }, { status: 503 });
  }

  const mp3 = await synthesize(text, voiceId, input.quality);
  if (path) {
    await db.storage.from(SERVER_IMAGES_BUCKET).upload(path, mp3, { contentType: 'audio/mpeg', upsert: true });
  }

  return new NextResponse(new Uint8Array(mp3), {
    headers: {
      'Content-Type': 'audio/mpeg',
      'Content-Length': String(mp3.length),
      'Cache-Control': 'no-store',
      'X-Voice': voice.name,
      'X-Seconds': String(estimateSeconds(text)),
      'X-Characters': String(text.length),
    },
  });
}

function fail(error: unknown) {
  const message = error instanceof Error ? error.message : 'Okänt fel';
  console.error('Provlyssning misslyckades:', message);
  return NextResponse.json({ error: message }, { status: 500 });
}
