import { NextResponse } from 'next/server';
import { hasTtsKey, previewText, synthesize, estimateSeconds } from '@/lib/tts';
import { voiceById } from '@/lib/tts-voices';
import { loadBookForJob } from '@/lib/job-queue';
import { BookProject } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// Provlyssning: bokens första sidor som ljud, innan hela ljudboken görs.
// Boken kan komma antingen som id (sparad i molnet) eller direkt i anropet.
export async function POST(request: Request) {
  try {
    if (!hasTtsKey()) {
      return NextResponse.json({ error: 'Ljudbok är inte påslaget på servern (ELEVENLABS_API_KEY saknas)' }, { status: 503 });
    }
    const body = await request.json() as { bookId?: string; book?: Partial<BookProject>; voiceId?: string; maxWords?: number };
    const voice = voiceById(body.voiceId);

    let book: Partial<BookProject> | null = body.book ?? null;
    if (!book && body.bookId) {
      const loaded = await loadBookForJob(body.bookId);
      if (loaded) book = { title: loaded.title, author: loaded.author, spreads: loaded.spreads };
    }
    if (!book?.spreads?.length) {
      return NextResponse.json({ error: 'Hittade ingen text att läsa upp' }, { status: 400 });
    }

    const text = previewText(book as BookProject, Math.min(Math.max(body.maxWords ?? 280, 60), 600));
    const mp3 = await synthesize(text, voice.id);

    return new NextResponse(new Uint8Array(mp3), {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Length': String(mp3.length),
        'Cache-Control': 'no-store',
        'X-Voice': voice.name,
        'X-Seconds': String(estimateSeconds(text)),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okänt fel';
    console.error('Provlyssning misslyckades:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
