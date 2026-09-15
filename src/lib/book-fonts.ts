// Boktypsnitt (alla OFL) som bäddas in i PDF:en och används för att mäta text i
// sättningen. Läsaren i webbläsaren laddar samma filer via bookFontFaceCss() så
// att skärmen ser ut som den tryckta boken.
import type { jsPDF } from 'jspdf';

export type FontFamily =
  | 'Literata'
  | 'Alegreya'
  | 'LibreCaslon'
  | 'Nunito'
  | 'Figtree'
  | 'Fredoka'
  | 'Bangers'
  | 'PatrickHand';
export type FontStyle = 'normal' | 'bold' | 'italic';

export interface FontSpec {
  family: FontFamily;
  style: FontStyle;
}

interface FamilyDef {
  name: string; // visningsnamn (redaktionssidan)
  fallback: string; // CSS-reserv medan filen laddas
  files: { normal: string; bold?: string; italic?: string };
  boldWeight: number; // CSS-vikt för bold-filen
  // Optisk storlek relativt Literata: brödtext efter x-höjd, rubriktypsnitt avvägda för ögat
  scale: number;
  // Baslinjens läge i em från toppen av en rad med line-height 1 (från hhea-metriken)
  baseline: number;
}

export const BOOK_FONTS: Record<FontFamily, FamilyDef> = {
  Literata: {
    name: 'Literata', fallback: 'Georgia, serif', boldWeight: 700, scale: 1, baseline: 0.934,
    files: { normal: 'literata-400.ttf', bold: 'literata-700.ttf', italic: 'literata-400-italic.ttf' },
  },
  Alegreya: {
    name: 'Alegreya', fallback: 'Georgia, serif', boldWeight: 700, scale: 1.1, baseline: 0.836,
    files: { normal: 'alegreya-400.ttf', bold: 'alegreya-700.ttf', italic: 'alegreya-400-italic.ttf' },
  },
  LibreCaslon: {
    name: 'Libre Caslon Text', fallback: 'Georgia, serif', boldWeight: 700, scale: 0.95, baseline: 0.855,
    files: { normal: 'librecaslon-400.ttf', bold: 'librecaslon-700.ttf', italic: 'librecaslon-400-italic.ttf' },
  },
  Nunito: {
    name: 'Nunito', fallback: 'system-ui, sans-serif', boldWeight: 800, scale: 1.03, baseline: 0.829,
    files: { normal: 'nunito-400.ttf', bold: 'nunito-800.ttf' },
  },
  Figtree: {
    name: 'Figtree', fallback: 'system-ui, sans-serif', boldWeight: 800, scale: 1, baseline: 0.85,
    files: { normal: 'figtree-400.ttf', bold: 'figtree-800.ttf', italic: 'figtree-400-italic.ttf' },
  },
  Fredoka: {
    name: 'Fredoka', fallback: 'system-ui, sans-serif', boldWeight: 600, scale: 1, baseline: 0.869,
    files: { normal: 'fredoka-400.ttf', bold: 'fredoka-600.ttf' },
  },
  // Rubriktypsnitt med en vikt - bold och kursiv använder samma fil
  Bangers: {
    name: 'Bangers', fallback: 'Impact, sans-serif', boldWeight: 400, scale: 1.3, baseline: 0.851,
    files: { normal: 'bangers-400.ttf' },
  },
  PatrickHand: {
    name: 'Patrick Hand', fallback: 'system-ui, sans-serif', boldWeight: 400, scale: 1.25, baseline: 0.865,
    files: { normal: 'patrickhand-400.ttf' },
  },
};

const STYLES: FontStyle[] = ['normal', 'bold', 'italic'];

function fileFor(family: FontFamily, style: FontStyle): string {
  const f = BOOK_FONTS[family].files;
  return f[style] ?? f.normal;
}

const fontData = new Map<string, Promise<string>>();

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  return btoa(binary);
}

function loadFile(file: string): Promise<string> {
  let p = fontData.get(file);
  if (!p) {
    p = fetch(`/fonts/${file}`).then(async res => {
      if (!res.ok) throw new Error(`Kunde inte ladda typsnittet ${file}`);
      return arrayBufferToBase64(await res.arrayBuffer());
    });
    // Tillåt nytt försök om nätverket strulade
    p.catch(() => fontData.delete(file));
    fontData.set(file, p);
  }
  return p;
}

// Nytt jsPDF-dokument (16×21 cm, stående) med de angivna typsnitten registrerade
export async function createBookPdf(families: FontFamily[]): Promise<jsPDF> {
  const unique = Array.from(new Set(families));
  const [{ jsPDF }, files] = await Promise.all([
    import('jspdf'),
    Promise.all(unique.flatMap(family => STYLES.map(async style => {
      const file = fileFor(family, style);
      return { family, style, file, data: await loadFile(file) };
    }))),
  ]);
  const doc = new jsPDF({ unit: 'mm', format: [160, 210], orientation: 'portrait', compress: true });
  for (const f of files) {
    const vfsName = `${f.family}-${f.style}.ttf`;
    doc.addFileToVFS(vfsName, f.data);
    doc.addFont(vfsName, f.family, f.style);
  }
  return doc;
}

export interface Measurer {
  width(text: string, font: FontSpec, size: number): number; // mm
}

// Mäter med samma typsnittsmetrik som PDF:en ritas med
export async function createMeasurer(families: FontFamily[]): Promise<Measurer> {
  const doc = await createBookPdf(families);
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

const cssFamily = (family: FontFamily) => `Book ${family}`;

// @font-face för läsaren - läggs in först när en bok visas
export function bookFontFaceCss(families: FontFamily[]): string {
  return Array.from(new Set(families)).flatMap(family => {
    const def = BOOK_FONTS[family];
    return STYLES.filter(style => style === 'normal' || def.files[style]).map(style => {
      const weight = style === 'bold' ? def.boldWeight : 400;
      const fontStyle = style === 'italic' ? 'italic' : 'normal';
      return `@font-face{font-family:'${cssFamily(family)}';src:url('/fonts/${fileFor(family, style)}') format('truetype');font-weight:${weight};font-style:${fontStyle};font-display:swap}`;
    });
  }).join('\n');
}

// CSS för att visa ett textelement som i PDF:en
export function fontCss(font: FontSpec): { fontFamily: string; fontWeight: number; fontStyle: string } {
  const def = BOOK_FONTS[font.family];
  const hasFile = !!def.files[font.style] || font.style === 'normal';
  return {
    fontFamily: `'${cssFamily(font.family)}', ${def.fallback}`,
    fontWeight: font.style === 'bold' && hasFile ? def.boldWeight : 400,
    fontStyle: font.style === 'italic' && hasFile ? 'italic' : 'normal',
  };
}
