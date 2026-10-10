import { NextResponse } from 'next/server';
import { proofreadSections } from '@/lib/proofread';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const MAX_WORDS = 60_000;

// Korrekturläser bokens text, avsnitt för avsnitt (oftast ett textblock per
// avsnitt). autoFix rättar tydliga fel direkt - bara för text som AI:n skrivit.
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null) as {
      sections?: { key?: unknown; text?: unknown }[];
      targetAge?: string;
      dialogue?: string;
      names?: unknown[];
      autoFix?: boolean;
    } | null;
    const sections = (body?.sections ?? [])
      .filter((s): s is { key: string; text: string } => typeof s?.key === 'string' && typeof s?.text === 'string')
      .slice(0, 3000);
    if (sections.length === 0) return NextResponse.json({ error: 'Texten saknas' }, { status: 400 });
    const words = sections.reduce((n, s) => n + s.text.split(/\s+/).filter(Boolean).length, 0);
    if (words > MAX_WORDS) return NextResponse.json({ error: 'Texten är för lång för en korrekturläsning' }, { status: 400 });

    const results = await proofreadSections(sections, {
      targetAge: typeof body?.targetAge === 'string' ? body.targetAge : undefined,
      dialogue: body?.dialogue === 'quotes' || body?.dialogue === 'none' ? body.dialogue : 'dash',
      names: (body?.names ?? []).filter((n): n is string => typeof n === 'string').slice(0, 40),
      autoFix: body?.autoFix === true,
    });
    const fixed = results.reduce((n, r) => n + r.fixed, 0);
    const open = results.reduce((n, r) => n + r.issues.length, 0);
    console.log(`[Korrektur] ${words} ord: ${fixed} rättade, ${open} förslag`);
    return NextResponse.json({ results });
  } catch (error) {
    console.error('Korrekturläsningen misslyckades:', error);
    const message = error instanceof Error ? error.message : 'Okänt fel';
    return NextResponse.json({ error: `Korrekturläsningen misslyckades: ${message}` }, { status: 500 });
  }
}
