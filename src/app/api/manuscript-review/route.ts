import { NextResponse } from 'next/server';
import { reviewManuscript, ManuscriptReview } from '@/lib/claude';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Lektören läser hela manuset i ett anrop. Det tar en minut eller två, så det
// körs i bakgrunden och sidan frågar efter resultatet tills det är klart.

type Task = { state: 'running'; startedAt: number } | { state: 'done'; review: ManuscriptReview; at: number } | { state: 'failed'; error: string; at: number };
const tasks = new Map<string, Task>();
const KEEP_MS = 60 * 60 * 1000;

function prune() {
  const now = Date.now();
  tasks.forEach((task, id) => {
    const at = task.state === 'running' ? task.startedAt : task.at;
    if (now - at > KEEP_MS) tasks.delete(id);
  });
}

interface Body {
  title?: string;
  targetAge?: string;
  characters?: { name: string; role: string; note?: string }[];
  sections?: { spread: number; label: string; text: string }[];
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as Body | null;
  const sections = (body?.sections || []).filter(s => typeof s.text === 'string' && s.text.trim());
  if (!body?.title || sections.length === 0) {
    return NextResponse.json({ error: 'Manuset saknas' }, { status: 400 });
  }
  const words = sections.reduce((n, s) => n + s.text.split(/\s+/).length, 0);
  if (words > 60_000) return NextResponse.json({ error: 'Manuset är för långt för en läsning' }, { status: 400 });

  prune();
  const id = crypto.randomUUID();
  tasks.set(id, { state: 'running', startedAt: Date.now() });
  void reviewManuscript({
    title: body.title,
    targetAge: body.targetAge,
    characters: (body.characters || []).slice(0, 20),
    sections,
  })
    .then(review => {
      tasks.set(id, { state: 'done', review, at: Date.now() });
      console.log(`[Lektör] ${body.title}: ${review.issues.length} fynd`);
    })
    .catch(err => {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[Lektör] misslyckades:', message);
      tasks.set(id, { state: 'failed', error: message.slice(0, 300), at: Date.now() });
    });
  return NextResponse.json({ id, words });
}

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get('id') || '';
  const task = tasks.get(id);
  if (!task) return NextResponse.json({ state: 'missing' }, { status: 404 });
  return NextResponse.json(task);
}
