import { NextRequest, NextResponse } from 'next/server';
import { regeneratePageImage } from '@/lib/gemini';
import { generatePageWithQualityCheck, DEFAULT_QUALITY_BUDGET_MS } from '@/lib/character-check';
import { Character, Spread, BookFormat, IllustrationShape, SpreadQualityCheck } from '@/lib/types';

// Den färdiga boken genereras i tryckupplösning
const BOOK_IMAGE_SIZE = '2K' as const;

// Generera → granska → rätta (max 3 bilder + 3 granskningar per uppslag).
// Loopen slutar starta nya försök vid DEFAULT_QUALITY_BUDGET_MS (250 s) så att svaret hinner ut.
export const maxDuration = 300;

// Batchen kör så här många uppslag parallellt - alla delar samma tidsbudget
const CONCURRENCY = 3;
// Ett uppslag som inte hunnit starta när mindre än så här återstår lämnas till nästa anrop
const MIN_TIME_TO_START_SPREAD_MS = 90_000;

// Batch endpoint: accepts multiple spreads
export async function POST(request: NextRequest) {
  const requestStart = Date.now();
  try {
    const body = await request.json();

    // Support both single and batch requests
    if (body.batch && Array.isArray(body.spreads)) {
      return handleBatch(body, requestStart);
    }

    return handleSingle(body, requestStart);
  } catch (error) {
    console.error('Page generation error:', error);
    const message = error instanceof Error ? error.message : 'Okänt fel';
    return NextResponse.json(
      { error: `Kunde inte generera sidbild: ${message}` },
      { status: 500 }
    );
  }
}

// Single spread generation (used for first generation and manual regeneration)
async function handleSingle(body: {
  spread: Spread;
  characters: Character[];
  styleGuide: string;
  bookFormat?: BookFormat;
  illustrationShape?: IllustrationShape;
  customInstructions?: string;
  isRegenerate?: boolean;
}, requestStart: number) {
  const { spread, characters, styleGuide, bookFormat, illustrationShape, customInstructions, isRegenerate } = body;
  const options = { shape: illustrationShape, imageSize: BOOK_IMAGE_SIZE };

  if (!spread || !characters) {
    return NextResponse.json(
      { error: 'Siddata eller karaktärer saknas' },
      { status: 400 }
    );
  }

  if (isRegenerate && customInstructions) {
    // Manual regeneration with user instructions - no auto-loop, the user is in control
    const imageBase64 = await regeneratePageImage(
      spread, characters, styleGuide || '', customInstructions, bookFormat, options
    );
    return NextResponse.json({ image: imageBase64 });
  }

  const result = await generatePageWithQualityCheck(
    spread, characters, styleGuide || '', bookFormat, options,
    { deadline: requestStart + DEFAULT_QUALITY_BUDGET_MS }
  );
  return NextResponse.json({
    image: result.image,
    check: result.check,
    qualityCheck: result.qualityCheck,
    attempts: result.attempts,
    autoFixed: result.autoFixed,
  });
}

// Batch generation: process multiple spreads in parallel
async function handleBatch(body: {
  spreads: Spread[];
  characters: Character[];
  styleGuide: string;
  bookFormat?: BookFormat;
  illustrationShape?: IllustrationShape;
}, requestStart: number) {
  const { spreads, characters, styleGuide, bookFormat, illustrationShape } = body;
  const options = { shape: illustrationShape, imageSize: BOOK_IMAGE_SIZE };
  const deadline = requestStart + DEFAULT_QUALITY_BUDGET_MS;

  if (!spreads || spreads.length === 0 || !characters) {
    return NextResponse.json(
      { error: 'Siddata eller karaktärer saknas' },
      { status: 400 }
    );
  }

  const results: Array<{
    id: string;
    image?: string;
    error?: string;
    check?: unknown;
    qualityCheck?: SpreadQualityCheck;
    attempts?: number;
    autoFixed?: boolean;
  }> = [];

  for (let i = 0; i < spreads.length; i += CONCURRENCY) {
    const chunk = spreads.slice(i, i + CONCURRENCY);

    const promises = chunk.map(async (spread, idx) => {
      // Stagger starts by 1.5s to avoid hitting rate limits simultaneously
      if (idx > 0) {
        await new Promise(r => setTimeout(r, idx * 1500));
      }

      // Fler uppslag än CONCURRENCY i samma anrop: starta inte ett nytt uppslag som
      // inte hinner bli klart - annars slår hela anropet i maxDuration och alla bilder förloras
      if (deadline - Date.now() < MIN_TIME_TO_START_SPREAD_MS) {
        return { id: spread.id, error: 'Hann inte genereras i denna omgång - generera igen' };
      }

      try {
        const result = await generatePageWithQualityCheck(
          spread, characters, styleGuide || '', bookFormat, options, { deadline }
        );
        return {
          id: spread.id,
          image: result.image,
          check: result.check,
          qualityCheck: result.qualityCheck,
          attempts: result.attempts,
          autoFixed: result.autoFixed,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Okänt fel';
        return { id: spread.id, error: message };
      }
    });

    const chunkResults = await Promise.allSettled(promises);

    chunkResults.forEach((result, idx) => {
      if (result.status === 'fulfilled') {
        results.push(result.value);
      } else {
        results.push({ id: chunk[idx].id, error: String(result.reason) });
      }
    });
  }

  return NextResponse.json({ results });
}
