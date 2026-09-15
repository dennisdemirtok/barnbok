import { NextResponse } from 'next/server';
import { writeBookBeginning, countWords, WritingStyleRef } from '@/lib/claude';
import { fetchStyleProfile, fetchLanguageExamples } from '@/lib/style-profiles';
import { getStylePreset } from '@/lib/styles';

export const maxDuration = 300;

// Skriver disposition för hela boken + bara början, så att författaren kan
// granska texten och prova bilderna innan resten skrivs
export async function POST(request: Request) {
  try {
    const body = await request.json() as {
      stylePresetId?: string;
      targetAge?: string;
      title?: string;
      plot?: string;
      setting?: string;
      characterNotes?: string;
      characters?: { name: string; appearance?: string; personality?: string }[];
    };

    const preset = getStylePreset(body.stylePresetId);
    if (!preset) {
      return NextResponse.json({ error: 'Välj en boktyp först' }, { status: 400 });
    }
    const plot = body.plot?.trim();
    if (!plot) {
      return NextResponse.json({ error: 'Beskriv vad boken handlar om – eller slumpa en handling' }, { status: 400 });
    }

    const style = await loadWritingStyle(preset.series);
    console.log(`[write-beginning] ${preset.label}: skriver början (${preset.book.targetWords} ord totalt)`);

    const result = await writeBookBeginning({
      preset,
      targetAge: body.targetAge?.trim() || preset.book.age,
      title: body.title?.trim().slice(0, 200) || undefined,
      plot: plot.slice(0, 4000),
      setting: body.setting?.trim().slice(0, 1000) || undefined,
      characterNotes: body.characterNotes?.trim().slice(0, 4000) || undefined,
      characters: Array.isArray(body.characters) ? body.characters.slice(0, 20) : undefined,
      style,
    });

    console.log(`[write-beginning] "${result.title}": ${countWords(result.rawText)} ord`);
    return NextResponse.json(result);
  } catch (error) {
    console.error('Skriva början misslyckades:', error);
    const message = error instanceof Error ? error.message : 'Okänt fel';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// Skrivstil + språkexempel från analyserade böcker i samma serie (som generate-book)
async function loadWritingStyle(series?: string): Promise<WritingStyleRef> {
  if (!series) return {};
  const [profile, examples] = await Promise.all([
    fetchStyleProfile(series),
    fetchLanguageExamples(series),
  ]);
  return {
    textStyleNotes: profile?.text_style || undefined,
    languageExamples: examples.length > 0 ? examples : undefined,
  };
}
