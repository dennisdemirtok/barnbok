import { NextResponse } from 'next/server';
import { createIllustrationJob } from '@/lib/job-queue';

// Jobbstatus får aldrig cachas - den ändras hela tiden
export const dynamic = 'force-dynamic';

// Startar bildjobbet på servern. Boken måste vara sparad i molnet först.
export async function POST(request: Request) {
  try {
    const { bookId } = await request.json() as { bookId?: string };
    if (!bookId) return NextResponse.json({ error: 'bookId saknas' }, { status: 400 });

    const result = await createIllustrationJob(bookId);
    if ('error' in result) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Okänt fel';
    return NextResponse.json({ error: `Kunde inte starta bildjobbet: ${message}` }, { status: 500 });
  }
}
