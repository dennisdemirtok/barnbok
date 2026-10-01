import { NextResponse } from 'next/server';
import { containsWord, hasTtsKey, isQuality, narrationSegments, spokenText, synthesize, TtsQuality } from '@/lib/tts';
import { loadBookForJob } from '@/lib/job-queue';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Hör ett ord i sitt sammanhang: första meningen i boken där ordet står läses
// upp med det nya uttalet, så man hör om rättelsen blev bra innan man läser om
// hela kapitlet. Kostar bara den meningens tecken.
export async function POST(request: Request) {
  try {
    if (!hasTtsKey()) {
      return NextResponse.json({ error: 'Ljudbok är inte påslaget på servern' }, { status: 503 });
    }
    const body = await request.json() as { bookId?: string; word?: string; sayAs?: string; text?: string; voiceId?: string; quality?: string };
    const quality: TtsQuality = isQuality(body.quality) ? body.quality : 'best';
    const word = body.word?.trim() || '';
    const sayAs = body.sayAs?.trim() || word;

    let sentence = body.text?.trim().slice(0, 300) || '';
    if (!sentence && body.bookId && word) {
      const book = await loadBookForJob(body.bookId);
      if (book) {
        const text = narrationSegments({
          id: book.id, title: book.title, author: book.author, spreads: book.spreads,
          characters: book.characters, styleGuide: book.styleGuide, bookFormat: book.bookFormat,
          status: 'done', createdAt: new Date().toISOString(),
        } as never).map(s => s.text).join('\n\n');
        const sentences = text.match(/[^.!?\n]+[.!?]*/g) || [];
        sentence = (sentences.find(s => containsWord(s, word)) || '').trim().slice(0, 300);
      }
    }
    if (!sentence) sentence = word;
    if (!sentence) return NextResponse.json({ error: 'Skriv ett ord att prova' }, { status: 400 });

    const spoken = spokenText(sentence, word ? [{ word, sayAs }] : []);
    const mp3 = await synthesize(spoken, body.voiceId, quality);
    return new NextResponse(new Uint8Array(mp3), {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Length': String(mp3.length),
        'Cache-Control': 'no-store',
        'X-Sentence': encodeURIComponent(spoken),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okänt fel';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
