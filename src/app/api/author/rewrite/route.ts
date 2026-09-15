import { NextResponse } from 'next/server';
import { rewritePassage, AuthorInputError, REWRITE_LIMITS } from '@/lib/author-ai';
import type { RewriteRequest, RewriteResponse } from '@/lib/author-types';

export const maxDuration = 120;

// Marginal före maxDuration
const BUDGET_MS = 105_000;

// Skriver om en markerad del av ett kapitel: enligt kommentar, två varianter eller putsning
export async function POST(request: Request) {
  const startedAt = Date.now();
  try {
    const body = await request.json().catch(() => null) as Partial<RewriteRequest> | null;
    if (!body || !body.project || typeof body.project !== 'object') {
      return NextResponse.json({ error: 'Projektet saknas' }, { status: 400 });
    }
    if (body.mode !== 'comment' && body.mode !== 'variants' && body.mode !== 'polish') {
      return NextResponse.json({ error: 'Välj hur texten ska skrivas om' }, { status: 400 });
    }
    const selection = typeof body.selection === 'string' ? body.selection : '';
    if (!selection.trim()) {
      return NextResponse.json({ error: 'Markera den text som ska skrivas om' }, { status: 400 });
    }
    if (selection.length > REWRITE_LIMITS.selection) {
      return NextResponse.json({ error: 'Markeringen är för lång - skriv om kapitlet i stället eller markera en kortare del' }, { status: 400 });
    }
    const comment = typeof body.comment === 'string' ? body.comment.trim().slice(0, REWRITE_LIMITS.comment) : '';
    if (body.mode === 'comment' && !comment) {
      return NextResponse.json({ error: 'Skriv vad som ska ändras' }, { status: 400 });
    }

    const variants = await rewritePassage({
      project: body.project,
      chapterTitle: typeof body.chapterTitle === 'string' ? body.chapterTitle : '',
      before: typeof body.before === 'string' ? body.before : '',
      selection,
      after: typeof body.after === 'string' ? body.after : '',
      mode: body.mode,
      comment: comment || undefined,
    }, startedAt + BUDGET_MS);

    console.log(`[author/rewrite] ${body.mode}: ${variants.length} förslag på ${Math.round((Date.now() - startedAt) / 1000)} s`);
    return NextResponse.json({ variants } satisfies RewriteResponse);
  } catch (error) {
    if (error instanceof AuthorInputError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error('Skriva om texten misslyckades:', error);
    const message = error instanceof Error ? error.message : 'Okänt fel';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
