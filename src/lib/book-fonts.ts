// Boktypsnitt (OFL) som bäddas in i PDF:en och används för att mäta text i
// sättningen. Samma filer laddas som @font-face i globals.css så att läsaren
// i webbläsaren ser ut som den tryckta boken.
import type { jsPDF } from 'jspdf';

export type FontFamily = 'Literata' | 'Nunito';
export type FontStyle = 'normal' | 'bold' | 'italic';

export interface FontSpec {
  family: FontFamily;
  style: FontStyle;
}

const FONT_FILES: { family: FontFamily; style: FontStyle; file: string }[] = [
  { family: 'Literata', style: 'normal', file: 'literata-400.ttf' },
  { family: 'Literata', style: 'bold', file: 'literata-700.ttf' },
  { family: 'Literata', style: 'italic', file: 'literata-400-italic.ttf' },
  { family: 'Nunito', style: 'normal', file: 'nunito-400.ttf' },
  { family: 'Nunito', style: 'bold', file: 'nunito-800.ttf' },
  // Nunito saknar kursiv - faller tillbaka på regular
  { family: 'Nunito', style: 'italic', file: 'nunito-400.ttf' },
];

let fontDataPromise: Promise<Map<string, string>> | null = null;

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  return btoa(binary);
}

function loadFontData(): Promise<Map<string, string>> {
  if (!fontDataPromise) {
    const files = Array.from(new Set(FONT_FILES.map(f => f.file)));
    fontDataPromise = Promise.all(
      files.map(async file => {
        const res = await fetch(`/fonts/${file}`);
        if (!res.ok) throw new Error(`Kunde inte ladda typsnittet ${file}`);
        return [file, arrayBufferToBase64(await res.arrayBuffer())] as const;
      })
    ).then(entries => new Map(entries));
    // Tillåt nytt försök om nätverket strulade
    fontDataPromise.catch(() => { fontDataPromise = null; });
  }
  return fontDataPromise;
}

// Nytt jsPDF-dokument (16×21 cm, stående) med boktypsnitten registrerade.
// Ange `families` för att bara bädda in typsnitt som faktiskt används.
export async function createBookPdf(families?: FontFamily[]): Promise<jsPDF> {
  const [{ jsPDF }, fonts] = await Promise.all([import('jspdf'), loadFontData()]);
  const doc = new jsPDF({ unit: 'mm', format: [160, 210], orientation: 'portrait', compress: true });
  for (const f of FONT_FILES) {
    if (families && !families.includes(f.family)) continue;
    const vfsName = `${f.family}-${f.style}.ttf`;
    doc.addFileToVFS(vfsName, fonts.get(f.file)!);
    doc.addFont(vfsName, f.family, f.style);
  }
  return doc;
}

export interface Measurer {
  width(text: string, font: FontSpec, size: number): number; // mm
}

// Mäter med samma typsnittsmetrik som PDF:en ritas med
export async function createMeasurer(): Promise<Measurer> {
  const doc = await createBookPdf();
  const cache = new Map<string, number>();
  return {
    width(text, font, size) {
      const key = `${font.family}|${font.style}|${size}|${text}`;
      let w = cache.get(key);
      if (w === undefined) {
        doc.setFont(font.family, font.style);
        doc.setFontSize(size);
        w = doc.getTextWidth(text);
        cache.set(key, w);
      }
      return w;
    },
  };
}

// CSS för att visa samma typsnitt i webbläsaren (se @font-face i globals.css)
export function fontCss(font: FontSpec): { fontFamily: string; fontWeight: number; fontStyle: string } {
  return {
    fontFamily: font.family === 'Literata' ? "'Book Literata', Georgia, serif" : "'Book Nunito', system-ui, sans-serif",
    fontWeight: font.style === 'bold' ? (font.family === 'Nunito' ? 800 : 700) : 400,
    fontStyle: font.style === 'italic' && font.family === 'Literata' ? 'italic' : 'normal',
  };
}
