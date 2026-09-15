// Bildtyper per bild (helsida, uppslag, band, utklippt figur, vinjett, serierutor).
// Rörliga boktyper blandar dem genom hela boken - aldrig samma form i lång rad.
import type { Composition, IllustrationShape } from './types';

export const COMPOSITIONS: Composition[] = ['full', 'spread', 'band', 'spot', 'round', 'panels'];

export const COMPOSITION_LABEL: Record<Composition, string> = {
  full: 'Helsida',
  spread: 'Uppslag',
  band: 'Band',
  spot: 'Figur',
  round: 'Rund vinjett',
  panels: 'Serierutor',
};

// Bildformat till bildmodellen
export function aspectFor(composition: Composition): '3:4' | '3:2' | '16:9' | '1:1' | '4:5' {
  switch (composition) {
    case 'spread': return '3:2';
    case 'band': return '16:9';
    case 'spot':
    case 'round': return '1:1';
    case 'panels': return '4:5';
    default: return '3:4';
  }
}

export function aspectRatioNumber(composition: Composition): number {
  const [w, h] = aspectFor(composition).split(':').map(Number);
  return w / h;
}

// Bildtypen för en bild: uttrycklig, annars bokens bildform
export function resolveComposition(composition: Composition | undefined, shape: IllustrationShape): Composition {
  return composition ?? (shape === 'spread' ? 'spread' : 'full');
}

// Liten deterministisk slump så att samma bok alltid får samma fördelning
function seededRandom(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Får den här bildtypen stå på plats i? Stora bildtyper ska andas mellan sig.
function allowed(c: Composition, list: Composition[], i: number): boolean {
  const prev = list[i - 1];
  const prev2 = list[i - 2];
  if (prev === c && prev2 === c) return false; // aldrig tre likadana i rad
  if ((c === 'spread' || c === 'full' || c === 'panels') && prev === c) return false; // stora former aldrig två i rad
  if (c === 'spread' && prev === 'full') return false;
  if (c === 'full' && prev === 'spread') return false;
  return true;
}

/**
 * Justerar en föreslagen lista (t.ex. från AI:n) så att den följer blandningen:
 * inga olämpliga upprepningar och ungefär rätt andel av varje bildtyp.
 * Tomma platser fylls med den bildtyp som ligger mest efter sin andel.
 */
export function balanceCompositions(
  suggested: (Composition | undefined)[],
  mix: Partial<Record<Composition, number>>,
  seed = 'bok',
): Composition[] {
  const rand = seededRandom(seed);
  const types = COMPOSITIONS.filter(c => (mix[c] ?? 0) > 0);
  if (types.length === 0) return suggested.map(c => c ?? 'full');
  const total = types.reduce((n, c) => n + (mix[c] ?? 0), 0);
  const n = suggested.length;
  const target = Object.fromEntries(types.map(c => [c, ((mix[c] ?? 0) / total) * n])) as Record<Composition, number>;
  const counts = Object.fromEntries(COMPOSITIONS.map(c => [c, 0])) as Record<Composition, number>;
  const out: Composition[] = [];

  for (let i = 0; i < n; i++) {
    const wish = suggested[i];
    // Förslaget godtas om det är tillåtet här och inte redan ligger långt över sin andel
    if (wish && types.includes(wish) && allowed(wish, out, i) && counts[wish] < target[wish] + 1) {
      out.push(wish);
      counts[wish]++;
      continue;
    }
    // Annars: den tillåtna bildtyp som ligger mest efter, med lite slump vid lika
    const candidates = types
      .filter(c => allowed(c, out, i))
      .map(c => ({ c, deficit: target[c] - counts[c] + rand() * 2.2 }))
      .sort((a, b) => b.deficit - a.deficit);
    const pick = candidates[0]?.c ?? types[0];
    out.push(pick);
    counts[pick]++;
  }
  return out;
}

// Instruktion till planeraren om vad bildtyperna är till för
export function compositionGuide(mix: Partial<Record<Composition, number>>): string {
  const lines: Record<Composition, string> = {
    spot: 'spot: en eller två figurer utan bakgrund på vitt papper - för repliker, reaktioner, gester och lugna ögonblick',
    full: 'full: helsida med hel miljö - för viktiga vändpunkter och stämningar',
    band: 'band: brett band överst eller nederst på sidan - för förflyttningar, landskap, en väg eller ett rum sett från sidan',
    panels: 'panels: 3-4 serierutor - när något händer i snabba steg, ett misstag eller ett skämt med tajming',
    round: 'round: rund vinjett - för en detalj, ett föremål, en ledtråd eller ett närbildsansikte',
    spread: 'spread: uppslag över två sidor - för bokens största ögonblick, högst ett par gånger',
  };
  return COMPOSITIONS.filter(c => (mix[c] ?? 0) > 0).map(c => `  - ${lines[c]}`).join('\n');
}
