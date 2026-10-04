// Kursiv i manus: _ord_ eller _flera ord_ (understreck runt det som ska betonas).
// Sättningen ritar det kursivt, uppläsningen och allt som visar ren text tar bort tecknen.
// Ingen serverkod - används av sättningen, läsaren, PDF-exporten och ljudboken.

export interface Run {
  text: string;
  italic: boolean;
}

const EMPHASIS = /_([^_\n]+)_/g;

export function hasEmphasis(text: string): boolean {
  return /_[^_\n]+_/.test(text);
}

export function stripEmphasis(text: string): string {
  return text.replace(EMPHASIS, '$1');
}

// Texten i delar med och utan kursiv, i ordning
export function emphasisRuns(text: string): Run[] {
  const runs: Run[] = [];
  let last = 0;
  for (const m of Array.from(text.matchAll(EMPHASIS))) {
    const at = m.index ?? 0;
    if (at > last) runs.push({ text: text.slice(last, at), italic: false });
    runs.push({ text: m[1], italic: true });
    last = at + m[0].length;
  }
  if (last < text.length) runs.push({ text: text.slice(last), italic: false });
  return runs.filter(r => r.text.length > 0);
}
