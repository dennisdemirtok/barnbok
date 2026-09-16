import { Character } from './types';

// Referensbilder som hämtats från molnet. Samma bild används för hela boken,
// så den hämtas en gång per körning och sparas sedan här.
const cache = new Map<string, string>();
const MAX_CACHE = 40;

async function fetchBase64(url: string): Promise<string | null> {
  const cached = cache.get(url);
  if (cached) return cached;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const base64 = buf.toString('base64');
    if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value as string);
    cache.set(url, base64);
    return base64;
  } catch {
    return null;
  }
}

/**
 * Karaktärer som laddats från molnet har bara en adress till referensbilden.
 * Bildmodellen och granskaren behöver själva bilden - hämta den här.
 */
export async function withReferenceImages(characters: Character[]): Promise<Character[]> {
  const needsFetch = characters.some(c => !c.referenceImage && c.referenceImageUrl);
  if (!needsFetch) return characters;
  return Promise.all(characters.map(async c => {
    if (c.referenceImage || !c.referenceImageUrl) return c;
    const base64 = await fetchBase64(c.referenceImageUrl);
    return base64 ? { ...c, referenceImage: base64 } : c;
  }));
}
