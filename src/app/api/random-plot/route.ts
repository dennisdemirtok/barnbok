import { NextResponse } from 'next/server';
import { suggestRandomPlot } from '@/lib/claude';
import { getStylePreset } from '@/lib/styles';

export const maxDuration = 60;

// Slumpar en ny bokidé som passar boktypen - ev. utifrån författarens ledtråd
export async function POST(request: Request) {
  try {
    const { stylePresetId, targetAge, hint } = await request.json() as {
      stylePresetId?: string;
      targetAge?: string;
      hint?: string;
    };

    const preset = getStylePreset(stylePresetId);
    if (!preset) {
      return NextResponse.json({ error: 'Välj en boktyp först' }, { status: 400 });
    }

    const suggestion = await suggestRandomPlot(
      preset,
      targetAge?.trim() || preset.book.age,
      hint?.trim().slice(0, 500) || undefined
    );
    return NextResponse.json({
      title: suggestion.title.trim(),
      plot: suggestion.plot.trim(),
      setting: suggestion.setting.trim(),
    });
  } catch (error) {
    console.error('Slumpa handling misslyckades:', error);
    const message = error instanceof Error ? error.message : 'Okänt fel';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
