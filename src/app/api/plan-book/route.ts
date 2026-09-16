import { NextResponse } from 'next/server';
import { planManuscript, planComicBook, StyleTestCharacter } from '@/lib/claude';
import { fetchStyleProfile } from '@/lib/style-profiles';
import { getStylePreset, composeStyleGuide } from '@/lib/styles';
import { BookProject, Character, Spread } from '@/lib/types';
import { balanceCompositions } from '@/lib/compositions';
import { comicPageTarget, comicPagesToSpreads } from '@/lib/comic';

export const maxDuration = 300;

const MAX_CHARS = 150000;

type ManuscriptFormat = 'bildbok-separat-text' | 'kapitelbok' | 'bildbok-text-pa-bild';

// Gör en hel bok av ett fritt manus: Claude väljer uppslag, karaktärer och
// bildbeskrivningar - texten används ordagrant. Serieromaner görs om till seriesidor.
export async function POST(request: Request) {
  try {
    const { rawText, title, author, bookFormat, stylePresetId, imageWishes, targetAge } = await request.json() as {
      rawText?: string;
      title?: string;
      author?: string;
      bookFormat?: ManuscriptFormat;
      stylePresetId?: string;
      imageWishes?: string;
      targetAge?: string;
    };

    if (!rawText?.trim()) {
      return NextResponse.json({ error: 'Klistra in ditt manus först' }, { status: 400 });
    }
    if (rawText.length > MAX_CHARS) {
      return NextResponse.json(
        { error: `Manuset är för långt (${rawText.length.toLocaleString('sv-SE')} tecken, max ${MAX_CHARS.toLocaleString('sv-SE')}). Dela upp det i flera böcker.` },
        { status: 400 }
      );
    }
    const preset = getStylePreset(stylePresetId);
    if (!preset) {
      return NextResponse.json({ error: 'Välj en stil för boken' }, { status: 400 });
    }
    // Formatet följer stilens bokkoncept om inget annat anges
    const format: ManuscriptFormat = bookFormat ?? preset.book.format;

    // Ett stycke per rad - samma uppdelning som sättningen använder
    const paragraphs = rawText.split(/\n/).map(l => l.trim()).filter(Boolean);
    const words = rawText.split(/\s+/).filter(Boolean).length;
    const wishes = imageWishes?.trim();
    const profilePromise = preset.series ? fetchStyleProfile(preset.series) : Promise.resolve(null);

    const makeBook = (bookTitle: string, characters: Character[], spreads: Spread[], image_style?: string | null): BookProject => ({
      id: crypto.randomUUID(),
      title: bookTitle,
      author: author?.trim() || undefined,
      targetAge: targetAge || preset.book.age,
      bookFormat: format,
      stylePresetId: preset.id,
      illustrationShape: preset.shape,
      styleGuide: composeStyleGuide(preset, image_style)
        + (wishes ? `\n\nADDITIONAL WISHES FROM THE AUTHOR: ${wishes}` : ''),
      characters,
      spreads,
      status: 'importing',
      createdAt: new Date().toISOString(),
    });

    // ── Serieroman: varje boksida är en seriesida med rutor och pratbubblor ──
    if (format === 'bildbok-text-pa-bild') {
      const pageCount = comicPageTarget(words, preset.book.wordsPerImage);
      const [plan, profile] = await Promise.all([
        planComicBook(paragraphs, {
          title: title?.trim() || undefined,
          pages: pageCount,
          wordsPerImage: preset.book.wordsPerImage,
          targetAge: targetAge || preset.book.age,
          textStyle: preset.book.textStyle,
        }),
        profilePromise,
      ]);
      if (plan.pages.length === 0) throw new Error('Kunde inte göra några seriesidor av manuset - försök igen');

      const bookTitle = title?.trim() || plan.title || 'Namnlös bok';
      const characters = toCharacters(plan.characters);
      const spreads = comicPagesToSpreads(plan.pages, plan.characters, () => crypto.randomUUID());
      const book = makeBook(bookTitle, characters, [coverSpread(plan.coverPrompt, bookTitle), ...spreads], profile?.image_style);
      console.log(`[plan-book] serie "${bookTitle}": ${words} ord -> ${spreads.length} seriesidor (mål ${pageCount}), ${characters.length} karaktärer`);
      return NextResponse.json({ book });
    }

    // Antal bilder följer stilens textmängd per bild (±30 %)
    const perImage = preset.book.wordsPerImage;
    const minSpreads = clamp(Math.round(words / (perImage * 1.3)), 1, 40);
    const maxSpreads = clamp(Math.round(words / (perImage * 0.7)), minSpreads + 1, 48);

    const [plan, profile] = await Promise.all([
      planManuscript(paragraphs, { bookFormat: format, title: title?.trim() || undefined, minSpreads, maxSpreads, compositionMix: preset.book.compositionMix }),
      profilePromise,
    ]);

    // Styckestarter: stigande, inom manuset, och första uppslaget börjar på stycke 1
    const starts = Array.from(new Set(
      plan.spreads
        .map(s => Math.round(s.startParagraph))
        .filter(n => n >= 1 && n <= paragraphs.length)
    )).sort((a, b) => a - b);
    if (starts[0] !== 1) starts.unshift(1);
    const promptFor = new Map(plan.spreads.map(s => [Math.round(s.startParagraph), s.imagePrompt]));
    const compositionWish = new Map(plan.spreads.map(s => [Math.round(s.startParagraph), s.composition]));

    const bookTitle = title?.trim() || plan.title || 'Namnlös bok';
    const characters = toCharacters(plan.characters);

    // AI:ns val av bildtyp, justerat så att blandningen håller genom hela boken
    const mix = preset.book.compositionMix;
    const compositions = mix ? balanceCompositions(starts.map(st => compositionWish.get(st)), mix, bookTitle) : undefined;
    const spreads: Spread[] = starts.map((start, i) => {
      const end = i + 1 < starts.length ? starts[i + 1] - 1 : paragraphs.length;
      return {
        id: crypto.randomUUID(),
        spreadNumber: i + 1,
        pages: `${6 + i * 2}-${7 + i * 2}`,
        textBlocks: paragraphs.slice(start - 1, end).map((text, j) => ({ position: `stycke ${j + 1}`, text })),
        imagePrompt: promptFor.get(start) || plan.spreads[i]?.imagePrompt || plan.coverPrompt,
        composition: compositions?.[i],
        status: 'pending',
      };
    });

    const book = makeBook(bookTitle, characters, [coverSpread(plan.coverPrompt, bookTitle), ...spreads], profile?.image_style);
    console.log(`[plan-book] "${bookTitle}": ${paragraphs.length} stycken, ${words} ord -> ${spreads.length} uppslag, ${characters.length} karaktärer`);
    return NextResponse.json({ book });
  } catch (error) {
    console.error('Manusplanering misslyckades:', error);
    const message = error instanceof Error ? error.message : 'Okänt fel';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// Fler än så blir ohanterligt för författaren: varje karaktär ska godkännas
// med en egen bild, och statister ritas ändå från bildprompten
const MAX_CHARACTERS = 8;

function toCharacters(planned: StyleTestCharacter[]): Character[] {
  const main = planned.filter(c => c.role === 'main');
  const rest = planned.filter(c => c.role !== 'main');
  return [...main, ...rest].slice(0, MAX_CHARACTERS).map((c, i) => ({
    id: crypto.randomUUID(),
    name: c.name,
    age: c.age,
    appearance: c.appearance,
    normalClothes: c.normalClothes,
    personality: c.personality,
    // En bok måste ha en huvudperson
    role: c.role === 'main' || (i === 0 && !planned.some(x => x.role === 'main')) ? 'main' : 'supporting',

    approved: false,
  }));
}

function coverSpread(coverPrompt: string, bookTitle: string): Spread {
  return {
    id: crypto.randomUUID(),
    spreadNumber: 0,
    pages: 'omslag',
    textBlocks: [],
    imagePrompt: `${coverPrompt}\n\nThe exact Swedish title text on the cover is: "${bookTitle}"`,
    status: 'pending',
  };
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}
