import { NextResponse } from 'next/server';
import { createAudiobookJob, audioManifestPath, loadBookForJob } from '@/lib/job-queue';
import { hasTtsKey, isQuality, segmentSummaries } from '@/lib/tts';
import { serverSupabase, SERVER_IMAGES_BUCKET } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

// Startar uppläsningen av hela boken i bakgrunden (samma kö som bilderna).
export async function POST(request: Request) {
  try {
    if (!hasTtsKey()) {
      return NextResponse.json({ error: 'Ljudbok är inte påslaget på servern (ELEVENLABS_API_KEY saknas)' }, { status: 503 });
    }
    const { bookId, voiceId, quality, segments } = await request.json() as
      { bookId?: string; voiceId?: string; quality?: string; segments?: number[] };
    if (!bookId) return NextResponse.json({ error: 'bookId saknas' }, { status: 400 });

    const chapters = Array.isArray(segments) ? segments.filter(n => Number.isInteger(n) && n >= 0).slice(0, 200) : undefined;
    const result = await createAudiobookJob(bookId, voiceId, isQuality(quality) ? quality : 'best', chapters);
    if ('error' in result) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okänt fel';
    return NextResponse.json({ error: `Kunde inte starta ljudboken: ${message}` }, { status: 500 });
  }
}

// Färdig ljudbok för en bok (om den finns) och vad en ny skulle kosta i tid
export async function GET(request: Request) {
  const bookId = new URL(request.url).searchParams.get('bookId');
  if (!bookId) return NextResponse.json({ audiobook: null, estimate: null });

  const url = serverSupabase().storage.from(SERVER_IMAGES_BUCKET).getPublicUrl(audioManifestPath(bookId)).data.publicUrl;
  const res = await fetch(url, { cache: 'no-store' }).catch(() => null);
  const audiobook = res?.ok ? await res.json().catch(() => null) : null;

  // Uppskattning och kapitellista, så att man kan välja ett enda kapitel
  let estimate: { segments: number; characters: number; seconds: number } | null = null;
  let chapters: { index: number; label: string; characters: number; seconds: number; url?: string }[] = [];
  const book = await loadBookForJob(bookId).catch(() => null);
  if (book) {
    const summaries = segmentSummaries({
      id: book.id, title: book.title, author: book.author, spreads: book.spreads,
      characters: book.characters, styleGuide: book.styleGuide, bookFormat: book.bookFormat,
      status: 'done', createdAt: new Date().toISOString(),
    } as never);
    const done = new Map<number, string>(
      ((audiobook?.parts || []) as { index?: number; url: string }[])
        .filter(p => typeof p.index === 'number')
        .map(p => [p.index as number, p.url])
    );
    chapters = summaries.map(s => ({ ...s, url: done.get(s.index) }));
    estimate = {
      segments: summaries.length,
      characters: summaries.reduce((n, s) => n + s.characters, 0),
      seconds: summaries.reduce((n, s) => n + s.seconds, 0),
    };
  }
  return NextResponse.json({ audiobook, estimate, chapters });
}
