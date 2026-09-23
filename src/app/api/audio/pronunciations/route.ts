import { NextResponse } from 'next/server';
import { loadPronunciations, savePronunciations } from '@/lib/pronunciations';
import { loadBookForJob } from '@/lib/job-queue';
import { containsWord, narrationSegments, PronunciationRule } from '@/lib/tts';

export const dynamic = 'force-dynamic';

// Bokens uttalslista, och i vilka kapitel varje ord förekommer
// (så att man vet vilka kapitel som behöver läsas om).
export async function GET(request: Request) {
  const bookId = new URL(request.url).searchParams.get('bookId');
  if (!bookId) return NextResponse.json({ error: 'bookId saknas' }, { status: 400 });
  const [rules, book] = await Promise.all([loadPronunciations(bookId), loadBookForJob(bookId).catch(() => null)]);
  return NextResponse.json({ rules, usage: usage(rules, book) });
}

export async function PUT(request: Request) {
  try {
    const { bookId, rules } = await request.json() as { bookId?: string; rules?: PronunciationRule[] };
    if (!bookId) return NextResponse.json({ error: 'bookId saknas' }, { status: 400 });
    const saved = await savePronunciations(bookId, Array.isArray(rules) ? rules : []);
    const book = await loadBookForJob(bookId).catch(() => null);
    return NextResponse.json({ rules: saved, usage: usage(saved, book) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okänt fel';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function usage(rules: PronunciationRule[], book: Awaited<ReturnType<typeof loadBookForJob>>) {
  if (!book) return [];
  const segments = narrationSegments({
    id: book.id, title: book.title, author: book.author, spreads: book.spreads,
    characters: book.characters, styleGuide: book.styleGuide, bookFormat: book.bookFormat,
    status: 'done', createdAt: new Date().toISOString(),
  } as never);
  return rules.map(rule => ({
    word: rule.word,
    chapters: segments.filter(seg => containsWord(seg.text, rule.word)).map(seg => ({ index: seg.index, label: seg.label })),
  }));
}
