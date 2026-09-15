import { NextRequest, NextResponse } from 'next/server';
import { checkCharacterConsistency, reviewPageImage, reviewToCheckResult } from '@/lib/character-check';
import { Character, Spread, BookFormat, IllustrationShape } from '@/lib/types';

// Granskning med referensbilder kan ta en stund
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  try {
    const { generatedImage, characters, spread, bookFormat, illustrationShape } = await request.json() as {
      generatedImage: string;
      characters: Character[];
      // Valfritt: med uppslaget granskas bilden mot scenens prompt, format och bildform
      spread?: Spread;
      bookFormat?: BookFormat;
      illustrationShape?: IllustrationShape;
    };

    if (!generatedImage || !characters) {
      return NextResponse.json(
        { error: 'Bild och karaktärer krävs' },
        { status: 400 }
      );
    }

    if (spread) {
      const review = await reviewPageImage(
        generatedImage,
        { spread, characters, bookFormat, shape: illustrationShape },
        { timeoutMs: 100_000 }
      );
      return NextResponse.json(reviewToCheckResult(review));
    }

    if (characters.length === 0) {
      return NextResponse.json(
        { error: 'Bild och karaktärer krävs' },
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
