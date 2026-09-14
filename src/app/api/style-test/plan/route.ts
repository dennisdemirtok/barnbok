import { NextResponse } from 'next/server';
import { planStyleTest } from '@/lib/claude';
import { fetchStyleProfile } from '@/lib/style-profiles';
import { STYLE_PRESETS } from '@/lib/styles';

export const maxDuration = 300;

const MAX_CHARS = 30000;

export async function POST(request: Request) {
  try {
    const { rawText, numScenes, title } = await request.json() as {
      rawText?: string;
      numScenes?: number;
      title?: string;
    };

    if (!rawText?.trim()) {
      return NextResponse.json({ error: 'Klistra in en text först' }, { status: 400 });
    }
    if (rawText.length > MAX_CHARS) {
      return NextResponse.json(
        { error: `Texten är för lång (${rawText.length.toLocaleString('sv-SE')} tecken). Använd bara början av boken, max ${MAX_CHARS.toLocaleString('sv-SE')} tecken.` },
        { status: 400 }
      );
    }
    const scenes = Math.min(6, Math.max(1, Math.round(numScenes || 3)));

    // Analysera texten och hämta stilprofilerna parallellt
    const [plan, profiles] = await Promise.all([
      planStyleTest(rawText, scenes, title?.trim() || undefined),
      Promise.all(STYLE_PRESETS.map(async s => ({
        id: s.id,
        profile: s.series ? await fetchStyleProfile(s.series) : null,
      }))),
    ]);

    // Kalibrerad bildstil från referensanalysen när den finns, annars stilens beskrivning
    const styleGuides: Record<string, string> = {};
    for (const s of STYLE_PRESETS) {
      const profile = profiles.find(p => p.id === s.id)?.profile;
      styleGuides[s.id] = profile?.image_style || s.value;
    }

    return NextResponse.json({ plan, styleGuides });
  } catch (error) {
    console.error('Stilprovning (plan) misslyckades:', error);
    const message = error instanceof Error ? error.message : 'Okänt fel';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
