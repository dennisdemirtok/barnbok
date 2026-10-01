// Ljudbok från text: en inklistrad text blir bokens uppslag, så att uppläsningen
// fungerar precis som för de illustrerade böckerna - kapitel blir egna spår, och
// uttalslistan och omläsning av ändrade kapitel gäller även här.
import type { Spread } from './types';
import { CHAPTER_RE } from './narration';

// Ungefär en lång kapitelbok. Längre texter delas hellre i flera ljudböcker.
export const MAX_AUDIOBOOK_CHARS = 300_000;

// Så mycket text per uppslag. Uppläsningen delar långa kapitel vid uppslagsgränser.
const SPREAD_CHARS = 1400;

export interface AudiobookChapter {
  // Rubriken som den läses upp ("Kapitel 2: Skattkartan"). Tom för texten före första rubriken.
  heading: string;
  paragraphs: string[];
}

export interface ParsedAudiobookText {
  chapters: AudiobookChapter[];
  words: number;
  characters: number;
}

const ROMAN: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100 };

function romanValue(text: string): number {
  let total = 0;
  for (let i = 0; i < text.length; i++) {
    const value = ROMAN[text[i]];
    const next = ROMAN[text[i + 1]] ?? 0;
    total += value < next ? -value : value;
  }
  return total;
}

const comparable = (text: string) => text.toLocaleLowerCase('sv-SE').replace(/[^a-z0-9åäöéüæø]+/g, ' ').trim();

// Raderna som de står, tomma rader kvar (de skiljer stycken åt)
function rawLines(raw: string): string[] {
  return raw
    .replace(/\r\n?/g, '\n')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[\t\u00A0]/g, ' ')
    .split('\n')
    .map(line => line.replace(/\s+/g, ' ').trim());
}

// Titeln (och "av författaren") överst läses redan i början av ljudboken
function withoutTitleLines(lines: string[], title: string, author: string): string[] {
  const out = [...lines];
  const firstText = () => out.findIndex(Boolean);
  let i = firstText();
  if (i >= 0 && title.trim() && comparable(out[i].replace(/^#{1,6}\s*/, '')) === comparable(title)) {
    out.splice(0, i + 1);
    i = firstText();
  }
  const byline = i >= 0 ? out[i].match(/^(?:av|text:?|skriven av)\s+(.+)$/i) : null;
  if (byline && author.trim() && comparable(byline[1]) === comparable(author)) out.splice(0, i + 1);
  return out;
}

// Radbrytningar mitt i meningar (vanligt i text från PDF) tas bort: en rad som
// slutar utan skiljetecken hör ihop med nästa om nästa börjar med liten bokstav,
// eller om raden är lång som en radbruten brödtextrad. Korta rader utan punkt
// (rubriker, titlar, vers) står kvar som de är.
function joinWrappedLines(lines: string[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    const previous = out[out.length - 1];
    const continues = !!line && !!previous
      && !/[.!?:;…"”»)\]]$/.test(previous)
      && !isHeadingLike(previous)
      && (/^[a-zåäöéü]/.test(line) || (previous.length >= 50 && /^[A-ZÅÄÖÉÜ0-9]/.test(line)));
    if (continues) {
      // Avstavning vid radslut: "sommar-" + "lov" = "sommarlov"
      out[out.length - 1] = /[a-zåäö]-$/.test(previous) && /^[a-zåäö]/.test(line)
        ? `${previous.slice(0, -1)}${line}`
        : `${previous} ${line}`;
      continue;
    }
    out.push(line);
  }
  return out.filter(Boolean);
}

function isHeadingLike(line: string): boolean {
  return /^#{1,6}\s/.test(line) || CHAPTER_RE.test(line) || (line.length <= 80 && NUMBERED_RE.test(line));
}

type HeadingKind = 'chapter' | 'number' | 'markdown';

// Siffra eller romersk siffra, ensam eller följd av skiljetecken och en kort titel:
// "2", "2.", "2. Skattkartan", "III", "4 – Natten"
const NUMBERED_RE = /^(\d{1,3}|[IVXLC]{1,7})(?:\s*([.):]|\s[-–—])\s*(.*))?$/;

function numberOf(line: string): number | null {
  const m = line.match(NUMBERED_RE);
  if (!m) return null;
  return /^\d/.test(m[1]) ? parseInt(m[1], 10) : romanValue(m[1]);
}

// Kapitelrubrik i någon av de vanliga formerna: "Kapitel 3", "Prolog", "# Skattkartan",
// "2. Skattkartan", "III". Numrerade rubriker måste komma i ordning, annars är det
// troligare en numrerad lista i texten.
function chapterHeading(line: string, nextNumber: number): { heading: string; kind: HeadingKind } | null {
  if (line.length > 80) return null;
  const markdown = line.match(/^#{1,6}\s*(.+)$/);
  const text = (markdown ? markdown[1] : line).trim();
  if (CHAPTER_RE.test(text)) return { heading: text, kind: 'chapter' };

  const numbered = text.match(NUMBERED_RE);
  if (numbered) {
    const title = (numbered[3] || '').trim();
    const titleOk = !title || (title.length <= 60 && /^[A-ZÅÄÖÉÜ0-9"”»'(]/.test(title) && !/[,;]$/.test(title));
    if (numberOf(text) !== nextNumber || !titleOk) return null;
    return { heading: title ? `Kapitel ${nextNumber}: ${title}` : `Kapitel ${nextNumber}`, kind: 'number' };
  }
  // Markdown-rubrik utan kapitelord blir ett numrerat kapitel
  if (markdown && text.length <= 60) return { heading: `Kapitel ${nextNumber}: ${text}`, kind: 'markdown' };
  return null;
}

/** Delar texten i kapitel. Titel- och författarrad överst tas bort - de läses upp ändå. */
export function parseAudiobookText(raw: string, title = '', author = ''): ParsedAudiobookText {
  const lines = joinWrappedLines(withoutTitleLines(rawLines(raw), title, author));

  const chapters: AudiobookChapter[] = [];
  let current: AudiobookChapter = { heading: '', paragraphs: [] };
  let lastNumber = 0;
  // Skriver texten "Kapitel 3" används inte nakna siffror som rubriker också
  let usesChapterWord = false;
  lines.forEach((line, i) => {
    let found = chapterHeading(line, lastNumber + 1);
    if (found?.kind === 'number') {
      // "1. Ficklampa" följt av "2. Karta" är en lista, inte två kapitel
      const next = lines[i + 1];
      const isList = next !== undefined && numberOf(next) === lastNumber + 2;
      if (usesChapterWord || isList) found = null;
    }
    if (!found) {
      current.paragraphs.push(line);
      return;
    }
    if (current.heading || current.paragraphs.length > 0) chapters.push(current);
    current = { heading: found.heading, paragraphs: [] };
    if (found.kind === 'chapter' && /^kapitel/i.test(found.heading)) usesChapterWord = true;
    const n = found.heading.match(/^kapitel\s+(\d+)/i);
    if (n) lastNumber = parseInt(n[1], 10);
    else if (/^kapitel/i.test(found.heading)) lastNumber++;
  });
  if (current.heading || current.paragraphs.length > 0) chapters.push(current);

  const allText = chapters.flatMap(c => [c.heading, ...c.paragraphs]).join(' ');
  return {
    chapters,
    words: allText.split(/\s+/).filter(Boolean).length,
    characters: allText.length,
  };
}

/** Bokens uppslag: rubriken först i kapitlet, sedan styckena i lagom stora uppslag. */
export function audiobookSpreads(parsed: ParsedAudiobookText): Spread[] {
  const spreads: Spread[] = [];
  const add = (blocks: string[], chapter: string) => {
    if (blocks.length === 0) return;
    const n = spreads.length + 1;
    spreads.push({
      id: crypto.randomUUID(),
      spreadNumber: n,
      pages: `${n * 2}-${n * 2 + 1}`,
      chapter: chapter || undefined,
      textBlocks: blocks.map((text, i) => ({ position: `stycke ${i + 1}`, text })),
      imagePrompt: '',
      status: 'done',
    });
  };

  for (const chapter of parsed.chapters) {
    let blocks: string[] = chapter.heading ? [chapter.heading] : [];
    let size = 0;
    for (const paragraph of chapter.paragraphs) {
      if (size > 0 && size + paragraph.length > SPREAD_CHARS) {
        add(blocks, chapter.heading);
        blocks = [];
        size = 0;
      }
      blocks.push(paragraph);
      size += paragraph.length;
    }
    add(blocks, chapter.heading);
  }
  return spreads;
}

/** Texten tillbaka ur uppslagen, för att kunna rätta den (stycken med tom rad emellan). */
export function audiobookTextFromSpreads(spreads: Spread[]): string {
  return spreads
    .filter(s => s.pages !== 'omslag')
    .flatMap(s => s.textBlocks.map(b => b.text.trim()))
    .filter(Boolean)
    .join('\n\n');
}
