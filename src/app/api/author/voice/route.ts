import { NextResponse } from 'next/server';
import { analyzeVoice, AuthorInputError, VOICE_MAX_CHARS } from '@/lib/author-ai';
import { countWords } from '@/lib/claude';
import type { VoiceRequest, VoiceResponse } from '@/lib/author-types';

export const maxDuration = 300;

// Marginal före maxDuration
const BUDGET_MS = 270_000;

// Analyserar hur författaren skriver ur författarens egen text
export async function POST(request: Request) {
  const startedAt = Date.now();
  try {
    const body = await request.json().catch(() => null) as Partial<VoiceRequest> | null;
    const text = typeof body?.text === 'string' ? body.text.trim() : '';
    if (!text) {
      return NextResponse.json({ error: 'Klistra in din egen text först' }, { status: 400 });
    }
    if (text.length > VOICE_MAX_CHARS) {
      return NextResponse.json({ error: 'Texten är för lång - klistra in de första kapitlen' }, { status: 400 });
    }
    const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 120) || undefined : undefined;

    console.log(`[author/voice] analyserar ${countWords(text)} ord`);
    const voice = await analyzeVoice(text, name, startedAt + BUDGET_MS);
    console.log(`[author/voice] "${voice.name}": ${voice.profile.tense}, markering ${JSON.stringify(voice.profile.dialogueMarker)}, ${voice.samples.length} utdrag`);
    return NextResponse.json({ voice } satisfies VoiceResponse);
  } catch (error) {
    if (error instanceof AuthorInputError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error('Analys av författarspråk misslyckades:', error);
    const message = error instanceof Error ? error.message : 'Okänt fel';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
