import { NextRequest, NextResponse } from 'next/server';
import { checkCharacterConsistency } from '@/lib/character-check';
import { Character } from '@/lib/types';

export const maxDuration = 30;

export async function POST(request: NextRequest) {
  try {
    const { generatedImage, characters } = await request.json() as {
      generatedImage: string;
      characters: Character[];
    };

    if (!generatedImage || !characters || characters.length === 0) {
      return NextResponse.json(
        { error: 'Bild och karaktarer kravs' },
        { status: 400 }
      );
    }

    const analysis = await checkCharacterConsistency(generatedImage, characters);
    return NextResponse.json(analysis);
  } catch (error) {
    console.error('Character check error:', error);
    const message = error instanceof Error ? error.message : 'Okänt fel';
    return NextResponse.json(
      { error: `Karaktarskontroll misslyckades: ${message}` },
      { status: 500 }
    );
  }
}
