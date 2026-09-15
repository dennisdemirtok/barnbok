// Delade hjälpare för bokhandelns vyer

export const FORMAT_LABEL: Record<string, string> = {
  'bildbok-text-pa-bild': 'Serieformat',
  'bildbok-separat-text': 'Bilderbok',
  'kapitelbok': 'Kapitelbok',
  'larobok': 'Lärobok',
};

export function formatLabel(format?: string): string {
  return FORMAT_LABEL[format || ''] || 'Bok';
}

export function formatDate(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('sv-SE', { year: 'numeric', month: 'long', day: 'numeric' });
}

export function formatAge(targetAge?: string): string {
  if (!targetAge) return '';
  const [min, max] = targetAge.split('-');
  if (!min) return '';
  return max && max !== min ? `${min}–${max} år` : `${min} år`;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase() || '')
    .join('') || '?';
}

export function bookUrl(id: string): string {
  return `${window.location.origin}/?bok=${id}`;
}

// Dela via systemets delningsmeny, annars kopiera länken.
// 'copied' = länken ligger i urklipp (visa bekräftelse), 'shared' = delad/avbruten.
export async function shareBookLink(id: string, title: string): Promise<'shared' | 'copied' | 'prompted'> {
  const url = bookUrl(id);
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ title, url });
      return 'shared';
    } catch (err) {
      // Användaren stängde delningsmenyn - gör inget mer
      if (err instanceof DOMException && err.name === 'AbortError') return 'shared';
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    return 'copied';
  } catch {
    window.prompt('Kopiera länken:', url);
    return 'prompted';
  }
}

// Hjärtan delas mellan lista, bokssida och skaparsida
export interface LikesState {
  supported: boolean;
  counts: Record<string, number>;
  liked: Set<string>;
  toggle: (bookId: string) => void;
}
