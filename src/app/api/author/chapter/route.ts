import { NextResponse } from 'next/server';
import { writeChapter, normalizeProject, AuthorInputError } from '@/lib/author-ai';
import { countWords } from '@/lib/claude';
import type { ChapterRequest, ChapterResponse } from '@/lib/author-types';

export const maxDuration = 300;

// Marginal före maxDuration: skrivandet avbryts här och det som hunnit skrivas returneras
const WRITE_BUDGET_MS = 270_000;

// Skriver ett kapitel (eller skriver om det enligt en kommentar) med författarens röst.
// Returnerar bara brödtexten - rubriken lagras separat. truncated: true = kapitlet hann inte bli klart.
export async function POST(request: Request) {
  const startedAt = Date.now();
  try {
    const body = await request.json().catch(() => null) as Partial<ChapterRequest> | null;
    if (!body) {
      return NextResponse.json({ error: 'Ogiltig förfrågan' }, { status: 400 });
    }
    const chapterId = typeof body.chapterId === 'string' ? body.chapterId : '';
    if (!chapterId) {
      return NextResponse.json({ error: 'Välj vilket kapitel som ska skrivas' }, { status: 400 });
    }
    const comment = typeof body.comment === 'string' ? body.comment.trim().slice(0, 4000) || undefined : undefined;
    const project = normalizeProject(body.project, { requireChapters: true });
    const chapter = project.chapters.find(c => c.id === chapterId);

    console.log(`[author/chapter] "${chapter?.title ?? chapterId}"${comment ? ' med kommentar' : ''}, mål ${project.settings.wordsPerChapter} ord`);
    const result = await writeChapter(project, chapterId, comment, startedAt + WRITE_BUDGET_MS);
    console.log(`[author/chapter] ${countWords(result.text)} ord${result.truncated ? ' (avbrutet)' : ''} på ${Math.round((Date.now() - startedAt) / 1000)} s`);
    return NextResponse.json(result satisfies ChapterResponse);
  } catch (error) {
    if (error instanceof AuthorInputError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error('Skriva kapitel misslyckades:', error);
    const message = error instanceof Error ? error.message : 'Okänt fel';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
