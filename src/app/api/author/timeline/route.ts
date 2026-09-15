import { NextResponse } from 'next/server';
import { planTimeline, normalizeProject, AuthorInputError } from '@/lib/author-ai';
import type { TimelineRequest, TimelineResponse } from '@/lib/author-types';

export const maxDuration = 300;

// Marginal före maxDuration
const BUDGET_MS = 270_000;

// Fyller i eller gör om planen för kapitel som inte är skrivna. Skrivna kapitel ändras aldrig.
export async function POST(request: Request) {
  const startedAt = Date.now();
  try {
    const body = await request.json().catch(() => null) as Partial<TimelineRequest> | null;
    if (!body) {
      return NextResponse.json({ error: 'Ogiltig förfrågan' }, { status: 400 });
    }
    if (body.mode !== 'fill' && body.mode !== 'rework') {
      return NextResponse.json({ error: 'Välj om tidslinjen ska fyllas i eller göras om' }, { status: 400 });
    }
    const instruction = typeof body.instruction === 'string' ? body.instruction.trim().slice(0, 4000) : undefined;
    const project = normalizeProject(body.project);
    if (!project.premise && project.chapters.every(c => !c.text)) {
      return NextResponse.json({ error: 'Beskriv vad boken handlar om eller lägg in din början först' }, { status: 400 });
    }

    console.log(`[author/timeline] ${body.mode}: ${project.chapters.length} kapitel, mål ${project.settings.totalChapters}`);
    const result = await planTimeline(project, body.mode, instruction, startedAt + BUDGET_MS);
    console.log(`[author/timeline] ${result.chapters.length} kapitel planerade`);
    return NextResponse.json(result satisfies TimelineResponse);
  } catch (error) {
    if (error instanceof AuthorInputError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error('Planera tidslinjen misslyckades:', error);
    const message = error instanceof Error ? error.message : 'Okänt fel';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
