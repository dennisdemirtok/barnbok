import { NextResponse } from 'next/server';
import { buildRelease, releaseVersion, SPEC } from '@/lib/audio-export';
import { loadBookForJob, readAudioManifest, uploadFile } from '@/lib/job-queue';
import { narrationSegments } from '@/lib/tts';
import { voiceById } from '@/lib/tts-voices';
import { serverSupabase, SERVER_IMAGES_BUCKET } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Export för Spotify: mastrar ljudboken i bakgrunden (det tar en stund) och
// sparar filerna i molnet. Sidan frågar efter läget tills exporten är klar.

interface ExportManifest {
  version: string;
  createdAt: string;
  title: string;
  author?: string;
  narrator: string;
  seconds: number;
  specOk: boolean;
  spec: typeof SPEC;
  files: { name: string; url: string; bytes: number; seconds?: number; rms?: number; peak?: number }[];
  m4b?: { name: string; url: string; bytes: number; seconds?: number };
  cover?: { name: string; url: string; bytes: number };
}

type Progress = { state: 'running'; done: number; total: number; startedAt: number } | { state: 'failed'; error: string };
const running = new Map<string, Progress>();

const exportPath = (bookId: string) => `books/${bookId}/export/export.json`;
const publicUrl = (p: string) => serverSupabase().storage.from(SERVER_IMAGES_BUCKET).getPublicUrl(p).data.publicUrl;

async function readExport(bookId: string): Promise<ExportManifest | null> {
  const res = await fetch(`${publicUrl(exportPath(bookId))}?t=${Date.now()}`, { cache: 'no-store' }).catch(() => null);
  return res?.ok ? res.json().catch(() => null) : null;
}

async function currentState(bookId: string) {
  const [manifest, exported] = await Promise.all([readAudioManifest(bookId), readExport(bookId)]);
  const version = manifest?.parts?.length ? releaseVersion(manifest.parts.map(p => p.url)) : null;
  return {
    progress: running.get(bookId) ?? null,
    export: exported,
    // Exporten gäller inte längre om något kapitel lästs om efteråt
    upToDate: !!exported && exported.version === version,
  };
}

export async function GET(request: Request) {
  const bookId = new URL(request.url).searchParams.get('bookId');
  if (!bookId) return NextResponse.json({ error: 'bookId saknas' }, { status: 400 });
  return NextResponse.json(await currentState(bookId));
}

export async function POST(request: Request) {
  const { bookId } = await request.json().catch(() => ({})) as { bookId?: string };
  if (!bookId) return NextResponse.json({ error: 'bookId saknas' }, { status: 400 });
  const now = running.get(bookId);
  if (now?.state === 'running' && Date.now() - now.startedAt < 20 * 60 * 1000) {
    return NextResponse.json(await currentState(bookId));
  }

  const [book, manifest] = await Promise.all([loadBookForJob(bookId), readAudioManifest(bookId)]);
  if (!book || !manifest?.parts?.length) return NextResponse.json({ error: 'Ljudboken är inte inläst' }, { status: 400 });
  const segments = narrationSegments({ title: book.title, author: book.author, spreads: book.spreads });
  const parts = segments.map(seg => manifest.parts.find(p => p.index === seg.index));
  if (parts.some(p => !p)) return NextResponse.json({ error: 'Alla kapitel behöver vara inlästa före exporten' }, { status: 400 });

  const version = releaseVersion(manifest.parts.map(p => p.url));
  const cover = book.spreads.find(s => s.pages === 'omslag') as { imageUrl?: string } | undefined;
  const narrator = `${manifest.voice || voiceById(manifest.voiceId).name} (AI-röst, ElevenLabs)`;
  running.set(bookId, { state: 'running', done: 0, total: segments.length + 1, startedAt: Date.now() });

  // Själva arbetet fortsätter efter svaret
  void buildRelease({
    title: book.title,
    author: book.author,
    narrator,
    chapters: segments.map((seg, i) => ({ index: seg.index, label: seg.label, url: parts[i]!.url })),
    coverUrl: cover?.imageUrl,
    folder: `books/${bookId}/export/${version}`,
    upload: (p, data, type) => uploadFile(p, data, type),
    onProgress: (done, total) => running.set(bookId, { state: 'running', done, total, startedAt: Date.now() }),
  }).then(async result => {
    const out: ExportManifest = {
      version,
      createdAt: new Date().toISOString(),
      title: book.title,
      author: book.author,
      narrator,
      seconds: result.seconds,
      specOk: result.specOk,
      spec: SPEC,
      files: result.files.map(f => ({ name: f.name, url: publicUrl(f.path), bytes: f.bytes, seconds: f.seconds, rms: f.rms, peak: f.peak })),
      m4b: result.m4b ? { name: result.m4b.name, url: publicUrl(result.m4b.path), bytes: result.m4b.bytes, seconds: result.m4b.seconds } : undefined,
      cover: result.cover ? { name: result.cover.name, url: publicUrl(result.cover.path), bytes: result.cover.bytes } : undefined,
    };
    await uploadFile(exportPath(bookId), Buffer.from(JSON.stringify(out)), 'application/json', '0');
    running.delete(bookId);
    console.log(`[Export] ${book.title}: ${out.files.length} kapitel, krav uppfyllda: ${out.specOk}`);
  }).catch(err => {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[Export] misslyckades:', message);
    running.set(bookId, { state: 'failed', error: message.slice(0, 300) });
  });

  return NextResponse.json(await currentState(bookId));
}
