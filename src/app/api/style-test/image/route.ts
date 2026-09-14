import { NextResponse } from 'next/server';
import { generatePageImage } from '@/lib/gemini';
import { BookFormat, Character, Spread } from '@/lib/types';

export const maxDuration = 300;

// En enskild testbild: samma sida i en viss stil. Inga referensbilder finns
// ännu, så karaktärernas utseende skickas med i bildbeskrivningen.
export async function POST(request: Request) {
  try {
    const { spread, characters, styleGuide, bookFormat } = await request.json() as {
      spread: Spread;
      characters?: Character[];
      styleGuide: string;
      bookFormat?: BookFormat;
    };

    if (!spread || !styleGuide) {
      return NextResponse.json({ error: 'Sida eller stil saknas' }, { status: 400 });
    }

    const roster = (characters || [])
      .map(c => `- ${c.name}${c.age ? ` (${c.age})` : ''}: ${c.appearance}${c.normalClothes ? ` Clothes: ${c.normalClothes}.` : ''}`)
      .join('\n');

    const spreadWithRoster: Spread = roster
      ? { ...spread, imagePrompt: `${spread.imagePrompt}\n\nCHARACTER DESIGNS (keep every character exactly like this):\n${roster}` }
      : spread;

    const image = await generatePageImage(spreadWithRoster, [], styleGuide, bookFormat);
    return NextResponse.json({ image });
  } catch (error) {
    console.error('Stilprovning (bild) misslyckades:', error);
    const message = error instanceof Error ? error.message : 'Okänt fel';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
