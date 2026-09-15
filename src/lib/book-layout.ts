// Sättningsmotor: gör om en BookProject till färdiga boksidor (16×21 cm).
// Resultatet är en renderingsoberoende sidmodell som både PDF-exporten och
// läsaren i webbläsaren ritar - så det man ser är det man får.
import { BookProject, Spread, IllustrationShape, Composition } from './types';
import { getStylePreset, textSideForSpread } from './styles';
import { BOOK_FONTS, type FontFamily, type FontSpec, type Measurer } from './book-fonts';

export const PAGE_W = 160;
export const PAGE_H = 210;
export const PT = 0.3528; // mm per typografisk punkt

export interface Box { x: number; y: number; w: number; h: number }

export interface ImageEl { kind: 'image'; src: string; box: Box; draw: Box; clip?: 'circle' }
export interface TextEl {
  kind: 'text';
  x: number;
  y: number; // baslinje
  width: number;
  text: string;
  font: FontSpec;
  size: number; // pt
  color: string;
  align: 'left' | 'center' | 'justify';
  wordSpacing?: number; // extra mm per mellanrum vid utjämning
  tracking?: number; // mm mellan tecken
}
export interface RectEl { kind: 'rect'; box: Box; color: string; opacity: number; radius: number }
export type PageEl = ImageEl | TextEl | RectEl;

export interface LayoutPage {
  els: PageEl[];
  background?: string;
  label: string;
}

export type LayoutMode = 'picture' | 'chapter' | 'comic';

export interface BookLayout {
  pages: LayoutPage[];
  mode: LayoutMode;
}

// Bildmått, och för bilder på vitt papper även var motivet finns rad för rad
// (andel av bredden från vänster/höger) så att texten kan flyta runt figurerna
export interface ImageInfo { w: number; h: number; rows?: { l: number; r: number }[] }
export type ImageSizes = Map<string, ImageInfo>;

const INK = '#231f20';
const MUTED = '#8b8591';
const NBSP = '\u00A0';

// ════════════════════════════════════════════════════════
//  Innehåll: stycken, repliker, kapitelrubriker
// ════════════════════════════════════════════════════════

type Block =
  | { type: 'heading'; label?: string; title: string; entry?: boolean } // entry: dagboksinlägg ("Måndag") - ingen ny sida
  | { type: 'para'; text: string; continued?: boolean } // continued: fortsättning på ett stycke, inget indrag
  | { type: 'image'; src?: string; aspect: number; spreadNumber: number; composition?: Composition };

interface Scene {
  spread: Spread;
  blocks: Block[]; // rubriker + stycken
  image?: string;
}

const CHAPTER_RE = /^(kapitel\s+[\wåäö]+|prolog|epilog|förord|efterord)\s*(?:[-–—:.]\s*(.*))?$/i;

export function spreadImageSrc(spread: Spread): string | undefined {
  if (spread.generatedImage) return `data:image/png;base64,${spread.generatedImage}`;
  return (spread as Spread & { imageUrl?: string }).imageUrl || undefined;
}

// Swedish talstreck: "* Hej", "- Hej", "— Hej" -> "– Hej" (fast mellanrum efter strecket)
function normalizeParagraph(line: string): string {
  const t = line.trim().replace(/\s+/g, ' ');
  const m = t.match(/^[*\-–—]\s*(.+)$/);
  return m ? `–${NBSP}${m[1]}` : t;
}

// Dagboksinlägg: veckodag på egen rad, ev. med datum eller tid på dagen
// ("Måndag", "MÅNDAG", "Måndag 3 juni", "Tisdag den 4:e", "Onsdag kväll")
const WEEKDAY_RE = new RegExp(
  '^(måndag|tisdag|onsdag|torsdag|fredag|lördag|söndag)' +
  '((?:\\s+(?:den|\\d{1,2}(?::[ae])?|\\d{1,2}[./-]\\d{1,2}(?:[./-]\\d{2,4})?|' +
  'januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december|' +
  'morgon|morgonen|förmiddag|eftermiddag|kväll|kvällen|natt|natten|igen|forts\\.?))*)\\s*[.:!]?$',
  'i'
);

export function parseDiaryHeading(line: string): Block | null {
  const t = line.trim();
  if (t.length > 40) return null;
  const m = t.match(WEEKDAY_RE);
  if (!m) return null;
  const rest = m[2].trim();
  return { type: 'heading', title: `${capitalize(m[1])}${rest ? ` ${rest === rest.toUpperCase() ? rest.toLowerCase() : rest}` : ''}`, entry: true };
}

function sceneBlocks(spread: Spread, lastChapter: { value?: string }, diary = false): Block[] {
  const blocks: Block[] = [];
  const lines = spread.textBlocks
    .map(b => b.text)
    .join('\n')
    .split(/\n/)
    .map(l => l.trim())
    .filter(Boolean);

  const textHasHeading = lines.some(l => l.length <= 80 && CHAPTER_RE.test(l));
  if (spread.chapter && !textHasHeading && spread.chapter !== lastChapter.value) {
    blocks.push(parseHeading(spread.chapter));
    lastChapter.value = spread.chapter;
  }

  for (const line of lines) {
    const entry = diary ? parseDiaryHeading(line) : null;
    if (entry) {
      blocks.push(entry);
    } else if (line.length <= 80 && CHAPTER_RE.test(line)) {
      blocks.push(parseHeading(line));
      lastChapter.value = line;
    } else {
      blocks.push({ type: 'para', text: normalizeParagraph(line) });
    }
  }
  return blocks;
}

function parseHeading(raw: string): Block {
  const m = raw.trim().match(CHAPTER_RE);
  if (m) {
    const label = m[1].replace(/\s+/g, ' ');
    const title = (m[2] || '').trim();
    return title
      ? { type: 'heading', label: capitalize(label), title }
      : { type: 'heading', title: capitalize(label) };
  }
  return { type: 'heading', title: raw.trim() };
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

// ════════════════════════════════════════════════════════
//  Radbrytning
// ════════════════════════════════════════════════════════

interface Line { text: string; indent: number; width: number; last: boolean }

function breakLines(
  text: string, font: FontSpec, size: number, maxWidth: number, firstIndent: number, m: Measurer
): Line[] {
  const words = text.split(' ').filter(Boolean);
  const lines: Line[] = [];
  let current: string[] = [];
  const space = m.width(' ', font, size);

  const lineWidth = (ws: string[]) =>
    ws.reduce((sum, w) => sum + m.width(w, font, size), 0) + space * Math.max(0, ws.length - 1);

  for (const word of words) {
    const indent = lines.length === 0 ? firstIndent : 0;
    const candidate = [...current, word];
    if (current.length > 0 && lineWidth(candidate) > maxWidth - indent) {
      lines.push({ text: current.join(' '), indent, width: lineWidth(current), last: false });
      current = [word];
    } else {
      current = candidate;
    }
  }
  if (current.length > 0) {
    const indent = lines.length === 0 ? firstIndent : 0;
    lines.push({ text: current.join(' '), indent, width: lineWidth(current), last: true });
  }
  return lines;
}

// ════════════════════════════════════════════════════════
//  Bildplacering
// ════════════════════════════════════════════════════════

function coverFit(box: Box, aspect: number): Box {
  const boxAspect = box.w / box.h;
  if (aspect > boxAspect) {
    const w = box.h * aspect;
    return { x: box.x - (w - box.w) / 2, y: box.y, w, h: box.h };
  }
  const h = box.w / aspect;
  return { x: box.x, y: box.y - (h - box.h) / 2, w: box.w, h };
}

function imageEl(src: string, box: Box, aspect: number): ImageEl {
  return { kind: 'image', src, box, draw: coverFit(box, aspect) };
}

function missingImage(box: Box, font: FontSpec): PageEl[] {
  return [
    { kind: 'rect', box, color: '#efeaf6', opacity: 1, radius: 0 },
    {
      kind: 'text', x: box.x, y: box.y + box.h / 2, width: box.w, text: 'Bild saknas',
      font, size: 9, color: MUTED, align: 'center',
    },
  ];
}

// ════════════════════════════════════════════════════════
//  Sidbyggare
// ════════════════════════════════════════════════════════

interface Typography {
  body: FontSpec;
  heading: FontSpec;
  italic: FontSpec;
  bs(pt: number): number; // brödtextstorlek justerad för typsnittets x-höjd
  hs(pt: number): number; // rubrikstorlek, dito
}

export function bookFontFamilies(book: BookProject): FontFamily[] {
  const preset = getStylePreset(book.stylePresetId);
  const body = preset?.fonts.body ?? 'Literata';
  const heading = preset?.fonts.heading ?? body;
  return body === heading ? [body] : [body, heading];
}

function fontsFor(book: BookProject): Typography {
  const [body, heading = body] = bookFontFamilies(book);
  const round = (n: number) => Math.round(n * 4) / 4;
  return {
    body: { family: body, style: 'normal' },
    heading: { family: heading, style: 'bold' },
    italic: { family: body, style: 'italic' },
    bs: pt => round(pt * BOOK_FONTS[body].scale),
    hs: pt => round(pt * BOOK_FONTS[heading].scale),
  };
}

function pageLabel(index: number, total: number): string {
  if (index === 0) return 'Omslag';
  if (index === total - 1) return 'Baksida';
  return `Sida ${index + 1}`;
}

class PageBuilder {
  pages: LayoutPage[] = [];

  add(page: Omit<LayoutPage, 'label'>): LayoutPage {
    const p: LayoutPage = { ...page, label: '' };
    this.pages.push(p);
    return p;
  }

  get count() { return this.pages.length; }

  // Sidnummer räknas från omslaget (sida 1). Udda = högersida.
  isRecto(index = this.count) { return index % 2 === 0; }
}

function addPageNumber(page: LayoutPage, index: number, t: Typography) {
  page.els.push({
    kind: 'text', x: 0, y: PAGE_H - 12, width: PAGE_W, text: String(index + 1),
    font: t.body, size: 8.5, color: MUTED, align: 'center',
  });
}

function ornament(page: LayoutPage, y: number) {
  const w = 14;
  page.els.push({ kind: 'rect', box: { x: (PAGE_W - w) / 2, y, w, h: 0.5 }, color: '#b9b2c4', opacity: 1, radius: 0.25 });
}

function centeredLines(
  page: LayoutPage, text: string, font: FontSpec, size: number, y: number, maxWidth: number, color: string, m: Measurer, leading = 1.25
): number {
  const lines = breakLines(text, font, size, maxWidth, 0, m);
  const lh = size * PT * leading;
  lines.forEach((line, i) => {
    page.els.push({
      kind: 'text', x: 0, y: y + i * lh, width: PAGE_W, text: line.text, font, size, color, align: 'center',
    });
  });
  return y + lines.length * lh;
}

// ── Framsida, titelsida, redaktionssida ──
function buildFrontMatter(pb: PageBuilder, book: BookProject, cover: Spread | undefined, sizes: ImageSizes, t: Typography, m: Measurer) {
  const coverSrc = cover ? spreadImageSrc(cover) : undefined;
  const full: Box = { x: 0, y: 0, w: PAGE_W, h: PAGE_H };

  if (coverSrc) {
    const size = sizes.get(coverSrc);
    pb.add({ els: [imageEl(coverSrc, full, size ? size.w / size.h : 3 / 4)] });
  } else {
    const p = pb.add({ els: [], background: '#2f2a4a' });
    centeredLines(p, book.title, t.heading, t.hs(30), 80, 120, '#ffffff', m, 1.15);
  }

  // Insida pärm
  pb.add({ els: [] });

  // Titelsida
  const title = pb.add({ els: [] });
  let y = centeredLines(title, book.title, t.heading, t.hs(26), 72, 118, INK, m, 1.2);
  ornament(title, y + 4);
  if (book.subtitle) y = centeredLines(title, book.subtitle, t.italic, t.bs(12), y + 14, 110, MUTED, m);
  if (book.author) centeredLines(title, book.author, t.body, t.bs(12), y + 16, 110, INK, m);

  // Redaktionssida
  const imprint = pb.add({ els: [] });
  const preset = getStylePreset(book.stylePresetId);
  const year = new Date(book.createdAt || Date.now()).getFullYear();
  const lines = [
    `${book.title}`,
    `© ${year} ${book.author || 'Författaren'}`,
    preset ? `Illustrationer i stilen ${preset.label}` : 'Illustrationer skapade med AI',
    `Typsnitt: ${Array.from(new Set([BOOK_FONTS[t.body.family].name, BOOK_FONTS[t.heading.family].name])).join(' och ')}`,
    'Skapad med Bokverktyget',
  ];
  lines.forEach((line, i) => {
    imprint.els.push({
      kind: 'text', x: 18, y: PAGE_H - 48 + i * 4.6, width: 120, text: line,
      font: i === 0 ? t.heading : t.body, size: 7.5, color: MUTED, align: 'left',
    });
  });
}

function buildHalfTitle(pb: PageBuilder, book: BookProject, t: Typography, m: Measurer) {
  const p = pb.add({ els: [] });
  const y = centeredLines(p, book.title, t.heading, t.hs(14), 92, 110, INK, m);
  ornament(p, y + 3);
}

function buildBackCover(pb: PageBuilder, book: BookProject, t: Typography, m: Measurer) {
  // Tryckta böcker har ett sidantal delbart med 4
  while ((pb.count + 1) % 4 !== 0) pb.add({ els: [] });
  const back = pb.add({ els: [], background: '#2f2a4a' });
  const y = centeredLines(back, book.title, t.heading, t.hs(16), 88, 110, '#ffffff', m);
  back.els.push({ kind: 'rect', box: { x: (PAGE_W - 14) / 2, y: y + 4, w: 14, h: 0.5 }, color: '#ffffff', opacity: 0.5, radius: 0.25 });
  back.els.push({
    kind: 'text', x: 0, y: PAGE_H - 18, width: PAGE_W, text: 'Skapad med Bokverktyget',
    font: t.body, size: 7.5, color: '#c9c3d6', align: 'center',
  });
}

// ════════════════════════════════════════════════════════
//  Textkolumn (delas av bilderboks- och kapitelboksläget)
// ════════════════════════════════════════════════════════

interface ColumnStyle {
  size: number;
  leading: number; // multipel av storleken
  indent: number; // mm, första raden i stycke (inte efter rubrik)
  paraGap: number; // mm mellan stycken
  justify: boolean;
  font: FontSpec;
  heading: FontSpec;
  headingScale: number; // rubrikens storlek relativt brödtexten
  lined?: boolean; // linjerat papper: styckeluften (en tom linje) behöver inte rymmas längst ner på sidan
}

// gap: luft efter raden som får hamna utanför sidans nederkant
interface PlacedLine { el: TextEl; height: number; paraStart: boolean; paraIndex: number; keepWithNext?: boolean; gap?: number }

// Lägger ut block som en lång remsa rader (y relativt 0), för att sedan kunna
// mäta höjd eller fördela över sidor
function setColumn(blocks: Block[], width: number, style: ColumnStyle, m: Measurer, firstIndented = false): PlacedLine[] {
  const out: PlacedLine[] = [];
  const lh = style.size * PT * style.leading;
  let afterHeading = !firstIndented;
  let paraIndex = 0;

  for (const block of blocks) {
    if (block.type === 'heading') {
      const hs = Math.round(style.size * 1.15 * style.headingScale * 4) / 4;
      if (block.label) {
        out.push({
          el: { kind: 'text', x: 0, y: 0, width, text: block.label.toUpperCase(), font: style.font, size: style.size * 0.7, color: MUTED, align: 'left', tracking: 0.6 },
          height: style.size * 0.7 * PT * 1.8, paraStart: true, paraIndex: paraIndex++, keepWithNext: true,
        });
      }
      for (const line of breakLines(block.title, style.heading, hs, width, 0, m)) {
        out.push({
          el: { kind: 'text', x: 0, y: 0, width, text: line.text, font: style.heading, size: hs, color: INK, align: 'left' },
          height: hs * PT * 1.3, paraStart: true, paraIndex: paraIndex++, keepWithNext: true,
        });
      }
      if (out.length > 0) out[out.length - 1].height += lh * 0.6;
      afterHeading = true;
      continue;
    }
    if (block.type !== 'para') continue;

    const indent = afterHeading || block.continued ? 0 : style.indent;
    const lines = breakLines(block.text, style.font, style.size, width, indent, m);
    lines.forEach((line, i) => {
      const gaps = line.text.split(' ').length - 1;
      const justify = style.justify && !line.last && gaps > 0;
      out.push({
        el: {
          kind: 'text', x: line.indent, y: 0, width: width - line.indent, text: line.text,
          font: style.font, size: style.size, color: INK,
          align: justify ? 'justify' : 'left',
          wordSpacing: justify ? (width - line.indent - line.width) / gaps : undefined,
        },
        height: lh + (line.last ? style.paraGap : 0),
        gap: style.lined && line.last ? style.paraGap : undefined,
        paraStart: i === 0, paraIndex,
      });
    });
    paraIndex++;
    afterHeading = false;
  }
  return out;
}

function columnHeight(lines: PlacedLine[]): number {
  return lines.reduce((h, l) => h + l.height, 0);
}

// Placera rader i en ruta; returnerar hur många som fick plats.
// Undviker ensam första rad sist på sidan och ensam sista rad överst på nästa.
function fitLines(lines: PlacedLine[], start: number, available: number): number {
  let used = 0;
  let n = 0;
  while (start + n < lines.length && used + lines[start + n].height - (lines[start + n].gap ?? 0) <= available + 0.01) {
    used += lines[start + n].height;
    n++;
  }
  if (start + n >= lines.length || n === 0) return n;

  const next = lines[start + n];
  const prev = lines[start + n - 1];
  // Rubrik får aldrig bli ensam sist på sidan
  let k = n;
  while (k > 1 && lines[start + k - 1].keepWithNext) k--;
  if (k < n) return k;
  // Föräldralös rad: stycket börjar på sista raden
  if (prev.paraIndex === next.paraIndex && prev.paraStart && n > 1) return n - 1;
  // Änka: bara stycket sista rad hamnar på nästa sida
  if (next.paraIndex === prev.paraIndex) {
    const remaining = lines.slice(start + n).filter(l => l.paraIndex === next.paraIndex).length;
    const onPage = lines.slice(start, start + n).filter(l => l.paraIndex === next.paraIndex).length;
    if (remaining === 1 && onPage >= 3) return n - 1;
  }
  return n;
}

function emitLines(page: LayoutPage, lines: PlacedLine[], x: number, top: number) {
  let y = top;
  for (const line of lines) {
    const baseline = y + line.el.size * PT * 0.95;
    page.els.push({ ...line.el, x: x + line.el.x, y: baseline });
    y += line.height;
  }
}

// ════════════════════════════════════════════════════════
//  Bilderbok: text och bild möts i uppslag
// ════════════════════════════════════════════════════════

const PB_MARGIN = { top: 22, bottom: 26, inner: 18, outer: 16 };

function textArea(recto: boolean): Box {
  const x = recto ? PB_MARGIN.inner : PB_MARGIN.outer;
  return { x, y: PB_MARGIN.top, w: PAGE_W - PB_MARGIN.inner - PB_MARGIN.outer, h: PAGE_H - PB_MARGIN.top - PB_MARGIN.bottom };
}

function pictureStyle(t: Typography, size: number): ColumnStyle {
  const s = t.bs(size);
  return { size: s, leading: 1.5, indent: 0, paraGap: s * PT * 0.55, justify: false, font: t.body, heading: t.heading, headingScale: t.hs(10) / t.bs(10) };
}

// Flödar text över så många sidor som behövs; returnerar sidorna
function flowTextPages(pb: PageBuilder, lines: PlacedLine[], t: Typography, center: boolean): LayoutPage[] {
  const pages: LayoutPage[] = [];
  let i = 0;
  while (i < lines.length) {
    const area = textArea(pb.isRecto());
    const n = Math.max(1, fitLines(lines, i, area.h));
    const page = pb.add({ els: [] });
    const chunk = lines.slice(i, i + n);
    const h = columnHeight(chunk);
    // Kort text sätts på optisk mitt i stället för högst upp
    const top = center && i === 0 && i + n >= lines.length && h < area.h * 0.7
      ? Math.max(area.y, PAGE_H * 0.44 - h / 2)
      : area.y;
    emitLines(page, chunk, area.x, top);
    addPageNumber(page, pb.count - 1, t);
    pages.push(page);
    i += n;
  }
  return pages;
}

function fullPageImage(pb: PageBuilder, src: string | undefined, sizes: ImageSizes, t: Typography) {
  const full: Box = { x: 0, y: 0, w: PAGE_W, h: PAGE_H };
  if (!src) return pb.add({ els: missingImage(full, t.body) });
  const s = sizes.get(src);
  return pb.add({ els: [imageEl(src, full, s ? s.w / s.h : 3 / 4)] });
}

function buildPictureBook(pb: PageBuilder, scenes: Scene[], shape: IllustrationShape, sizes: ImageSizes, t: Typography, m: Measurer) {
  const textW = textArea(true).w;
  const maxH = textArea(true).h;

  scenes.forEach((scene, i) => {
    // Uppslag börjar alltid på en vänstersida så att text och bild möts
    if (pb.isRecto()) pb.add({ els: [] });

    if (shape === 'spread') {
      buildSpreadScene(pb, scene, sizes, t, m);
      return;
    }

    // Största textgrad som ryms på en sida
    let lines: PlacedLine[] = [];
    for (const size of [15, 14, 13, 12]) {
      lines = setColumn(scene.blocks, textW, pictureStyle(t, size), m);
      if (columnHeight(lines) <= maxH) break;
    }

    const imageFirst = i % 2 === 1;
    if (scene.blocks.length === 0) {
      fullPageImage(pb, scene.image, sizes, t);
      pb.add({ els: [] });
      return;
    }

    if (imageFirst) {
      fullPageImage(pb, scene.image, sizes, t);
      flowTextPages(pb, lines, t, true);
    } else {
      // Första textsidan till vänster, bilden mitt emot, ev. fortsättning efteråt
      const area = textArea(false);
      const n = Math.max(1, fitLines(lines, 0, area.h));
      const first = pb.add({ els: [] });
      const chunk = lines.slice(0, n);
      const h = columnHeight(chunk);
      const top = n >= lines.length && h < area.h * 0.7 ? Math.max(area.y, PAGE_H * 0.44 - h / 2) : area.y;
      emitLines(first, chunk, area.x, top);
      addPageNumber(first, pb.count - 1, t);
      fullPageImage(pb, scene.image, sizes, t);
      if (n < lines.length) flowTextPages(pb, lines.slice(n), t, false);
    }
  });
}

// Liggande uppslagsbild med texten i en panel på den lugna sidan
function buildSpreadScene(pb: PageBuilder, scene: Scene, sizes: ImageSizes, t: Typography, m: Measurer) {
  const side = textSideForSpread(scene.spread.spreadNumber);
  const pad = 8;
  const panelMargin = 15;
  const innerW = PAGE_W - panelMargin * 2 - pad * 2;
  const maxInnerH = PAGE_H - panelMargin * 2 - pad * 2;

  let lines: PlacedLine[] = [];
  let fits = false;
  for (const size of [14, 13, 12]) {
    lines = setColumn(scene.blocks, innerW, pictureStyle(t, size), m);
    if (columnHeight(lines) <= maxInnerH * 0.8) { fits = true; break; }
  }

  const src = scene.image;
  const aspect = src && sizes.get(src) ? sizes.get(src)!.w / sizes.get(src)!.h : 3 / 2;
  const spreadBox = (offset: number): PageEl[] => {
    const box: Box = { x: 0, y: 0, w: PAGE_W, h: PAGE_H };
    if (!src) return missingImage(box, t.body);
    const draw = coverFit({ x: 0, y: 0, w: PAGE_W * 2, h: PAGE_H }, aspect);
    return [{ kind: 'image', src, box, draw: { ...draw, x: draw.x - offset } }];
  };

  // För mycket text för en panel: textuppslag före bilduppslaget
  if (!fits && scene.blocks.length > 0) {
    lines = setColumn(scene.blocks, textArea(true).w, pictureStyle(t, 12.5), m);
    const pages = flowTextPages(pb, lines, t, true);
    if (pages.length % 2 === 1) pb.add({ els: [] });
    const left = pb.add({ els: spreadBox(0) });
    const right = pb.add({ els: spreadBox(PAGE_W) });
    void left; void right;
    return;
  }

  const left = pb.add({ els: spreadBox(0) });
  const right = pb.add({ els: spreadBox(PAGE_W) });
  if (scene.blocks.length === 0) return;

  const target = side === 'left' ? left : right;
  const h = columnHeight(lines);
  const panel: Box = { x: panelMargin, y: panelMargin + 4, w: PAGE_W - panelMargin * 2, h: h + pad * 2 };
  target.els.push({ kind: 'rect', box: panel, color: '#ffffff', opacity: 0.9, radius: 5 });
  emitLines(target, lines, panel.x + pad, panel.y + pad);
}

// ════════════════════════════════════════════════════════
//  Kapitelbok: löpande text med kapitelöppningar och bilder
// ════════════════════════════════════════════════════════

const CB_MARGIN = { top: 22, bottom: 27, inner: 19, outer: 16 };

function buildChapterBook(pb: PageBuilder, scenes: Scene[], shape: IllustrationShape, sizes: ImageSizes, t: Typography, m: Measurer, lively = false, paper?: 'lined') {
  const textW = PAGE_W - CB_MARGIN.inner - CB_MARGIN.outer;
  const lined = paper === 'lined';
  // Linjerat skrivhäfte: handskrift i vänsterkant på linjerna, en tom linje mellan stycken
  const style: ColumnStyle = lined
    ? { size: t.bs(12), leading: 1.45, indent: 0, paraGap: 0, justify: false, font: t.body, heading: t.heading, headingScale: t.hs(10) / t.bs(10), lined: true }
    : { size: t.bs(11.5), leading: 1.55, indent: 5, paraGap: 0, justify: true, font: t.body, heading: t.heading, headingScale: t.hs(10) / t.bs(10) };
  const lh = style.size * PT * style.leading;
  if (lined) style.paraGap = lh;
  const GAP = 4; // luft mellan figur och text

  // ── Linjerat papper ──
  // Radernas överkant ligger på ett fast rutnät med radavståndet, så att baslinjerna
  // alltid hamnar exakt på linjerna
  const baselineOffset = style.size * PT * 0.95;
  const RULE = { color: '#c3cedb', h: 0.22, margin: 7 };
  const snap = (v: number) => (lined ? CB_MARGIN.top + Math.max(0, Math.ceil((v - CB_MARGIN.top) / lh - 0.02)) * lh : v);
  const ruleEl = (x0: number, x1: number, lineTop: number): RectEl => ({
    kind: 'rect', box: { x: x0, y: lineTop + baselineOffset + 0.15, w: x1 - x0, h: RULE.h }, color: RULE.color, opacity: 1, radius: 0,
  });
  const pageRules = (): RectEl[] => {
    const rules: RectEl[] = [];
    for (let top = CB_MARGIN.top; top + baselineOffset <= PAGE_H - CB_MARGIN.bottom + 0.01; top += lh) {
      rules.push(ruleEl(RULE.margin, PAGE_W - RULE.margin, top));
    }
    return rules;
  };
  // Nästa textrad under en bild: på linjerat papper närmaste lediga linje
  const below = (edge: number, extra: number) => (lined ? snap(edge + Math.min(extra, lh * 0.4)) : edge + extra);

  let page: LayoutPage | null = null;
  let y = CB_MARGIN.top;
  let bottom = PAGE_H - CB_MARGIN.bottom; // flyttas upp när ett band ligger längst ner
  let numbered = true;
  const pendingImages: (string | undefined)[] = [];
  const pendingSpreads: (string | undefined)[] = [];
  let pageHasText = false;
  let spotCount = 0;

  // Figur som texten flyter runt på aktuell sida
  type WrapZone = { top: number; bottom: number; side: 'left' | 'right'; occupied: (y0: number, y1: number) => number };
  let wrap = null as WrapZone | null;

  const xFor = () => (pb.isRecto(pb.count - 1) ? CB_MARGIN.inner : CB_MARGIN.outer);
  const aspectOf = (src: string, fallback: number) => {
    const s = sizes.get(src);
    return s ? s.w / s.h : fallback;
  };

  // Uppslag över två sidor börjar alltid på en vänstersida
  const spreadPages = (src: string | undefined) => {
    for (let side = 0; side < 2; side++) {
      const box: Box = { x: 0, y: 0, w: PAGE_W, h: PAGE_H };
      if (!src) { pb.add({ els: missingImage(box, t.body) }); continue; }
      const draw = coverFit({ x: 0, y: 0, w: PAGE_W * 2, h: PAGE_H }, aspectOf(src, 3 / 2));
      pb.add({ els: [{ kind: 'image', src, box, draw: { ...draw, x: draw.x - side * PAGE_W } }] });
    }
  };

  const closePage = () => {
    if (!page) return;
    if (pageHasText && numbered) addPageNumber(page, pb.count - 1, t);
    // Linjerna ligger underst - bilder på vitt papper täcker dem
    if (lined && pageHasText) page.els.unshift(...pageRules());
    // Helsidor och uppslag läggs in vid sidbrytningar så att texten flyter vidare -
    // högst en per brytning så att bilder aldrig hamnar i rad
    if (pendingImages.length > 0) fullPageImage(pb, pendingImages.shift(), sizes, t);
    else if (pendingSpreads.length > 0 && !pb.isRecto(pb.count)) spreadPages(pendingSpreads.shift());
    page = null;
  };

  // Serierutor som väntar på att sidan fylls med text - de hamnar överst på nästa sida
  const pendingTop: (string | undefined)[] = [];
  const placePanels = (src: string | undefined, h: number, aspect: number) => {
    const w = h * aspect;
    const box: Box = { x: xFor() + (textW - w) / 2, y, w, h };
    page!.els.push(...(src ? [imageEl(src, box, aspect)] : missingImage(box, t.body)));
    y = below(y + h, lh);
    pageHasText = true;
  };

  const openPage = () => {
    closePage();
    page = pb.add({ els: [] });
    y = CB_MARGIN.top;
    bottom = PAGE_H - CB_MARGIN.bottom;
    numbered = true;
    pageHasText = false;
    wrap = null;
    if (pendingTop.length > 0) {
      const waiting = pendingTop.shift();
      const aspect = waiting ? aspectOf(waiting, 4 / 5) : 4 / 5;
      placePanels(waiting, Math.min(textW / aspect, PAGE_H - CB_MARGIN.top - CB_MARGIN.bottom - lh * 3), aspect);
    }
  };

  let justOpened = false;

  const ensureSpace = (h: number) => {
    if (!page || y + h > bottom) openPage();
  };

  // Hur mycket av textbredden en figur tar på höjden y0-y1 (mm från sin sida), med luft
  const occupiedFn = (src: string, box: Box, side: 'left' | 'right', x0: number) => (y0: number, y1: number) => {
    if (y1 <= box.y || y0 >= box.y + box.h) return 0;
    const rows = sizes.get(src)?.rows;
    let extent = 1;
    if (rows && rows.length > 0) {
      const a = Math.max(0, Math.floor(((y0 - box.y) / box.h) * rows.length));
      const b = Math.min(rows.length - 1, Math.ceil(((y1 - box.y) / box.h) * rows.length));
      extent = 0;
      for (let k = a; k <= b; k++) {
        const r = rows[k];
        if (!r) continue;
        extent = Math.max(extent, side === 'left' ? r.r : 1 - r.l);
      }
      if (extent === 0) return 0; // tom rad i bilden: texten får hela bredden
    }
    const reach = side === 'left' ? box.x + box.w * extent - x0 : x0 + textW - (box.x + box.w * (1 - extent));
    return Math.max(0, reach + GAP);
  };

  const placeSceneImage = (src: string | undefined, composition: Composition | undefined) => {
    if (!src && !composition) return;
    const comp = composition ?? (shape === 'page' ? 'full' : undefined);

    if (comp === 'full') { pendingImages.push(src); return; }
    if (comp === 'spread') { pendingSpreads.push(src); return; }

    if (comp === 'band') {
      const h = PAGE_W / aspectOf(src ?? '', 16 / 9);
      const bandH = Math.min(h, 92);
      if (page && justOpened && y + bandH + lh * 4 < bottom) {
        // Direkt under en kapitelrubrik: bandet går över hela sidbredden
        const box: Box = { x: 0, y, w: PAGE_W, h: bandH };
        page.els.push(...(src ? [imageEl(src, box, aspectOf(src, 16 / 9))] : missingImage(box, t.body)));
        y = below(y + bandH, lh * 0.8);
      } else if (page && pageHasText && y + lh * 4 < bottom - bandH) {
        // Band längst ner på sidan, utfallande - texten tar slut ovanför
        const box: Box = { x: 0, y: PAGE_H - bandH, w: PAGE_W, h: bandH };
        page.els.push(...(src ? [imageEl(src, box, aspectOf(src, 16 / 9))] : missingImage(box, t.body)));
        bottom = PAGE_H - bandH - lh;
        numbered = false;
      } else {
        // Band överst på en ny sida, utfallande
        if (!page || pageHasText) openPage();
        const box: Box = { x: 0, y: 0, w: PAGE_W, h: bandH };
        page!.els.push(...(src ? [imageEl(src, box, aspectOf(src, 16 / 9))] : missingImage(box, t.body)));
        y = below(bandH, lh * 1.2);
        pageHasText = true;
      }
      return;
    }

    if (comp === 'spot' || comp === 'round') {
      // Varierad storlek och placering - figurer får gärna gå ut i marginalen
      const variants = comp === 'round' ? [0.62] : [0.58, 0.72, 0.5, 0.66];
      let size = textW * variants[spotCount % variants.length];
      // Hellre en mindre figur än en halvtom sida
      if (page && y + size > bottom + lh && bottom + lh - y >= textW * 0.42) size = bottom + lh - y;
      // Mest till höger eller vänster så att texten kan flyta runt; ibland mitt i
      const align = comp === 'round' ? (spotCount % 2 ? 'left' : 'right') : (['right', 'left', 'right', 'left', 'center'] as const)[spotCount % 5];
      spotCount++;
      // Figuren läggs aldrig över text som redan är satt: ryms den inte, ny sida
      if (!page || y + size > bottom + lh) openPage();
      const x0 = xFor();
      const bleed = comp === 'spot' ? 8 : 0;
      const x = align === 'left' ? x0 - bleed : align === 'right' ? x0 + textW - size + bleed : x0 + (textW - size) / 2;
      const box: Box = { x, y, w: size, h: Math.min(size, bottom + lh - y) };
      if (src) page!.els.push({ ...imageEl(src, box, aspectOf(src, 1)), ...(comp === 'round' ? { clip: 'circle' as const } : {}) });
      else page!.els.push(...missingImage(box, t.body));
      pageHasText = true;
      if (align === 'center') {
        y = Math.max(y, below(box.y + box.h, lh * 0.6));
      } else {
        // Texten flyter runt figuren
        wrap = {
          top: box.y, bottom: box.y + box.h, side: align,
          occupied: src && comp === 'spot' ? occupiedFn(src, box, align, x0) : (y0, y1) => (y1 <= box.y || y0 >= box.y + size ? 0 : (align === 'left' ? box.x + size - x0 : x0 + textW - box.x) + GAP),
        };
      }
      return;
    }

    if (comp === 'panels') {
      const aspect = src ? aspectOf(src, 4 / 5) : 4 / 5;
      const full = Math.min(textW / aspect, PAGE_H - CB_MARGIN.top - CB_MARGIN.bottom - lh * 3);
      const room = page ? bottom - y - lh * 2 : full;
      // Ryms rutorna inte: hellre lite mindre än en halvtom sida, annars
      // fyller texten sidan och rutorna börjar överst på nästa
      if (room < full && room < full * 0.72 && pageHasText) { pendingTop.push(src); return; }
      if (!page) openPage();
      const h = Math.min(full, Math.max(room, full * 0.72));
      placePanels(src, h, aspect);
      return;
    }

    // Uppslagsformade bilder i kapitelbok utan blandning: bild överst i textflödet
    if (!src) return;
    const aspect = aspectOf(src, 3 / 2);
    const imgH = Math.min(textW / aspect, 92);
    ensureSpace(imgH + lh * 3);
    page!.els.push(imageEl(src, { x: xFor(), y, w: textW, h: imgH }, aspect));
    y = below(y + imgH, lh);
    pageHasText = true;
  };

  // Rader bredvid en figur: bredden följer figurens kontur rad för rad.
  // Returnerar det som återstår (resten av ett avbrutet stycke + följande block).
  const flowAroundWrap = (run: Block[]): Block[] => {
    const space = m.width(' ', style.font, style.size);
    const wordW = (w: string) => m.width(w, style.font, style.size);
    let afterHeading = justOpened;
    for (let b = 0; b < run.length; b++) {
      const block = run[b];
      if (block.type !== 'para') return run.slice(b);
      const words = block.text.split(' ').filter(Boolean);
      let first = true;
      while (words.length > 0) {
        if (!wrap || y >= wrap.bottom || y + lh > bottom) {
          const rest = { type: 'para' as const, text: words.join(' '), continued: !first || block.continued };
          return [rest, ...run.slice(b + 1)];
        }
        const occ = wrap.occupied(y, y + lh);
        const avail = textW - occ;
        const x0 = xFor();
        if (avail < 28) { y += lh; continue; } // för smalt bredvid figuren - hoppa ner en rad
        const indent = first && !afterHeading && !block.continued ? style.indent : 0;
        const line: string[] = [];
        let width = 0;
        while (words.length > 0) {
          const nextW = width + (line.length ? space : 0) + wordW(words[0]);
          if (line.length > 0 && nextW > avail - indent) break;
          line.push(words.shift()!);
          width = nextW;
        }
        const last = words.length === 0;
        const gaps = line.length - 1;
        // Smala rader bredvid en figur blir ojämna i högerkanten i stället för glesa
        const justify = style.justify && !last && gaps > 0 && avail > 70;
        const lineX = (wrap.side === 'left' ? x0 + occ : x0) + indent;
        // Bildens vita yta täcker sidans linjer - rita linjen igen under raden bredvid figuren
        if (lined) page!.els.push(wrap.side === 'left' ? ruleEl(x0 + occ - 1, PAGE_W - RULE.margin, y) : ruleEl(RULE.margin, x0 + avail + 1, y));
        page!.els.push({
          kind: 'text', x: lineX, y: y + style.size * PT * 0.95, width: avail - indent, text: line.join(' '),
          font: style.font, size: style.size, color: INK,
          align: justify ? 'justify' : 'left',
          wordSpacing: justify ? (avail - indent - width) / gaps : undefined,
        });
        y += lh;
        first = false;
      }
      y += style.paraGap;
      afterHeading = false;
    }
    return [];
  };

  for (const scene of scenes) {
    // Figurer och vinjetter hamnar mitt i scenen, där det händer - inte före texten
    let blocks: Block[] = scene.blocks;
    const comp = scene.spread.composition;
    const paraIdx = blocks.map((bl, k) => (bl.type === 'para' ? k : -1)).filter(k => k >= 0);
    let imagePlaced = false;
    if ((comp === 'spot' || comp === 'round') && paraIdx.length >= 3) {
      const at = paraIdx[Math.max(1, Math.round(paraIdx.length * 0.35))];
      blocks = [...blocks.slice(0, at), { type: 'image', src: scene.image, aspect: 1, spreadNumber: scene.spread.spreadNumber, composition: comp }, ...blocks.slice(at)];
      imagePlaced = true;
    }

    while (blocks.length > 0 || !imagePlaced) {
      const headingIdx = blocks.findIndex(b => b.type === 'heading');

      // Kapitel börjar på ny sida med öppningsrubrik
      if (headingIdx === 0 && lined) {
        // Dagbok: kort handskriven, understruken rubrik på nästa linje. Veckodagar
        // fortsätter på samma sida; riktiga kapitel börjar på ny sida.
        const heading = blocks[0] as Extract<Block, { type: 'heading' }>;
        if (!page || (!heading.entry && pageHasText)) openPage();
        const hs = Math.round(style.size * 1.2 * 4) / 4;
        const text = heading.label ? `${heading.label}: ${heading.title}` : heading.title;
        const headLines = breakLines(text, style.heading, hs, textW, 0, m);
        // Rubriken + två rader text ska rymmas - och scenens bild om den kommer direkt
        // efter rubriken - annars ny sida, så att rubriken aldrig blir ensam kvar
        let follow = lh * 2;
        if (!imagePlaced && page && pageHasText) {
          const aspect = scene.image ? aspectOf(scene.image, comp === 'band' ? 16 / 9 : comp === 'panels' ? 4 / 5 : 1) : 1;
          if (comp === 'band') follow = Math.min(PAGE_W / aspect, 92) + lh * 4;
          else if (comp === 'panels') follow = Math.min(textW / aspect, PAGE_H - CB_MARGIN.top - CB_MARGIN.bottom - lh * 3) + lh * 2;
          else if (comp === 'spot' || comp === 'round') follow = textW * 0.42;
        }
        if (y + lh * headLines.length + follow > bottom) openPage();
        for (const hl of headLines) {
          // Bredvid en figur: rubriken ställs bredvid den, eller längre ner där den ryms
          let x = xFor();
          let occ = 0;
          while (wrap && y < wrap.bottom) {
            occ = wrap.occupied(y, y + lh);
            if (textW - occ >= hl.width + 2) break;
            occ = 0;
            y += lh;
          }
          if (y + lh > bottom) { openPage(); occ = 0; }
          if (wrap && y < wrap.bottom) {
            if (wrap.side === 'left') x += occ;
            page!.els.push(wrap.side === 'left' ? ruleEl(x - 1, PAGE_W - RULE.margin, y) : ruleEl(RULE.margin, x + textW - occ + 1, y));
          }
          const baseline = y + baselineOffset;
          page!.els.push({ kind: 'text', x, y: baseline, width: textW, text: hl.text, font: style.heading, size: hs, color: INK, align: 'left' });
          page!.els.push({ kind: 'rect', box: { x: x - 0.5, y: baseline + 1.1, w: hl.width + 1.5, h: 0.45 }, color: INK, opacity: 1, radius: 0.2 });
          y += lh;
        }
        pageHasText = true;
        justOpened = true;
        blocks = blocks.slice(1);
        continue;
      }

      if (headingIdx === 0) {
        const heading = blocks[0] as Extract<Block, { type: 'heading' }>;
        if (!page || pageHasText) openPage();
        let hy = CB_MARGIN.top + (lively ? 8 : 38);
        if (heading.label) {
          page!.els.push({
            kind: 'text', x: 0, y: hy, width: PAGE_W, text: heading.label.toUpperCase(),
            font: t.body, size: 8.5, color: MUTED, align: 'center', tracking: 0.9,
          });
          hy += 10;
        }
        hy = centeredLines(page!, heading.title, t.heading, t.hs(19), hy, textW, INK, m, 1.2);
        if (!lively) ornament(page!, hy + 1);
        y = hy + (lively ? 9 : 14);
        pageHasText = true;
        justOpened = true;
        blocks = blocks.slice(1);
        continue;
      }

      if (blocks[0]?.type === 'image') {
        const img = blocks[0];
        placeSceneImage(img.src, img.composition);
        blocks = blocks.slice(1);
        continue;
      }

      // Scenens bild efter en ev. inledande kapitelrubrik, före brödtexten
      if (!imagePlaced) {
        placeSceneImage(scene.image, comp);
        imagePlaced = true;
        if (blocks.length === 0) break;
      }

      // Text bredvid en figur flyter runt den
      if (wrap && page && y < wrap.bottom) {
        const stopAt = blocks.findIndex(b => b.type !== 'para');
        const run = stopAt === -1 ? blocks : blocks.slice(0, stopAt);
        const rest = flowAroundWrap(run);
        blocks = [...rest, ...(stopAt === -1 ? [] : blocks.slice(stopAt))];
        justOpened = false;
        if (wrap && y >= wrap.bottom) y = Math.max(y, below(wrap.bottom, lh * 0.3));
        if (y + lh > bottom && blocks.length > 0) openPage();
        continue;
      }

      const nextBreak = blocks.findIndex(b => b.type !== 'para');
      const run = nextBreak === -1 ? blocks : blocks.slice(0, nextBreak);
      blocks = nextBreak === -1 ? [] : blocks.slice(nextBreak);
      const lines = setColumn(run, textW, style, m, !justOpened);
      justOpened = false;

      let i = 0;
      while (i < lines.length) {
        if (!page) openPage();
        const n = fitLines(lines, i, bottom - y);
        if (n === 0) {
          if (!pageHasText) { // raden ryms inte ens på tom sida - tvinga
            emitLines(page!, lines.slice(i, i + 1), xFor(), y);
            i++;
          }
          openPage();
          continue;
        }
        const chunk = lines.slice(i, i + n);
        emitLines(page!, chunk, xFor(), y);
        y += columnHeight(chunk);
        pageHasText = true;
        i += n;
        if (i < lines.length) openPage();
      }
    }
  }
  if (pendingTop.length > 0) openPage(); // rutor som väntade när texten tog slut
  closePage();
  // Bilder som köats efter sista textsidan
  while (pendingImages.length > 0) fullPageImage(pb, pendingImages.shift(), sizes, t);
  while (pendingSpreads.length > 0) {
    // Ett uppslag som inte hamnar på en vänstersida blir en helsida i stället
    if (pb.isRecto(pb.count)) fullPageImage(pb, pendingSpreads.shift(), sizes, t);
    else spreadPages(pendingSpreads.shift());
  }
}

// ════════════════════════════════════════════════════════
//  Serieformat: bilderna innehåller redan texten
// ════════════════════════════════════════════════════════

// Seriesidans papper - samma off-white som sidbilderna ritas på
const COMIC_PAPER = '#fbf7ee';

function buildComicBook(pb: PageBuilder, spreads: Spread[], sizes: ImageSizes, t: Typography, shape: IllustrationShape) {
  for (const spread of spreads) {
    const src = spreadImageSrc(spread);
    const known = src ? sizes.get(src) : undefined;

    // Stående seriesida (serieroman): varje bild blir en hel boksida, i bokens ordning
    if (known ? known.w / known.h < 1 : shape === 'page') {
      const aspect = known ? known.w / known.h : 3 / 4;
      // Hela sidan med en smal pappersmarginal, och luft längst ner för sidnumret
      const area: Box = { x: 6, y: 6, w: PAGE_W - 12, h: PAGE_H - 22 };
      const w = Math.min(area.w, area.h * aspect);
      const h = w / aspect;
      const box: Box = { x: (PAGE_W - w) / 2, y: area.y + (area.h - h) / 2, w, h };
      const page = pb.add({
        els: src ? [{ kind: 'image', src, box, draw: box }] : missingImage(box, t.body),
        background: COMIC_PAPER,
      });
      page.els.push({
        kind: 'text', x: 0, y: PAGE_H - 7.5, width: PAGE_W, text: String(pb.count),
        font: t.body, size: 8.5, color: MUTED, align: 'center',
      });
      continue;
    }

    // Liggande serieuppslag: bilden delas över två sidor som börjar på en vänstersida
    if (pb.isRecto()) pb.add({ els: [] });
    const aspect = known ? known.w / known.h : 3 / 2;
    for (const offset of [0, PAGE_W]) {
      const box: Box = { x: 0, y: 0, w: PAGE_W, h: PAGE_H };
      if (!src) { pb.add({ els: missingImage(box, t.body) }); continue; }
      const draw = coverFit({ x: 0, y: 0, w: PAGE_W * 2, h: PAGE_H }, aspect);
      pb.add({ els: [{ kind: 'image', src, box, draw: { ...draw, x: draw.x - offset } }] });
    }
  }
}

// ════════════════════════════════════════════════════════
//  Ingång
// ════════════════════════════════════════════════════════

export function resolveBookShape(book: BookProject): IllustrationShape {
  // Samma regel som bildgenereringen (gemini.resolveIllustrationShape) - annars kan
  // layouten vänta sig helsidor medan bilderna genererats som uppslag
  if (book.illustrationShape) return book.illustrationShape;
  return book.bookFormat === 'bildbok-separat-text' || book.bookFormat === 'kapitelbok' ? 'page' : 'spread';
}

export function resolveLayoutMode(book: BookProject): LayoutMode {
  if (book.bookFormat === 'bildbok-text-pa-bild' || book.bookFormat === 'larobok') return 'comic';
  if (book.bookFormat === 'kapitelbok') return 'chapter';
  const content = book.spreads.filter(s => s.pages !== 'omslag');
  const words = content.reduce(
    (n, s) => n + s.textBlocks.reduce((w, b) => w + b.text.split(/\s+/).filter(Boolean).length, 0), 0
  );
  // Mer text än en bilderbokssida rymmer per uppslag -> kapitelbok
  return content.length > 0 && words / content.length > 170 ? 'chapter' : 'picture';
}

export function collectImageSources(book: BookProject): string[] {
  return book.spreads.map(spreadImageSrc).filter((s): s is string => !!s);
}

export function buildBookLayout(book: BookProject, m: Measurer, sizes: ImageSizes, mode = resolveLayoutMode(book)): BookLayout {
  const t = fontsFor(book);
  const pb = new PageBuilder();
  const cover = book.spreads.find(s => s.pages === 'omslag');
  const content = book.spreads.filter(s => s.pages !== 'omslag');
  const shape = resolveBookShape(book);

  buildFrontMatter(pb, book, cover, sizes, t, m);

  if (mode === 'comic') {
    buildHalfTitle(pb, book, t, m);
    buildComicBook(pb, content, sizes, t, shape);
  } else {
    const lastChapter: { value?: string } = {};
    const presetBook = getStylePreset(book.stylePresetId)?.book;
    // Linjerat papper = dagbok: veckodagar blir inläggsrubriker
    const paper = mode === 'chapter' ? presetBook?.paper : undefined;
    const scenes: Scene[] = content.map(spread => ({
      spread,
      blocks: sceneBlocks(spread, lastChapter, paper === 'lined'),
      image: spreadImageSrc(spread),
    }));
    if (mode === 'picture') {
      buildHalfTitle(pb, book, t, m);
      buildPictureBook(pb, scenes, shape, sizes, t, m);
    } else {
      buildChapterBook(pb, scenes, shape, sizes, t, m, !!presetBook?.compositionMix, paper);
    }
  }

  buildBackCover(pb, book, t, m);
  pb.pages.forEach((p, i) => { p.label = pageLabel(i, pb.pages.length); });
  return { pages: pb.pages, mode };
}

// Läs in bildernas pixelmått (behövs för beskärning)
export async function loadImageSizes(sources: string[]): Promise<ImageSizes> {
  const sizes: ImageSizes = new Map();
  await Promise.all(Array.from(new Set(sources)).map(src => new Promise<void>(resolve => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => { sizes.set(src, { w: img.naturalWidth, h: img.naturalHeight, rows: motifRows(img) }); resolve(); };
    img.onerror = () => resolve();
    img.src = src;
  })));
  return sizes;
}

// Rad för rad: hur långt från vänster och höger motivet sträcker sig (0-1).
// Används för att låta texten flyta runt figurer på vitt papper.
function motifRows(img: HTMLImageElement, rowsCount = 48): { l: number; r: number }[] | undefined {
  try {
    const cols = 64;
    const canvas = document.createElement('canvas');
    canvas.width = cols;
    canvas.height = rowsCount;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return undefined;
    ctx.drawImage(img, 0, 0, cols, rowsCount);
    const data = ctx.getImageData(0, 0, cols, rowsCount).data;
    const rows: { l: number; r: number }[] = [];
    for (let yy = 0; yy < rowsCount; yy++) {
      let l = -1;
      let r = -1;
      for (let xx = 0; xx < cols; xx++) {
        const i = (yy * cols + xx) * 4;
        const [rr, gg, bb] = [data[i], data[i + 1], data[i + 2]];
        const light = (rr + gg + bb) / 3;
        const chroma = Math.max(rr, gg, bb) - Math.min(rr, gg, bb);
        if (light < 232 || chroma > 22) {
          if (l < 0) l = xx;
          r = xx;
        }
      }
      rows.push(l < 0 ? { l: 1, r: 0 } : { l: l / cols, r: (r + 1) / cols });
    }
    return rows;
  } catch {
    return undefined; // bild från annan domän utan CORS - ingen kontur
  }
}
