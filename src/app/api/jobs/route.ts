import { NextResponse } from 'next/server';
import { findJobForBook, resumeStaleJobs } from '@/lib/job-queue';

// Jobbstatus får aldrig cachas - den ändras hela tiden
export const dynamic = 'force-dynamic';

// Senaste jobbet för en bok. Passar också på att återuppta jobb som tappats
// vid en omstart - appen behöver då ingen egen schemaläggare.
export async function GET(request: Request) {
  try {
    const bookId = new URL(request.url).searchParams.get('bookId');
    void resumeStaleJobs().catch(() => {});
    if (!bookId) return NextResponse.json({ job: null });
    return NextResponse.json({ job: await findJobForBook(bookId) });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Okänt fel';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
