import { NextResponse } from 'next/server';
import { generateBookContent, BookConfig } from '@/lib/claude';
import { parseBookData } from '@/lib/parser';
import { fetchStyleProfile, fetchLanguageExamples } from '@/lib/style-profiles';
import { getStylePreset, composeStyleGuide } from '@/lib/styles';

export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const config: BookConfig = await request.json();

    if (!config.title) {
      return NextResponse.json({ error: 'Titel krävs' }, { status: 400 });
    }

    // Vald stil: art direction + analys av riktiga böcker + författarens egna önskemål
    const preset = getStylePreset(config.stylePresetId);
    const series = preset?.series || config.styleSeries;
    const authorWishes = config.imageStyle?.trim();
    let profileImageStyle: string | undefined;

    if (series) {
      const [profile, examples] = await Promise.all([
        fetchStyleProfile(series),
        fetchLanguageExamples(series),
      ]);
      if (profile) {
        console.log(`[generate-book] Använder stilprofil "${series}"`);
        profileImageStyle = profile.image_style;
        if (profile.text_style) config.textStyleNotes = profile.text_style;
      }
      if (examples.length > 0) {
        console.log(`[generate-book] ${examples.length} språkexempel som förebilder`);
        config.languageExamples = examples;
      }
    }

    // Claude får stilens koncept för stämningen - själva ritstilen läggs på i bildsteget
    if (preset) {
      config.imageStyle = `${preset.label} – ${preset.concept}${authorWishes ? `. Önskemål: ${authorWishes}` : ''}`;
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
    book.targetAge = config.targetAge;

    // Stilen som ALL bildgenerering använder (parserns generiska standard får aldrig vinna)
    if (preset) {
      book.styleGuide = composeStyleGuide(preset, profileImageStyle)
        + (authorWishes ? `\n\nADDITIONAL WISHES FROM THE AUTHOR: ${authorWishes}` : '');
      book.stylePresetId = preset.id;
      // Serie- och läroboksformat ritar text i bilden och behåller uppslagsform
      if (config.bookFormat === 'bildbok-separat-text' || config.bookFormat === 'kapitelbok') {
        book.illustrationShape = preset.shape;
      }
    } else if (authorWishes) {
      book.styleGuide = authorWishes;
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
