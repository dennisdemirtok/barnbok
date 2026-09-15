import { NextResponse } from 'next/server';
import { continueBook, countWords, WritingStyleRef } from '@/lib/claude';
import { fetchStyleProfile, fetchLanguageExamples } from '@/lib/style-profiles';
import { getStylePreset } from '@/lib/styles';
import { normalizeVoice } from '@/lib/author-ai';

export const maxDuration = 300;

// Marginal före maxDuration: skrivandet avbryts här och det som hunnit skrivas returneras
const WRITE_BUDGET_MS = 270_000;
const MAX_CHARS = 150000;

// Skriver resten av boken efter författarens (ev. redigerade) början.
// Returnerar bara fortsättningen. truncated: true = boken är inte klar -
// anropa igen med början + fortsättning som rawText för att skriva vidare.
export async function POST(request: Request) {
  const startedAt = Date.now();
  try {
    const body = await request.json() as {
      stylePresetId?: string;
      targetAge?: string;
      title?: string;
      outline?: string;
      rawText?: string;
      voice?: unknown; // författarspråk { profile, samples } - går före seriens språkexempel
    };

    const preset = getStylePreset(body.stylePresetId);
    if (!preset) {
      return NextResponse.json({ error: 'Välj en boktyp först' }, { status: 400 });
    }
    const rawText = body.rawText?.trim();
    if (!rawText) {
      return NextResponse.json({ error: 'Bokens början saknas' }, { status: 400 });
    }
    if (rawText.length > MAX_CHARS) {
      return NextResponse.json({ error: 'Texten är för lång för att fortsätta skriva på' }, { status: 400 });
    }

    const style = await loadWritingStyle(preset.series);
    console.log(`[continue-book] ${preset.label}: fortsätter efter ${countWords(rawText)} ord`);

    const result = await continueBook({
      preset,
      targetAge: body.targetAge?.trim() || preset.book.age,
      title: body.title?.trim() || 'Namnlös bok',
      outline: body.outline?.trim() || '(ingen disposition - fortsätt berättelsen logiskt till ett bra slut)',
      rawText,
      style,
      voice: normalizeVoice(body.voice),
    }, startedAt + WRITE_BUDGET_MS);

    console.log(`[continue-book] ${countWords(result.rawText)} ord till${result.truncated ? ' (avbruten)' : ''}`);
    return NextResponse.json(result);
  } catch (error) {
    console.error('Fortsätta boken misslyckades:', error);
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
