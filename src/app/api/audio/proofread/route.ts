import { NextResponse } from 'next/server';
import { analyzeMp3 } from '@/lib/audio-check';
import { isSystematic, proofreadAudio } from '@/lib/audio-proof';
import { loadBookForJob, patchAudioManifestPart, readAudioManifest } from '@/lib/job-queue';
import { loadPronunciations } from '@/lib/pronunciations';
import { narrationSegments } from '@/lib/tts';

export const dynamic = 'force-dynamic';
export const maxDuration = 180;

// Korrekturlyssnar ett kapitel som redan är inläst (t.ex. inläst innan
// korrekturlyssningen fanns). Kostar inga ElevenLabs-krediter - Gemini lyssnar
// på ljudet som redan finns. Resultatet sparas i innehållsförteckningen.
export async function POST(request: Request) {
  try {
    const { bookId, index } = await request.json() as { bookId?: string; index?: number };
    if (!bookId || typeof index !== 'number') return NextResponse.json({ error: 'bookId och index behövs' }, { status: 400 });

    const [book, manifest, rules] = await Promise.all([
      loadBookForJob(bookId),
      readAudioManifest(bookId),
      loadPronunciations(bookId).catch(() => []),
    ]);
    const part = manifest?.parts.find(p => p.index === index);
    if (!book || !part) return NextResponse.json({ error: 'Kapitlet är inte inläst' }, { status: 404 });
    const segment = narrationSegments({ title: book.title, author: book.author, spreads: book.spreads }).find(s => s.index === index);
    if (!segment) return NextResponse.json({ error: 'Kapitlet finns inte längre i texten' }, { status: 404 });

    const audio = Buffer.from(await (await fetch(part.url, { cache: 'no-store' })).arrayBuffer());
    const notes = rules.map(r => `"${r.word}" sägs som "${r.sayAs}"`);
    const [proof, check] = await Promise.all([proofreadAudio(audio, segment.text, notes), analyzeMp3(audio)]);
    if (!proof) return NextResponse.json({ error: 'Korrekturlyssningen gick inte att göra just nu' }, { status: 502 });

    const result = {
      floor: check?.floor,
      issues: proof.issues.filter(i => i.severity === 'major' || isSystematic(i, proof.issues)),
      checked: true,
      fixed: 0,
      overall: proof.overall,
    };
    await patchAudioManifestPart(bookId, index, { proof: result });
    return NextResponse.json({ proof: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okänt fel';
    return NextResponse.json({ error: `Korrekturlyssningen misslyckades: ${message}` }, { status: 500 });
  }
}
