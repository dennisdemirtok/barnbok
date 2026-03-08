import { NextRequest, NextResponse } from 'next/server';
import { generateCharacterSheet } from '@/lib/gemini';
import { Character } from '@/lib/types';

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const { character, styleGuide } = await request.json() as {
      character: Character;
      styleGuide: string;
    };

    if (!character) {
      return NextResponse.json(
        { error: 'Karaktärsdata saknas' },
        { status: 400 }
      );
    }

    const imageBase64 = await generateCharacterSheet(
      character,
      styleGuide || 'Swedish children\'s book, manga/comic style, thick outlines, large expressive eyes'
    );

    return NextResponse.json({ image: imageBase64 });
  } catch (error) {
    console.error('Character generation error:', error);
    const message = error instanceof Error ? error.message : 'Okänt fel';
    return NextResponse.json(
      { error: `Kunde inte generera karaktärsbild: ${message}` },
      { status: 500 }
    );
  }
}
