// Klienten: skickar bokens text till korrekturläsningen (/api/proofread) och
// ger tillbaka svaren per uppslag, redo att läggas in med mergeProofResults.
import type { BookProject } from './types';
import { getStylePreset } from './styles';
import { needsProof, spreadHash, type SpreadProofResult } from './proof';

// Läser de uppslag som inte är kontrollerade (eller alla). Servern delar upp
// texten i kapitelstora anrop. Text som AI:n skrivit rättas direkt; i författarens
// egen text blir allt förslag.
export async function proofreadBook(book: BookProject, options: { all?: boolean } = {}): Promise<SpreadProofResult[]> {
  const spreads = book.spreads.filter(s => (options.all ? s.textBlocks.some(b => b.text.trim()) : needsProof(s)));
  if (spreads.length === 0) return [];

  const res = await fetch('/api/proofread', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sections: spreads.flatMap(s => s.textBlocks.map((b, i) => ({ key: `${s.id}#${i}`, text: b.text }))),
      targetAge: book.targetAge,
      // Serier har repliker i pratbubblor, utan repliktecken
      dialogue: book.bookFormat === 'bildbok-text-pa-bild' ? 'none' : getStylePreset(book.stylePresetId)?.book.dialogue ?? 'dash',
      names: book.characters.map(c => c.name),
      autoFix: book.aiWritten === true,
    }),
  });
  const data = await res.json().catch(() => null) as { results?: { key: string; text: string; fixed: number; issues: SpreadProofResult['issues'] }[]; error?: string } | null;
  if (!res.ok || !data?.results) throw new Error(data?.error || 'Korrekturläsningen gick inte att göra just nu');

  const byKey = new Map(data.results.map(r => [r.key, r]));
  return spreads.map(s => {
    const blocks = s.textBlocks.map((_, i) => byKey.get(`${s.id}#${i}`));
    return {
      spreadId: s.id,
      sentHash: spreadHash(s),
      textBlocks: s.textBlocks.map((b, i) => blocks[i]?.text ?? b.text),
      fixed: blocks.reduce((n, r) => n + (r?.fixed ?? 0), 0),
      issues: blocks.flatMap(r => r?.issues ?? []),
    };
  });
}
