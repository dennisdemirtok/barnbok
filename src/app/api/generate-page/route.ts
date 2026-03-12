import { NextRequest, NextResponse } from 'next/server';
import { generatePageImage, regeneratePageImage } from '@/lib/gemini';
import { Character, Spread, BookFormat } from '@/lib/types';

export const maxDuration = 120;

// Batch endpoint: accepts multiple spreads
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Support both single and batch requests
    if (body.batch && Array.isArray(body.spreads)) {
      return handleBatch(body);
    }

    return handleSingle(body);
  } catch (error) {
    console.error('Page generation error:', error);
    const message = error instanceof Error ? error.message : 'Okänt fel';
    return NextResponse.json(
      { error: `Kunde inte generera sidbild: ${message}` },
      { status: 500 }
    );
  }
}

// Single spread generation (existing behavior)
async function handleSingle(body: {
  spread: Spread;
  characters: Character[];
  styleGuide: string;
  bookFormat?: BookFormat;
  customInstructions?: string;
  isRegenerate?: boolean;
}) {
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
      spread, characters, styleGuide || '', customInstructions, bookFormat
    );
  } else {
    imageBase64 = await generatePageImage(
      spread, characters, styleGuide || '', bookFormat
    );
  }

  return NextResponse.json({ image: imageBase64 });
}

// Batch generation: process multiple spreads in parallel
async function handleBatch(body: {
  spreads: Spread[];
  characters: Character[];
  styleGuide: string;
  bookFormat?: BookFormat;
}) {
  const { spreads, characters, styleGuide, bookFormat } = body;

  if (!spreads || spreads.length === 0 || !characters) {
    return NextResponse.json(
      { error: 'Siddata eller karaktarer saknas' },
      { status: 400 }
    );
  }

  // Process up to 3 at a time with staggered starts
  const CONCURRENCY = 3;
  const results: Array<{ id: string; image?: string; error?: string }> = [];

  for (let i = 0; i < spreads.length; i += CONCURRENCY) {
    const chunk = spreads.slice(i, i + CONCURRENCY);

    const promises = chunk.map(async (spread, idx) => {
      // Stagger starts by 1.5s to avoid hitting rate limits simultaneously
      if (idx > 0) {
        await new Promise(r => setTimeout(r, idx * 1500));
      }

      try {
        const image = await generatePageImage(
          spread, characters, styleGuide || '', bookFormat
        );
        return { id: spread.id, image };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Okänt fel';
        return { id: spread.id, error: message };
      }
    });

    const chunkResults = await Promise.allSettled(promises);

    for (const result of chunkResults) {
      if (result.status === 'fulfilled') {
        results.push(result.value);
      } else {
        results.push({ id: 'unknown', error: String(result.reason) });
      }
    }
  }

  return NextResponse.json({ results });
}
