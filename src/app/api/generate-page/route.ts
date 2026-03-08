import { NextRequest, NextResponse } from 'next/server';
import { generatePageImage, regeneratePageImage } from '@/lib/gemini';
import { Character, Spread, BookFormat } from '@/lib/types';

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as {
      spread: Spread;
      characters: Character[];
      styleGuide: string;
      bookFormat?: BookFormat;
      customInstructions?: string;
      isRegenerate?: boolean;
    };

    const { spread, characters, styleGuide, bookFormat, customInstructions, isRegenerate } = body;

    if (!spread || !characters) {
      return NextResponse.json(
        { error: 'Siddata eller karaktarer saknas' },
        { status: 400 }
      );
    }

    let imageBase64: string;

    if (isRegenerate && customInstructions) {
      imageBase64 = await regeneratePageImage(
        spread,
        characters,
        styleGuide || '',
        customInstructions,
        bookFormat
      );
    } else {
      imageBase64 = await generatePageImage(
        spread,
        characters,
        styleGuide || '',
        bookFormat
      );
    }

    return NextResponse.json({ image: imageBase64 });
  } catch (error) {
    console.error('Page generation error:', error);
    const message = error instanceof Error ? error.message : 'Okant fel';
    return NextResponse.json(
      { error: `Kunde inte generera sidbild: ${message}` },
      { status: 500 }
    );
  }
}
