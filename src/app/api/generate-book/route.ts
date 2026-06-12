import { NextResponse } from 'next/server';
import { generateBookContent, BookConfig } from '@/lib/claude';
import { parseBookData } from '@/lib/parser';

export const maxDuration = 120; // 2 minutes for long book generation

// Hämta stilprofil (byggd från analyserade referensböcker) från Supabase
async function fetchStyleProfile(series: string): Promise<{ text_style?: string; image_style?: string } | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  try {
    const res = await fetch(
      `${url}/rest/v1/barnbok_style_profiles?book_series=eq.${encodeURIComponent(series)}&select=text_style,image_style`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    if (!res.ok) return null;
    const rows = await res.json();
    return rows[0] || null;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  try {
    const config: BookConfig = await request.json();

    if (!config.title) {
      return NextResponse.json({ error: 'Titel kravs' }, { status: 400 });
    }

    // Berika med stilprofil från referensböcker om en serie är vald
    if (config.styleSeries) {
      const profile = await fetchStyleProfile(config.styleSeries);
      if (profile) {
        console.log(`[generate-book] Använder stilprofil "${config.styleSeries}"`);
        if (profile.image_style) config.imageStyle = profile.image_style;
        if (profile.text_style) config.textStyleNotes = profile.text_style;
      }
    }

    // Generate book content with Claude
    console.log(`[generate-book] Skapar bok: "${config.title}" (${config.bookFormat})`);
    const rawBookText = await generateBookContent(config);
    console.log(`[generate-book] Claude returnerade ${rawBookText.length} tecken`);

    // Log first 500 chars for debugging
    console.log('[generate-book] Första 500 tecken:', rawBookText.substring(0, 500));

    // Parse the generated content using the same parser
    const book = parseBookData(rawBookText);

    // Set the book format from the config
    book.bookFormat = config.bookFormat;

    // Use the chosen (possibly profile-enriched) image style for ALL page
    // generation - previously the parser's generic default overrode the
    // user's choice so picked styles never reached the images
    if (config.imageStyle) {
      book.styleGuide = config.imageStyle;
    }

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
    const message = error instanceof Error ? error.message : 'Okänt fel';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
