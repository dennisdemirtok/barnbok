import { NextResponse } from 'next/server';
import { createAudiobookJob, audioManifestPath, loadBookForJob, syncAudioMeta } from '@/lib/job-queue';
import { applyPronunciations, containsWord, estimateSeconds, hasTtsKey, isQuality, narrationSegments, textStamp } from '@/lib/tts';
import { loadPronunciations } from '@/lib/pronunciations';
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

// Färdig ljudbok för en bok (om den finns), kapitellistan med vad varje kapitel
// kostar, och vilka inlästa kapitel som inte längre stämmer med texten
// (texten rättad eller uttalslistan ändrad sedan inläsningen).
export async function GET(request: Request) {
  const bookId = new URL(request.url).searchParams.get('bookId');
  if (!bookId) return NextResponse.json({ audiobook: null, estimate: null, chapters: [] });

  const url = serverSupabase().storage.from(SERVER_IMAGES_BUCKET).getPublicUrl(audioManifestPath(bookId)).data.publicUrl;
  const res = await fetch(`${url}?t=${Date.now()}`, { cache: 'no-store' }).catch(() => null);
  const audiobook = res?.ok ? await res.json().catch(() => null) : null;

  let estimate: { segments: number; characters: number; seconds: number } | null = null;
  let chapters: { index: number; label: string; characters: number; seconds: number; url?: string; stale?: boolean }[] = [];
  const [book, rules] = await Promise.all([
    loadBookForJob(bookId).catch(() => null),
    loadPronunciations(bookId).catch(() => []),
  ]);
  if (book) {
    const segments = narrationSegments({
      id: book.id, title: book.title, author: book.author, spreads: book.spreads,
      characters: book.characters, styleGuide: book.styleGuide, bookFormat: book.bookFormat,
      status: 'done', createdAt: new Date().toISOString(),
    } as never);
    const parts = new Map<number, { url: string; stamp?: string }>(
      ((audiobook?.parts || []) as { index?: number; url: string; stamp?: string }[])
        .filter(p => typeof p.index === 'number')
        .map(p => [p.index as number, p])
    );
    chapters = segments.map(seg => {
      const part = parts.get(seg.index);
      const spoken = applyPronunciations(seg.text, rules);
      return {
        index: seg.index,
        label: seg.label,
        characters: spoken.length,
        seconds: estimateSeconds(seg.text),
        url: part?.url,
        // Gamla inläsningar saknar fingeravtryck: de räknas som inaktuella bara
        // om ett ord i uttalslistan finns i kapitlet
        stale: !!part && (part.stamp
          ? part.stamp !== textStamp(spoken)
          : rules.some(r => containsWord(seg.text, r.word))),
      };
    });
    estimate = {
      segments: chapters.length,
      characters: chapters.reduce((n, c) => n + c.characters, 0),
      seconds: chapters.reduce((n, c) => n + c.seconds, 0),
    };

    // Bokhandeln läser ljudbokens speltid från bokens rad - håll den i takt med
    // innehållsförteckningen (t.ex. när texten fått ett nytt kapitel)
    if (audiobook && Array.isArray(audiobook.parts) && audiobook.parts.length > 0) {
      await syncAudioMeta(bookId, {
        seconds: typeof audiobook.seconds === 'number' ? audiobook.seconds : 0,
        parts: audiobook.parts.length,
        complete: chapters.length > 0 && chapters.every(c => c.url),
      }).catch(() => { /* bara en genväg för bokhandeln - ljudboken fungerar ändå */ });
    }
  }
  return NextResponse.json({ audiobook, estimate, chapters });
}
