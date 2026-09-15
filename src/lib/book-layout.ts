// Sättningsmotor: gör om en BookProject till färdiga boksidor (16×21 cm).
// Resultatet är en renderingsoberoende sidmodell som både PDF-exporten och
// läsaren i webbläsaren ritar - så det man ser är det man får.
import { BookProject, Spread, IllustrationShape } from './types';
import { getStylePreset, textSideForSpread, BookFont } from './styles';
import type { FontSpec, Measurer } from './book-fonts';

export const PAGE_W = 160;
export const PAGE_H = 210;
export const PT = 0.3528; // mm per typografisk punkt

export interface Box { x: number; y: number; w: number; h: number }

export interface ImageEl { kind: 'image'; src: string; box: Box; draw: Box }
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

export type ImageSizes = Map<string, { w: number; h: number }>;

const INK = '#231f20';
const MUTED = '#8b8591';
const NBSP = '\u00A0';

// ════════════════════════════════════════════════════════
//  Innehåll: stycken, repliker, kapitelrubriker
// ════════════════════════════════════════════════════════

type Block =
  | { type: 'heading'; label?: string; title: string }
  | { type: 'para'; text: string }
  | { type: 'image'; src?: string; aspect: number; spreadNumber: number };

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

function sceneBlocks(spread: Spread, lastChapter: { value?: string }): Block[] {
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
    if (line.length <= 80 && CHAPTER_RE.test(line)) {
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
}

function fontsFor(book: BookProject): Typography {
  const preset = getStylePreset(book.stylePresetId);
  const toSpec = (f: BookFont, style: FontSpec['style']): FontSpec =>
    ({ family: f === 'nunito' ? 'Nunito' : 'Literata', style });
  const body = preset?.fonts.body ?? 'literata';
  const heading = preset?.fonts.heading ?? 'literata';
  return {
    body: toSpec(body, 'normal'),
    heading: toSpec(heading, 'bold'),
    italic: toSpec(body, 'italic'),
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
    centeredLines(p, book.title, t.heading, 30, 80, 120, '#ffffff', m, 1.15);
  }

  // Insida pärm
  pb.add({ els: [] });

  // Titelsida
  const title = pb.add({ els: [] });
  let y = centeredLines(title, book.title, t.heading, 26, 72, 118, INK, m, 1.2);
  ornament(title, y + 4);
  if (book.subtitle) y = centeredLines(title, book.subtitle, t.italic, 12, y + 14, 110, MUTED, m);
  if (book.author) centeredLines(title, book.author, t.body, 12, y + 16, 110, INK, m);

  // Redaktionssida
  const imprint = pb.add({ els: [] });
  const preset = getStylePreset(book.stylePresetId);
  const year = new Date(book.createdAt || Date.now()).getFullYear();
  const lines = [
    `${book.title}`,
    `© ${year} ${book.author || 'Författaren'}`,
    preset ? `Illustrationer i stilen ${preset.label}` : 'Illustrationer skapade med AI',
    `Typsnitt: ${t.body.family}`,
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
  const y = centeredLines(p, book.title, t.heading, 14, 92, 110, INK, m);
  ornament(p, y + 3);
}

function buildBackCover(pb: PageBuilder, book: BookProject, t: Typography, m: Measurer) {
  // Tryckta böcker har ett sidantal delbart med 4
  while ((pb.count + 1) % 4 !== 0) pb.add({ els: [] });
  const back = pb.add({ els: [], background: '#2f2a4a' });
  const y = centeredLines(back, book.title, t.heading, 16, 88, 110, '#ffffff', m);
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
}

interface PlacedLine { el: TextEl; height: number; paraStart: boolean; paraIndex: number; keepWithNext?: boolean }

// Lägger ut block som en lång remsa rader (y relativt 0), för att sedan kunna
// mäta höjd eller fördela över sidor
function setColumn(blocks: Block[], width: number, style: ColumnStyle, m: Measurer, firstIndented = false): PlacedLine[] {
  const out: PlacedLine[] = [];
  const lh = style.size * PT * style.leading;
  let afterHeading = !firstIndented;
  let paraIndex = 0;

  for (const block of blocks) {
    if (block.type === 'heading') {
      const hs = style.size * 1.15;
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

    const indent = afterHeading ? 0 : style.indent;
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
  while (start + n < lines.length && used + lines[start + n].height <= available + 0.01) {
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
  return { size, leading: 1.5, indent: 0, paraGap: size * PT * 0.55, justify: false, font: t.body, heading: t.heading };
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

function buildChapterBook(pb: PageBuilder, scenes: Scene[], shape: IllustrationShape, sizes: ImageSizes, t: Typography, m: Measurer) {
  const textW = PAGE_W - CB_MARGIN.inner - CB_MARGIN.outer;
  const bottom = PAGE_H - CB_MARGIN.bottom;
  const style: ColumnStyle = {
    size: 11.5, leading: 1.55, indent: 5, paraGap: 0, justify: true, font: t.body, heading: t.heading,
  };
  const lh = style.size * PT * style.leading;

  let page: LayoutPage | null = null;
  let y = CB_MARGIN.top;
  const pendingImages: (string | undefined)[] = [];
  let pageHasText = false;

  const xFor = () => (pb.isRecto(pb.count - 1) ? CB_MARGIN.inner : CB_MARGIN.outer);

  const closePage = () => {
    if (!page) return;
    if (pageHasText) addPageNumber(page, pb.count - 1, t);
    // Helsidesbilder läggs in vid sidbrytningar så att texten flyter vidare -
    // högst en per brytning så att bilder aldrig hamnar i rad
    if (pendingImages.length > 0) fullPageImage(pb, pendingImages.shift(), sizes, t);
    page = null;
  };

  const openPage = () => {
    closePage();
    page = pb.add({ els: [] });
    y = CB_MARGIN.top;
    pageHasText = false;
  };

  let justOpened = false;

  const placeSceneImage = (src: string | undefined) => {
    if (!src) return;
    if (shape === 'page') {
      pendingImages.push(src);
      return;
    }
    const s = sizes.get(src);
    const aspect = s ? s.w / s.h : 3 / 2;
    const imgH = Math.min(textW / aspect, 92);
    if (!page || y + imgH + lh * 3 > bottom) openPage();
    page!.els.push(imageEl(src, { x: xFor(), y, w: textW, h: imgH }, aspect));
    y += imgH + lh;
    pageHasText = true;
  };

  for (const scene of scenes) {
    let blocks = scene.blocks;
    let imagePlaced = false;

    while (blocks.length > 0 || !imagePlaced) {
      const headingIdx = blocks.findIndex(b => b.type === 'heading');

      // Kapitel börjar på ny sida med öppningsrubrik
      if (headingIdx === 0) {
        const heading = blocks[0] as Extract<Block, { type: 'heading' }>;
        if (!page || pageHasText) openPage();
        let hy = CB_MARGIN.top + 38;
        if (heading.label) {
          page!.els.push({
            kind: 'text', x: 0, y: hy, width: PAGE_W, text: heading.label.toUpperCase(),
            font: t.body, size: 8.5, color: MUTED, align: 'center', tracking: 0.9,
          });
          hy += 10;
        }
        hy = centeredLines(page!, heading.title, t.heading, 19, hy, textW, INK, m, 1.2);
        ornament(page!, hy + 1);
        y = hy + 14;
        pageHasText = true;
        justOpened = true;
        blocks = blocks.slice(1);
        continue;
      }

      // Scenens bild efter en ev. inledande kapitelrubrik, före brödtexten
      if (!imagePlaced) {
        placeSceneImage(scene.image);
        imagePlaced = true;
        if (blocks.length === 0) break;
      }

      const run = headingIdx === -1 ? blocks : blocks.slice(0, headingIdx);
      blocks = headingIdx === -1 ? [] : blocks.slice(headingIdx);
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
  closePage();
  // Bilder som köats efter sista textsidan
  while (pendingImages.length > 0) fullPageImage(pb, pendingImages.shift(), sizes, t);
}

// ════════════════════════════════════════════════════════
//  Serieformat: bilderna innehåller redan texten
// ════════════════════════════════════════════════════════

function buildComicBook(pb: PageBuilder, spreads: Spread[], sizes: ImageSizes, t: Typography) {
  for (const spread of spreads) {
    if (pb.isRecto()) pb.add({ els: [] });
    const src = spreadImageSrc(spread);
    const aspect = src && sizes.get(src) ? sizes.get(src)!.w / sizes.get(src)!.h : 3 / 2;
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
    buildComicBook(pb, content, sizes, t);
  } else {
    const lastChapter: { value?: string } = {};
    const scenes: Scene[] = content.map(spread => ({
      spread,
      blocks: sceneBlocks(spread, lastChapter),
      image: spreadImageSrc(spread),
    }));
    if (mode === 'picture') {
      buildHalfTitle(pb, book, t, m);
      buildPictureBook(pb, scenes, shape, sizes, t, m);
    } else {
      buildChapterBook(pb, scenes, shape, sizes, t, m);
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
    img.onload = () => { sizes.set(src, { w: img.naturalWidth, h: img.naturalHeight }); resolve(); };
    img.onerror = () => resolve();
    img.src = src;
  })));
  return sizes;
}
