import { NextRequest, NextResponse } from 'next/server';
import { generateCharacterSheet } from '@/lib/gemini';
import { Character } from '@/lib/types';

export const maxDuration = 120;

// Batch endpoint: accepts multiple characters
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Support both single and batch requests
    if (body.batch && Array.isArray(body.characters)) {
      return handleBatch(body);
    }

    return handleSingle(body);
  } catch (error) {
    console.error('Character generation error:', error);
    const message = error instanceof Error ? error.message : 'Okänt fel';
    return NextResponse.json(
      { error: `Kunde inte generera karaktärsbild: ${message}` },
      { status: 500 }
    );
  }
}

// Single character generation (existing behavior)
async function handleSingle(body: {
  character: Character;
  styleGuide: string;
}) {
  const { character, styleGuide } = body;

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
}

// Batch generation: process multiple characters in parallel
async function handleBatch(body: {
  characters: Character[];
  styleGuide: string;
}) {
  const { characters, styleGuide } = body;

  if (!characters || characters.length === 0) {
    return NextResponse.json(
      { error: 'Karaktärsdata saknas' },
      { status: 400 }
    );
  }

  // Process up to 3 at a time with staggered starts
  const CONCURRENCY = 3;
  const results: Array<{ id: string; image?: string; error?: string }> = [];

  for (let i = 0; i < characters.length; i += CONCURRENCY) {
    const chunk = characters.slice(i, i + CONCURRENCY);

    const promises = chunk.map(async (character, idx) => {
      // Stagger starts by 1.5s to avoid hitting rate limits simultaneously
      if (idx > 0) {
        await new Promise(r => setTimeout(r, idx * 1500));
      }

      try {
        const image = await generateCharacterSheet(
          character,
          styleGuide || 'Swedish children\'s book, manga/comic style, thick outlines, large expressive eyes'
        );
        return { id: character.id, image };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Okänt fel';
        return { id: character.id, error: message };
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
