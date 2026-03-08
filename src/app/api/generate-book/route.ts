import { NextResponse } from 'next/server';
import { generateBookContent, BookConfig } from '@/lib/claude';
import { parseBookData } from '@/lib/parser';

export const maxDuration = 120; // 2 minutes for long book generation

export async function POST(request: Request) {
  try {
    const config: BookConfig = await request.json();

    if (!config.title) {
      return NextResponse.json({ error: 'Titel kravs' }, { status: 400 });
    }

    // Generate book content with Claude
    console.log(`[generate-book] Skapar bok: "${config.title}" (${config.bookFormat})`);
    const rawBookText = await generateBookContent(config);
    console.log(`[generate-book] Claude returnerade ${rawBookText.length} tecken`);

    // Log first 500 chars for debugging
    console.log('[generate-book] Forsta 500 tecken:', rawBookText.substring(0, 500));

    // Parse the generated content using the same parser
    const book = parseBookData(rawBookText);

    // Set the book format from the config
    book.bookFormat = config.bookFormat;

    console.log(`[generate-book] Parsningsresultat: ${book.characters.length} karaktarer, ${book.spreads.length} uppslag`);

    // Warn if parsing looks empty
    if (book.characters.length === 0 || book.spreads.length === 0) {
      console.warn('[generate-book] VARNING: Parsningen hittade fa resultat!');
      console.warn('[generate-book] Karaktarer:', book.characters.length);
      console.warn('[generate-book] Uppslag:', book.spreads.length);
      // Still return the raw text so the user can see what Claude generated
    }

    // Return both the parsed book and the raw text (for debugging/editing)
    return NextResponse.json({
      book,
      rawText: rawBookText,
    });
  } catch (error) {
    console.error('Bokgenerering misslyckades:', error);
    const message = error instanceof Error ? error.message : 'Okant fel';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
