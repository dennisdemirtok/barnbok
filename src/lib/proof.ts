// Korrekturläsning av boktexten: fingeravtryck, status och rättelser. Används av
// både klienten och servern - ingen serverkod här. Själva läsningen görs av
// Claude via /api/proofread (src/lib/proofread.ts).
import type { BookProject, ProofIssue, Spread } from './types';

// FNV-1a, samma idé som bildnamnen - bara för att märka om texten har ändrats
export function textHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36) + text.length.toString(36);
}

export const spreadText = (spread: Spread) => spread.textBlocks.map(b => b.text).join('\n');
export const spreadHash = (spread: Spread) => textHash(spreadText(spread));
const hasText = (spread: Spread) => spread.textBlocks.some(b => b.text.trim());

// Uppslag som behöver läsas: aldrig lästa, eller ändrade efter läsningen
export function needsProof(spread: Spread): boolean {
  return hasText(spread) && spread.proof?.hash !== spreadHash(spread);
}

export interface ProofSummary {
  total: number; // uppslag med text
  unchecked: number; // aldrig lästa eller ändrade efteråt
  fixed: number; // rättade av korrekturläsningen
  open: number; // förslag kvar att ta ställning till
}

export function proofSummary(book: BookProject): ProofSummary {
  const withText = book.spreads.filter(hasText);
  const current = withText.filter(s => !needsProof(s));
  return {
    total: withText.length,
    unchecked: withText.length - current.length,
    fixed: current.reduce((n, s) => n + (s.proof?.fixed ?? 0), 0),
    open: current.reduce((n, s) => n + (s.proof?.issues.length ?? 0), 0),
  };
}

// Svaret från korrekturläsningen för ett uppslag
export interface SpreadProofResult {
  spreadId: string;
  sentHash: string; // texten som lästes - har den ändrats sedan dess gäller inte svaret
  textBlocks: string[]; // texten efter de automatiska rättelserna, block för block
  fixed: number;
  issues: ProofIssue[];
}

// Lägger in svaren i boken. Uppslag som ändrats medan läsningen pågick lämnas
// orörda - de räknas som okontrollerade och läses nästa gång.
export function mergeProofResults(book: BookProject, results: SpreadProofResult[]): BookProject {
  const byId = new Map(results.map(r => [r.spreadId, r]));
  const checkedAt = new Date().toISOString();
  let changed = false;
  const spreads = book.spreads.map(spread => {
    const r = byId.get(spread.id);
    if (!r || r.sentHash !== spreadHash(spread) || r.textBlocks.length !== spread.textBlocks.length) return spread;
    changed = true;
    const next = { ...spread, textBlocks: spread.textBlocks.map((b, i) => ({ ...b, text: r.textBlocks[i] })) };
    return { ...next, proof: { hash: spreadHash(next), checkedAt, fixed: r.fixed || undefined, issues: r.issues } };
  });
  return changed ? { ...book, spreads } : book;
}

const sameIssue = (a: ProofIssue, b: ProofIssue) => a.quote === b.quote && a.fix === b.fix;

// Rättar (accept) eller hoppar över ett förslag. Uppslaget räknas fortfarande
// som läst, eftersom ändringen kommer från korrekturläsningen själv.
export function resolveProofIssue(spread: Spread, issue: ProofIssue, accept: boolean): Spread {
  const current = !!spread.proof && spread.proof.hash === spreadHash(spread);
  const index = accept ? spread.textBlocks.findIndex(b => b.text.includes(issue.quote)) : -1;
  const next = index < 0 ? spread : {
    ...spread,
    textBlocks: spread.textBlocks.map((b, i) => (i === index ? { ...b, text: b.text.replace(issue.quote, issue.fix) } : b)),
  };
  if (!spread.proof) return next;
  return {
    ...next,
    proof: {
      ...spread.proof,
      hash: current ? spreadHash(next) : spread.proof.hash,
      fixed: (spread.proof.fixed ?? 0) + (index >= 0 ? 1 : 0) || undefined,
      issues: spread.proof.issues.filter(i => !sameIssue(i, issue)),
    },
  };
}
