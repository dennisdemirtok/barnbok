// Mätverktyg för AI-texter: kvalitet per text och variation mellan texter.
// Används av scripts/eval-texts.mjs för att jämföra promptändringar med siffror
// i stället för magkänsla. Ingen serverkod - går att köra var som helst.
import { findAiTells } from './writing';

export interface EvalItem {
  id: string;
  group: string; // t.ex. boktyp, eller "samma handling"
  kind: 'plot' | 'beginning' | 'chapter';
  text: string;
  // Texter som bygger på varandra (en handling och början skriven från den) har
  // samma lineage och räknas inte som upprepningar av varandra
  lineage?: string;
  targetWords?: number;
}

export interface ItemMetrics {
  id: string;
  group: string;
  kind: EvalItem['kind'];
  words: number;
  aiTells: number; // antal träffar på AI-tecken
  aiTellLabels: string[];
  sentenceMean: number; // ord per mening
  sentenceVariation: number; // variationskoefficient - högre = mer levande rytm
  dialogueShare: number; // andel stycken som är repliker
  lexicalVariety: number; // unika ord / ord bland de första 400 orden
  names: string[];
  opening: string;
  settingWords: string[];
}

export interface BatchReport {
  items: ItemMetrics[];
  quality: {
    score: number; // 0-100
    aiTellsPer1000Words: number;
    avgSentenceVariation: number;
    avgLexicalVariety: number;
  };
  variation: {
    score: number; // 0-100
    repeatedNames: { name: string; count: number }[];
    nameRepeatRate: number; // andel texter som delar huvudnamn med en annan text
    repeatedSettings: { word: string; count: number }[];
    avgContentOverlap: number; // snittlik ordlikhet mellan texter i samma grupp/typ (0-1)
    avgOpeningOverlap: number;
  };
}

// Miljö- och figurord som ofta blir standardval
const SETTING_WORDS = [
  'skärgård', 'ön', 'brygga', 'färja', 'fyr', 'badhus', 'loppis', 'loppmarknad', 'vindsfönster', 'vindsluckan',
  'farmor', 'mormor', 'morfar', 'farfar', 'skog', 'skogen', 'granskog', 'stuga', 'fjäll', 'camping', 'museum', 'bibliotek',
  'tivoli', 'bondgård', 'källare', 'karta', 'skattkarta', 'drake', 'spöke', 'robot', 'katt', 'hund', 'räv', 'nyckel', 'flaskpost',
  'tvilling', 'tvillingar', 'kanelbullar', 'kofta',
];

const STOPWORDS = new Set(('och att det som en på är av för med till den har de inte om ett han hon men var jag sig från så kan ' +
  'när nu vi du man ska efter bara vad upp ut där honom henne hans hennes deras sin sitt sina mot under över också hade ' +
  'skulle kommer blir blev något någon alla allt mycket lite igen eller dem mig dig oss er här då sedan innan medan ' +
  'säger sa ropar frågar tittar går står sitter ligger vill måste får fick kunde tänker vet ser hör').split(' '));

function splitSentences(text: string): string[] {
  return text
    .replace(/\n+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(s => s.split(/\s+/).length >= 2);
}

function wordsOf(text: string): string[] {
  return (text.toLowerCase().match(/[a-zåäöéü]+/g) ?? []);
}

// Namn: ord med stor bokstav som inte står först i en mening eller replik
export function extractNames(text: string): string[] {
  const counts = new Map<string, number>();
  for (const sentence of splitSentences(text)) {
    const tokens = sentence.replace(/^[*–\-\s"']+/, '').split(/\s+/);
    tokens.slice(1).forEach(raw => {
      const t = raw.replace(/[^A-Za-zÅÄÖåäöÉéÜü-]/g, '');
      if (/^[A-ZÅÄÖ][a-zåäöéü]{1,14}$/.test(t) && !STOPWORDS.has(t.toLowerCase())) {
        counts.set(t, (counts.get(t) ?? 0) + 1);
      }
    });
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([n]) => n)
    .filter(n => !['Kapitel', 'Prolog', 'Jag', 'Du', 'Men', 'Och', 'Det', 'Han', 'Hon', 'De', 'Vi'].includes(n))
    .slice(0, 6);
}

function firstProseLine(text: string): string {
  return text
    .split('\n')
    .map(l => l.trim())
    .find(l => l && !/^(kapitel\s+\S+|prolog|inledning)\b/i.test(l)) ?? '';
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  a.forEach(x => { if (b.has(x)) inter++; });
  return inter / (a.size + b.size - inter);
}

export function measureItem(item: EvalItem): ItemMetrics {
  const words = wordsOf(item.text);
  const sentences = splitSentences(item.text).map(s => s.split(/\s+/).length);
  const mean = sentences.length ? sentences.reduce((a, b) => a + b, 0) / sentences.length : 0;
  const sd = sentences.length
    ? Math.sqrt(sentences.reduce((a, b) => a + (b - mean) ** 2, 0) / sentences.length)
    : 0;
  const paragraphs = item.text.split('\n').map(l => l.trim()).filter(Boolean);
  const dialogue = paragraphs.filter(p => /^[*–\-]\s/.test(p)).length;
  const sample = words.slice(0, 400);
  const tells = findAiTells(item.text);
  const lower = ` ${words.join(' ')} `;
  return {
    id: item.id,
    group: item.group,
    kind: item.kind,
    words: words.length,
    aiTells: tells.reduce((n, t) => n + t.count, 0),
    aiTellLabels: tells.map(t => `${t.label} (${t.count})`),
    sentenceMean: Math.round(mean * 10) / 10,
    sentenceVariation: mean ? Math.round((sd / mean) * 100) / 100 : 0,
    dialogueShare: paragraphs.length ? Math.round((dialogue / paragraphs.length) * 100) / 100 : 0,
    lexicalVariety: sample.length ? Math.round((new Set(sample).size / sample.length) * 100) / 100 : 0,
    names: extractNames(item.text),
    opening: firstProseLine(item.text).slice(0, 160),
    settingWords: SETTING_WORDS.filter(w => lower.includes(` ${w} `)),
  };
}

export function evaluateBatch(items: EvalItem[]): BatchReport {
  const metrics = items.map(measureItem);
  const totalWords = metrics.reduce((n, m) => n + m.words, 0) || 1;
  const prose = metrics.filter(m => m.kind !== 'plot');

  // ── Kvalitet ──
  const aiPer1000 = (metrics.reduce((n, m) => n + m.aiTells, 0) / totalWords) * 1000;
  const avgVar = prose.length ? prose.reduce((n, m) => n + m.sentenceVariation, 0) / prose.length : 0;
  const avgLex = prose.length ? prose.reduce((n, m) => n + m.lexicalVariety, 0) / prose.length : 0;
  // 0 AI-tecken, rytmvariation kring 0.6+ och ordvariation kring 0.6+ ger full poäng
  const qualityScore = Math.round(
    Math.max(0, 50 - aiPer1000 * 25) +
    Math.min(25, (avgVar / 0.6) * 25) +
    Math.min(25, (avgLex / 0.6) * 25)
  );

  // ── Variation ──
  const lineageOf = (i: number) => items[i].lineage ?? items[i].id;
  const mainNames = metrics.map(m => m.names[0]).filter(Boolean) as string[];
  // Räkna i hur många olika lineages ett namn förekommer
  const nameLineages = new Map<string, Set<string>>();
  metrics.forEach((m, i) => new Set(m.names.slice(0, 3)).forEach(n => {
    if (!nameLineages.has(n)) nameLineages.set(n, new Set());
    nameLineages.get(n)!.add(lineageOf(i));
  }));
  const nameCounts = new Map(Array.from(nameLineages.entries()).map(([n, set]) => [n, set.size]));
  const repeatedNames = Array.from(nameCounts.entries()).filter(([, c]) => c > 1)
    .sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }));
  const sharedMain = mainNames.filter(n => (nameCounts.get(n) ?? 0) > 1).length;
  const nameRepeatRate = mainNames.length ? sharedMain / mainNames.length : 0;

  const settingLineages = new Map<string, Set<string>>();
  metrics.forEach((m, i) => m.settingWords.forEach(w => {
    if (!settingLineages.has(w)) settingLineages.set(w, new Set());
    settingLineages.get(w)!.add(lineageOf(i));
  }));
  const settingCounts = new Map(Array.from(settingLineages.entries()).map(([w, set]) => [w, set.size]));
  const lineageCount = new Set(items.map((_, i) => lineageOf(i))).size || 1;
  const repeatedSettings = Array.from(settingCounts.entries())
    .filter(([, c]) => c >= Math.max(2, Math.ceil(lineageCount * 0.3)))
    .sort((a, b) => b[1] - a[1]).map(([word, count]) => ({ word, count }));

  // Innehållslikhet mellan texter av samma slag
  const content = items.map(it => new Set(wordsOf(it.text).filter(w => w.length >= 5 && !STOPWORDS.has(w))));
  const openings = metrics.map(m => new Set(wordsOf(m.opening)));
  let pairs = 0, overlap = 0, openOverlap = 0;
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (items[i].kind !== items[j].kind || lineageOf(i) === lineageOf(j)) continue;
      pairs++;
      overlap += jaccard(content[i], content[j]);
      openOverlap += jaccard(openings[i], openings[j]);
    }
  }
  const avgContentOverlap = pairs ? overlap / pairs : 0;
  const avgOpeningOverlap = pairs ? openOverlap / pairs : 0;
  const settingPenalty = repeatedSettings.reduce((n, s) => n + (s.count / lineageCount), 0);
  const variationScore = Math.round(Math.max(0,
    100
    - nameRepeatRate * 40
    - Math.min(25, settingPenalty * 12)
    - Math.min(20, avgContentOverlap * 100)
    - Math.min(15, avgOpeningOverlap * 60)
  ));

  return {
    items: metrics,
    quality: {
      score: Math.min(100, qualityScore),
      aiTellsPer1000Words: Math.round(aiPer1000 * 100) / 100,
      avgSentenceVariation: Math.round(avgVar * 100) / 100,
      avgLexicalVariety: Math.round(avgLex * 100) / 100,
    },
    variation: {
      score: variationScore,
      repeatedNames,
      nameRepeatRate: Math.round(nameRepeatRate * 100) / 100,
      repeatedSettings,
      avgContentOverlap: Math.round(avgContentOverlap * 1000) / 1000,
      avgOpeningOverlap: Math.round(avgOpeningOverlap * 1000) / 1000,
    },
  };
}
