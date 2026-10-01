// Uppläsningens avsnitt: hur bokens text delas i spår. Ren logik utan
// serverberoenden, så att sidan kan visa samma kapitellista som servern läser in.
import type { BookProject, Spread } from './types';

export interface NarrationSegment {
  index: number;
  label: string; // "Kapitel 3" eller "Början"
  text: string;
}

// Rader som börjar ett nytt kapitel (och ett nytt spår i ljudboken)
export const CHAPTER_RE = /^(kapitel\s+[\wåäö]+|prolog|epilog|förord|efterord)\b/i;

// Ett avsnitt delas efter ett uppslag när det blivit så här långt (ca 7 minuter)
const MAX_SEGMENT_CHARS = 6000;

// Talstreck och radbrytningar ska inte läsas upp som tecken
function forNarration(line: string): string {
  return line
    .replace(/^\s*[-–—*]\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function spreadLines(spread: Spread): string[] {
  return spread.textBlocks
    .map(b => b.text)
    .join('\n')
    .split('\n')
    .map(forNarration)
    .filter(Boolean);
}

/**
 * Delar boken i uppläsningsavsnitt. Kapitelböcker delas per kapitel, bilderböcker
 * i lagom långa stycken. Titel och författare läses först.
 */
export function narrationSegments(book: Pick<BookProject, 'title' | 'author' | 'spreads'>): NarrationSegment[] {
  const segments: NarrationSegment[] = [];
  let current: string[] = [];
  let label = 'Början';
  // Kapitlet vi är inne i och hur många gånger det delats för att det är långt
  let chapter = '';
  let chapterPart = 1;

  const push = () => {
    const text = current.join('\n\n').trim();
    if (text) segments.push({ index: segments.length, label, text });
    current = [];
  };

  const intro = [book.title, book.author ? `av ${book.author}` : ''].filter(Boolean).join('. ');
  current.push(intro);

  for (const spread of book.spreads) {
    if (spread.pages === 'omslag') continue;
    for (const line of spreadLines(spread)) {
      if (CHAPTER_RE.test(line) && line.length <= 80) {
        push();
        label = line.replace(/\s*[-–—:.]\s*/, ': ').trim();
        chapter = label;
        chapterPart = 1;
        current.push(label);
        continue;
      }
      current.push(line);
    }
    // Långa avsnitt delas vid uppslagsgränsen så att inget spår blir orimligt långt
    if (current.join(' ').length > MAX_SEGMENT_CHARS) {
      push();
      chapterPart++;
      label = chapter ? `${chapter} (del ${chapterPart})` : `Del ${segments.length + 1}`;
    }
  }
  push();
  // Ett pyttelitet avsnitt (bara titeln, eller en rubrik utan text) blir inget
  // eget spår - det läggs ihop med nästa så att spellistan blir vettig
  const merged: NarrationSegment[] = [];
  for (const segment of segments) {
    const previous = merged[merged.length - 1];
    if (previous && previous.text.split(/\s+/).length < 30) {
      // Bara titeln först tar nästa kapitels namn - ett kort kapitel behåller sitt eget
      const label = previous.label === 'Början' ? segment.label : previous.label;
      merged[merged.length - 1] = { ...previous, label, text: `${previous.text}\n\n${segment.text}` };
      continue;
    }
    merged.push(segment);
  }
  return merged.map((seg, i) => ({ ...seg, index: i }));
}

// Grov speltid: uppläsning ligger runt 150 ord i minuten
export function estimateSeconds(text: string): number {
  return Math.round((text.split(/\s+/).filter(Boolean).length / 150) * 60);
}
