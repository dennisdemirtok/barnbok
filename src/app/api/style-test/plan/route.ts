import { NextResponse } from 'next/server';
import { planStyleTest, StyleTestPlan, StyleTestScene, StyleTestSplitRequest } from '@/lib/claude';
import { fetchStyleProfile } from '@/lib/style-profiles';
import { STYLE_PRESETS, composeStyleGuide } from '@/lib/styles';

export const maxDuration = 300;

const MAX_CHARS = 150000;
// En provning visar början av boken: upp till fyra sidor per stil
const MAX_TEST_PAGES = 4;

export async function POST(request: Request) {
  try {
    const { rawText, title } = await request.json() as { rawText?: string; title?: string };

    if (!rawText?.trim()) {
      return NextResponse.json({ error: 'Klistra in en text först' }, { status: 400 });
    }
    if (rawText.length > MAX_CHARS) {
      return NextResponse.json(
        { error: `Texten är för lång (${rawText.length.toLocaleString('sv-SE')} tecken, max ${MAX_CHARS.toLocaleString('sv-SE')}).` },
        { status: 400 }
      );
    }

    const paragraphs = rawText.split(/\n/).map(l => l.trim()).filter(Boolean);
    const wordCounts = paragraphs.map(p => p.split(/\s+/).filter(Boolean).length);

    // Varje stil provas på så mycket text som ryms på dess testsidor
    const splitFor = new Map<string, StyleTestSplitRequest>();
    const keyOf: Record<string, string> = {};
    for (const s of STYLE_PRESETS) {
      const budget = s.book.wordsPerImage * MAX_TEST_PAGES;
      let words = 0;
      let last = 0;
      while (last < paragraphs.length && (last === 0 || words + wordCounts[last] <= budget * 1.15)) {
        words += wordCounts[last];
        last++;
      }
      const count = Math.min(MAX_TEST_PAGES, last, Math.max(1, Math.round(words / s.book.wordsPerImage)));
      const key = `${last}x${count}`;
      if (!splitFor.has(key)) splitFor.set(key, { key, lastParagraph: last, count });
      keyOf[s.id] = key;
    }
    const maxParagraph = Math.max(...Array.from(splitFor.values()).map(sp => sp.lastParagraph));

    // Analysera texten och hämta stilprofilerna parallellt
    const [raw, profiles] = await Promise.all([
      planStyleTest(paragraphs.slice(0, maxParagraph), Array.from(splitFor.values()), title?.trim() || undefined),
      Promise.all(STYLE_PRESETS.map(async s => ({
        id: s.id,
        profile: s.series ? await fetchStyleProfile(s.series) : null,
      }))),
    ]);

    // Bygg scenerna ordagrant ur manuset
    const scenesForKey = new Map<string, StyleTestScene[]>();
    for (const req of Array.from(splitFor.values())) {
      const planned = raw.splits.find(sp => sp.key === req.key)?.scenes ?? [];
      const starts = Array.from(new Set(
        planned.map(sc => Math.round(sc.startParagraph)).filter(n => n >= 1 && n <= req.lastParagraph)
      )).sort((a, b) => a - b);
      if (starts[0] !== 1) starts.unshift(1);
      scenesForKey.set(req.key, starts.map((start, i) => {
        const end = i + 1 < starts.length ? starts[i + 1] - 1 : req.lastParagraph;
        const source = planned.find(sc => Math.round(sc.startParagraph) === start) ?? planned[i];
        return {
          label: source?.label || `Sida ${i + 1}`,
          text: paragraphs.slice(start - 1, end).join('\n\n'),
          imagePrompt: source?.imagePrompt || raw.coverPrompt,
        };
      }));
    }

    const scenesByStyle: Record<string, StyleTestScene[]> = {};
    for (const s of STYLE_PRESETS) scenesByStyle[s.id] = scenesForKey.get(keyOf[s.id]) ?? [];
    const longest = Object.values(scenesByStyle).sort((a, b) => b.length - a.length)[0] ?? [];

    const plan: StyleTestPlan = {
      title: raw.title,
      characters: raw.characters,
      coverPrompt: raw.coverPrompt,
      scenes: longest,
      scenesByStyle,
    };

    // Stilens egen art direction, kompletterad med analysen av riktiga böcker när den finns
    const styleGuides: Record<string, string> = {};
    for (const s of STYLE_PRESETS) {
      const profile = profiles.find(p => p.id === s.id)?.profile;
      styleGuides[s.id] = composeStyleGuide(s, profile?.image_style);
    }

    return NextResponse.json({ plan, styleGuides });
  } catch (error) {
    console.error('Stilprovning (plan) misslyckades:', error);
    const message = error instanceof Error ? error.message : 'Okänt fel';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
