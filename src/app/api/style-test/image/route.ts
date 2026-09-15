import { NextResponse } from 'next/server';
import { generatePageImage } from '@/lib/gemini';
import { BookFormat, Character, IllustrationShape, Spread } from '@/lib/types';

export const maxDuration = 300;

// En enskild testbild: samma sida i en viss stil. Inga referensbilder finns
// ännu, så karaktärernas utseende skickas med i bildbeskrivningen.
export async function POST(request: Request) {
  try {
    const { spread, characters, styleGuide, bookFormat, illustrationShape } = await request.json() as {
      spread: Spread;
      characters?: Character[];
      styleGuide: string;
      bookFormat?: BookFormat;
      illustrationShape?: IllustrationShape;
    };

    if (!spread || !styleGuide) {
      return NextResponse.json({ error: 'Sida eller stil saknas' }, { status: 400 });
    }

    const roster = (characters || [])
      .map(c => `- ${c.name}${c.age ? ` (${c.age})` : ''}: ${c.appearance}${c.normalClothes ? ` Clothes: ${c.normalClothes}.` : ''}`)
      .join('\n');

    // Bara identifierande drag (ålder, hår, kläder) låses - ansikten och
    // proportioner ska ritas i stilens eget figurspråk
    const spreadWithRoster: Spread = roster
      ? { ...spread, imagePrompt: `${spread.imagePrompt}\n\nCHARACTERS - keep only these identifying traits consistent (age, hair color and cut, clothing colors). Draw their faces, proportions and anatomy entirely in the character design language of the style guide:\n${roster}` }
      : spread;

    // Provningar görs i 1K för att gå fort och billigt
    const image = await generatePageImage(spreadWithRoster, [], styleGuide, bookFormat, {
      shape: illustrationShape,
      imageSize: '1K',
    });
    return NextResponse.json({ image });
  } catch (error) {
    console.error('Stilprovning (bild) misslyckades:', error);
    const message = error instanceof Error ? error.message : 'Okänt fel';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
