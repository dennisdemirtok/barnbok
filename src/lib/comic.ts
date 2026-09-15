// Serieroman: ett prosamanus blir seriesidor med rutor, pratbubblor, textrutor
// och ljudord. Varje boksida är EN stående bild där all text är letrad i bilden.
// Ren logik utan SDK:er - används av planeringen, bildprompten, granskningen och klienten.
import type { Spread, TextBlock } from './types';
import { sanitizeProse } from './writing';

export type PanelSize = 'small' | 'medium' | 'large' | 'wide';

export interface ComicLine {
  speaker: string;
  text: string;
}

export interface ComicPanel {
  size?: PanelSize;
  // Engelsk bildbeskrivning av rutan (utan text)
  description: string;
  caption?: string;
  dialogue: ComicLine[];
  sfx?: string;
}

export interface ComicPage {
  panels: ComicPanel[];
}

// Figurer som skrivs in i sidmanuset med fullständigt utseende
export interface ComicCastMember {
  name: string;
  age?: string;
  appearance: string;
  normalClothes?: string;
}

export const MIN_PANELS = 2;
export const MAX_PANELS = 6;
export const MIN_COMIC_PAGES = 2;
export const MAX_COMIC_PAGES = 120;

// Antal seriesidor för ett manus: ord / ord per bild, inom rimliga gränser
export function comicPageTarget(words: number, wordsPerImage: number): number {
  return Math.min(MAX_COMIC_PAGES, Math.max(MIN_COMIC_PAGES, Math.round(words / Math.max(1, wordsPerImage))));
}

// ════════════════════════════════════════════════════════
//  Städning av det AI:n skrivit
// ════════════════════════════════════════════════════════

function words(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

// Texten i en bubbla/textruta: inga talstreck, citattecken eller långa tankstreck
export function cleanLettering(text: string | undefined): string {
  if (!text) return '';
  let t = sanitizeProse(text.replace(/\s+/g, ' ').trim());
  t = t
    .replace(/^[\s\-–—―*]+/, '') // talstreck först
    .replace(/["“”„«»]/g, '') // citattecken skulle krocka med manusets citat
    .replace(/\s+([,!?]|\.(?!\.))/g, '$1') // men "Under tiden ..." behåller mellanslaget
    .replace(/[,;:]\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  return t;
}

export function cleanSfx(text: string | undefined): string {
  const t = cleanLettering(text);
  if (!t) return '';
  return words(t).slice(0, 3).join(' ').toLocaleUpperCase('sv-SE');
}

function cleanSpeaker(text: string | undefined): string {
  return (text || '').replace(/["“”:]/g, '').replace(/\s+/g, ' ').trim() || 'someone';
}

// Bildbeskrivningen citeras inte - dubbla citattecken byts så att bara letrad text står inom ""
function cleanDescription(text: string | undefined): string {
  return (text || '').replace(/[—―]/g, ', ').replace(/["“”„]/g, "'").replace(/\s+/g, ' ').trim();
}

// Långa repliker delas vid en meningsgräns i två bubblor med samma talare
function splitLongLine(line: ComicLine): ComicLine[] {
  if (words(line.text).length <= 14) return [line];
  const sentences = line.text.match(/[^.!?…]+[.!?…]+|[^.!?…]+$/g)?.map(s => s.trim()).filter(Boolean) ?? [line.text];
  if (sentences.length < 2) return [line];
  const total = words(line.text).length;
  let acc = 0;
  let cut = 1;
  for (let i = 0; i < sentences.length - 1; i++) {
    acc += words(sentences[i]).length;
    cut = i + 1;
    if (acc >= total / 2) break;
  }
  return [
    { speaker: line.speaker, text: sentences.slice(0, cut).join(' ') },
    { speaker: line.speaker, text: sentences.slice(cut).join(' ') },
  ];
}

function normalizePanel(panel: Partial<ComicPanel> | undefined): ComicPanel | null {
  if (!panel) return null;
  const size: PanelSize | undefined = ['small', 'medium', 'large', 'wide'].includes(panel.size as string) ? panel.size : undefined;
  const dialogue = (Array.isArray(panel.dialogue) ? panel.dialogue : [])
    .map(l => ({ speaker: cleanSpeaker(l?.speaker), text: cleanLettering(l?.text) }))
    .filter(l => l.text.length > 0)
    .flatMap(splitLongLine);
  const out: ComicPanel = {
    size,
    description: cleanDescription(panel.description),
    caption: cleanLettering(panel.caption) || undefined,
    dialogue,
    sfx: cleanSfx(panel.sfx) || undefined,
  };
  if (!out.description && !out.caption && out.dialogue.length === 0 && !out.sfx) return null;
  if (!out.description) out.description = 'A reaction shot of the characters from the previous panel.';
  return out;
}

// Rensar sidorna och ser till att varje sida har 2-6 rutor
export function normalizeComicPages(pages: (Partial<ComicPage> | undefined)[]): ComicPage[] {
  const cleaned: ComicPage[] = [];
  for (const page of pages) {
    const panels = (Array.isArray(page?.panels) ? page!.panels : [])
      .map(p => normalizePanel(p))
      .filter((p): p is ComicPanel => !!p);
    if (panels.length === 0) continue;
    // För många rutor: dela sidan i jämnstora sidor
    const parts = Math.ceil(panels.length / MAX_PANELS);
    const per = Math.ceil(panels.length / parts);
    for (let i = 0; i < panels.length; i += per) cleaned.push({ panels: panels.slice(i, i + per) });
  }

  // En ensam ruta slås ihop med nästa (eller föregående) sida om det ryms
  const out: ComicPage[] = [];
  for (let i = 0; i < cleaned.length; i++) {
    const page = cleaned[i];
    if (page.panels.length < MIN_PANELS) {
      const next = cleaned[i + 1];
      const prev = out[out.length - 1];
      if (next && next.panels.length + page.panels.length <= MAX_PANELS) {
        next.panels = [...page.panels, ...next.panels];
        continue;
      }
      if (prev && prev.panels.length + page.panels.length <= MAX_PANELS) {
        prev.panels = [...prev.panels, ...page.panels];
        continue;
      }
      // Går inte att slå ihop: en stor helsidesruta
      page.panels = page.panels.map(p => ({ ...p, size: 'large' }));
    }
    out.push(page);
  }
  return out;
}

// ════════════════════════════════════════════════════════
//  Sidmanus till bildmodellen
// ════════════════════════════════════════════════════════

export function letteringCaps(text: string): string {
  return text.toLocaleUpperCase('sv-SE');
}

// Betonade ORD i en replik som annars har gemener
function emphasized(text: string): string[] {
  if (!/[a-zåäö]/.test(text)) return [];
  return Array.from(text.matchAll(new RegExp('(?<![\\p{L}])[A-ZÅÄÖ]{2,}(?![\\p{L}])', 'gu'))).map(m => m[0]);
}

const SIZE_HINT: Record<PanelSize, string> = {
  small: 'small panel',
  medium: 'medium panel',
  large: 'big panel, about half the page',
  wide: 'wide panel across the full page width',
};

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function mentions(text: string, name: string): boolean {
  const parts = [name, ...name.split(/\s+/)].map(p => p.trim()).filter(p => p.length >= 2);
  return parts.some(p => new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(p)}('?s)?($|[^\\p{L}\\p{N}])`, 'iu').test(text));
}

export function comicPageScript(page: ComicPage, cast: ComicCastMember[] = []): string {
  const n = page.panels.length;
  const lines: string[] = [
    `COMIC PAGE SCRIPT: one complete portrait comic book page with exactly ${n} panel${n === 1 ? '' : 's'}, read left to right, top to bottom. Thick black panel borders with white gutters on off-white paper. Follow the panel sizes below and vary the shapes so the page feels lively.`,
  ];

  page.panels.forEach((panel, i) => {
    lines.push('');
    lines.push(`PANEL ${i + 1}${panel.size ? ` (${SIZE_HINT[panel.size]})` : ''}:`);
    lines.push(`Scene: ${panel.description}`);
    if (panel.caption) {
      lines.push(`Caption box (small box tucked into a corner of the panel): "${letteringCaps(panel.caption)}"`);
    }
    panel.dialogue.forEach((line, j) => {
      const bold = emphasized(line.text);
      const order = panel.dialogue.length > 1 ? ` ${j + 1} of ${panel.dialogue.length}` : '';
      lines.push(`Speech bubble${order} - spoken by ${line.speaker} (tail points to ${line.speaker}): "${letteringCaps(line.text)}"${bold.length ? ` (extra bold: ${bold.join(', ')})` : ''}`);
    });
    if (panel.sfx) {
      lines.push(`Sound effect (giant colorful letters bursting out of the panel): "${panel.sfx}"`);
    }
    if (!panel.caption && panel.dialogue.length === 0 && !panel.sfx) {
      lines.push('No text in this panel.');
    }
  });

  const pageText = page.panels.map(p => `${p.description} ${p.dialogue.map(d => d.speaker).join(' ')}`).join(' ');
  const onPage = cast.filter(c => c.name?.trim() && mentions(pageText, c.name));
  if (onPage.length > 0) {
    lines.push('');
    lines.push('CHARACTERS ON THIS PAGE (each looks exactly the same in every panel they appear in, and appears at most once per panel):');
    for (const c of onPage) {
      lines.push(`- ${c.name}${c.age ? ` (${c.age})` : ''}: ${c.appearance}${c.normalClothes ? ` Clothes: ${c.normalClothes}.` : ''}`);
    }
  }

  lines.push('');
  lines.push('Every quoted text above is Swedish and must be hand-lettered in ALL CAPS exactly as quoted, letter for letter (keep Å, Ä, Ö and the punctuation). No other text on the page and no page number.');
  return lines.join('\n');
}

// ── Lettrade texter som textblock (sparas och går att söka i) ──

const KIND_SV = { caption: 'textruta', bubble: 'pratbubbla', sfx: 'ljudord' } as const;
type LetterKind = keyof typeof KIND_SV;

export function comicTextBlocks(page: ComicPage): TextBlock[] {
  const blocks: TextBlock[] = [];
  page.panels.forEach((panel, i) => {
    const ruta = `ruta ${i + 1}`;
    if (panel.caption) blocks.push({ position: `${ruta} · ${KIND_SV.caption}`, text: panel.caption });
    for (const line of panel.dialogue) blocks.push({ position: `${ruta} · ${KIND_SV.bubble} · ${line.speaker}`, text: line.text });
    if (panel.sfx) blocks.push({ position: `${ruta} · ${KIND_SV.sfx}`, text: panel.sfx });
  });
  return blocks;
}

export interface LetteringInfo {
  panel?: number;
  kind?: LetterKind;
  speaker?: string;
}

export function parseLetteringPosition(position: string): LetteringInfo {
  const m = position.match(/^ruta\s+(\d+)\s*·\s*(textruta|pratbubbla|ljudord)(?:\s*·\s*(.+))?$/i);
  if (!m) return {};
  const kind = (Object.keys(KIND_SV) as LetterKind[]).find(k => KIND_SV[k] === m[2].toLowerCase());
  return { panel: Number(m[1]), kind, speaker: m[3]?.trim() };
}

// Engelsk etikett för en lettrad text, t.ex. "Panel 2 speech bubble - Otis speaks"
export function describeLettering(block: TextBlock, index: number): string {
  const info = parseLetteringPosition(block.position);
  if (!info.kind) return `Text ${index + 1}`;
  const where = `Panel ${info.panel}`;
  if (info.kind === 'caption') return `${where} caption box`;
  if (info.kind === 'sfx') return `${where} sound effect`;
  return `${where} speech bubble - ${info.speaker || 'a character'} speaks (tail points to ${info.speaker || 'the speaker'})`;
}

// Hur många rutor sidmanuset har (0 om prompten inte är ett sidmanus)
export function scriptPanelCount(imagePrompt: string): number {
  const nums = Array.from(imagePrompt.matchAll(/^PANEL (\d+)\b/gm)).map(m => Number(m[1]));
  return nums.length > 0 ? Math.max(...nums) : 0;
}

// ════════════════════════════════════════════════════════
//  Boksidor
// ════════════════════════════════════════════════════════

export function comicPagesToSpreads(pages: ComicPage[], cast: ComicCastMember[], newId: () => string): Spread[] {
  return pages.map((page, i) => ({
    id: newId(),
    spreadNumber: i + 1,
    // Titelsida, redaktionssida och smutstitel före - serien börjar på sida 6, en sida per bild
    pages: String(6 + i),
    textBlocks: comicTextBlocks(page),
    imagePrompt: comicPageScript(page, cast),
    composition: undefined,
    status: 'pending' as const,
  }));
}

// Enkel seriesida ur en scentext när AI:n inte kunnat skriva ett sidmanus (t.ex. äldre stilprovningar):
// repliker med talstreck blir bubblor, första korta meningen en textruta
const SAID_RE = new RegExp('^(.+?[!?.,…])\\s+(?:ropar|säger|sa|sade|frågar|undrar|viskar|skriker|svarar|ropade|frågade|viskade|svarade)\\s+([A-ZÅÄÖ][\\p{L}-]+)?', 'u');

export function fallbackComicPage(sceneText: string, imagePrompt: string): ComicPage {
  const lines = sceneText.split(/\n+/).map(l => l.trim()).filter(Boolean);
  const dialogue: ComicLine[] = [];
  let caption = '';
  for (const line of lines) {
    const m = line.match(/^[-–—*]\s*(.+)$/);
    if (m && dialogue.length < 3) {
      // "Vänta på mig! ropar Otis och ..." -> repliken före anföringen
      const said = m[1].match(SAID_RE);
      const text = cleanLettering((said?.[1] ?? m[1]).replace(/,$/, '!'));
      if (words(text).length > 0 && words(text).length <= 12) dialogue.push({ speaker: said?.[2] || 'the speaking character', text });
    } else if (!caption) {
      const first = line.match(/^[^.!?]+[.!?]/)?.[0]?.trim() ?? '';
      if (first && words(first).length <= 10) caption = first;
    }
  }
  const half = Math.ceil(dialogue.length / 2);
  return normalizeComicPages([{
    panels: [
      { size: 'wide', description: cleanDescription(imagePrompt), caption, dialogue: dialogue.slice(0, half) },
      { size: 'medium', description: 'A closer view of the same moment, focusing on the characters\' faces and reactions.', dialogue: dialogue.slice(half) },
    ],
  }])[0];
}
