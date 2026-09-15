import Anthropic from '@anthropic-ai/sdk';
import { PROSE_QUALITY_RULES, variationBlock, sanitizeProse } from './writing';
import { drawStorySeeds, seedsBlock } from './story-seeds';
import { recentStories, rememberStory, memoryBlock, avoidTextOf } from './story-memory';
import { extractNames } from './text-eval';
import { restoreDialogueMarkers, DEFAULT_MARKER } from './dialogue';
import { COMPOSITIONS, compositionGuide } from './compositions';
import type { Composition } from './types';
import { BookFormat } from './types';
import type { BookConcept, StylePreset } from './styles';
import type { VoiceProfile } from './author-types';
import type { TextBlock } from './types';
import { normalizeComicPages, type ComicPage } from './comic';

export type TextDensity = 'minimal' | 'lite' | 'medium' | 'mycket';

export interface BookConfig {
  title: string;
  bookFormat: BookFormat;
  numCharacters: number;
  characterNames: string[]; // empty = auto-generate
  numPages: number;
  targetAge: string;
  plot: string; // handling/story tags
  setting: string; // miljo
  imageStyle: string; // format bilder
  subject?: string; // for larobok (e.g. "matematik")
  textDensity: TextDensity;
  styleSeries?: string; // referens till barnbok_style_profiles.book_series
  stylePresetId?: string; // vald stil i lib/styles.ts
  textStyleNotes?: string; // skrivstil från analyserad referensbok
  languageExamples?: string[]; // verkliga exempelmeningar (few-shot stilförebild)
}

export function getClient() {
  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) throw new Error('CLAUDE_API_KEY saknas i .env.local');
  return new Anthropic({ apiKey });
}

// Alias utan datumsuffix - pekar alltid på aktuell Opus-modell hos Anthropic.
const FALLBACK_MODEL = 'claude-opus-5';
const MODEL_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

let cachedModel: { id: string; fetchedAt: number } | null = null;

/**
 * Hämtar senaste Opus-modellen från Anthropics Models API så att appen
 * inte fastnar på en pensionerad modellversion. Resultatet cachas i 24h
 * och vid fel används FALLBACK_MODEL.
 */
export async function resolveLatestModel(client: Anthropic): Promise<string> {
  if (cachedModel && Date.now() - cachedModel.fetchedAt < MODEL_CACHE_TTL_MS) {
    return cachedModel.id;
  }
  try {
    const models: { id: string; created_at: string }[] = [];
    for await (const m of client.models.list()) {
      models.push({ id: m.id, created_at: m.created_at });
    }
    const latestOpus = models
      .filter(m => m.id.includes('opus'))
      .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    const id = latestOpus?.id ?? FALLBACK_MODEL;
    cachedModel = { id, fetchedAt: Date.now() };
    return id;
  } catch {
    return FALLBACK_MODEL;
  }
}

function getFormatDescription(format: BookConfig['bookFormat']): string {
  switch (format) {
    case 'bildbok-text-pa-bild':
      return `Bildbok med text PÅ bilderna (liknande "Handbok för Superhjältar").
Bokformat: 16×21 cm (bred × hög). Varje uppslag (2 sidor) har en helsides-illustration med texten integrerad i bilden.
Texten placeras i textrutor ovanpå illustrationen.
Ca 50-100 ord per sida (100-200 ord per uppslag). Visuellt berättande med integrerad text.`;
    case 'bildbok-separat-text':
      return `Bildbok med separat text (liknande "Luna"-böcker av Karin Lemon).
Bokformat: 16×21 cm (bred × hög). Varannan sida har illustration, varannan har text. Eller text ovanför/under bilden.
Ca 100-200 ord per textsida (en fullsida med text har ca 180 ord). Bild och text kompletterar varandra.
INGEN kapitelindelning - berättelsen flödar som en sammanhängande historia utan kapitelrubriker.
Typiskt 32-48 sidor i boken.`;
    case 'kapitelbok':
      return `Kapitelbok med mycket text (liknande Harry Potter / Bert-böcker).
Mest text med enstaka illustrationer. Längre berättande stycken.
Ca 200-300 ord per sida (400-600 ord per uppslag). Detaljerade beskrivningar och dialoger.
Rikare berättande med karaktärsutveckling och spänningskurva.`;
    case 'larobok':
      return `Lärobok/aktivitetsbok (liknande "Ärtan, Pärtan" eller Matteböcker).
Bokformat: 16×21 cm. Blandning av text, bilder och uppgifter/övningar.
Ca 60-150 ord per sida. Instruktioner, förklaringar och interaktiva element.
Pedagogiskt upplägg med tydlig progression.`;
  }
}

function getFormatTemplate(format: BookConfig['bookFormat']): string {
  switch (format) {
    case 'bildbok-text-pa-bild':
      return `Varje uppslag ska ha:
- 1-3 textblock med position (t.ex. "Text (sida X - textruta överst):", "Text (sida Y - textruta nedre):")
- BILDPROMPT som beskriver en helsides-illustration där texten ska integreras
- Kort, kärnfull text som barn kan läsa själva
- Bildprompten ska inkludera var texten ska placeras i bilden`;
    case 'bildbok-separat-text':
      return `Varje uppslag ska ha:
- 1-2 längre textblock med position
- BILDPROMPT som beskriver illustrationen (utan text i bilden)
- Texten berättar mer detaljer, bilden visar scenen
- Mer berättande text med beskrivningar`;
    case 'kapitelbok':
      return `Varje uppslag ska ha:
- 1-2 långa textblock med berättande text, dialoger, beskrivningar
- BILDPROMPT som beskriver en enklare illustration (inte varje sida behöver detaljerad bild)
- Fokus på textberättande med stödjande bilder`;
    case 'larobok':
      return `Varje uppslag ska ha:
- Textblock med instruktioner, förklaringar eller uppgifter
- BILDPROMPT som beskriver pedagogiska illustrationer, diagram eller figurer
- Blandning av lärandeinnehåll och övningar
- Tydlig progression i svårighetsgrad`;
  }
}

function getTextDensityDescription(density: TextDensity, format: BookConfig['bookFormat']): string {
  // Format-specific word counts based on real book data
  const wordRanges: Record<BookConfig['bookFormat'], Record<TextDensity, { perPage: string; perSpread: string; desc: string }>> = {
    'bildbok-text-pa-bild': {
      'minimal': { perPage: '15-30', perSpread: '30-60', desc: 'Mycket kort text integrerad i bilden. 1-2 meningar per textruta. Bilden berättar mest.' },
      'lite': { perPage: '30-50', perSpread: '60-100', desc: 'Kort text i textrutor på bilden. 2-3 meningar per textruta. Visuellt berättande dominerar.' },
      'medium': { perPage: '50-80', perSpread: '100-160', desc: 'Lagom mängd text integrerad i bilden. 3-5 meningar per textruta. Balans mellan text och bild.' },
      'mycket': { perPage: '80-120', perSpread: '160-240', desc: 'Riklig text i bilden, liknande Handbok för Superhjältar. 4-6 meningar per textruta, fler textrutor per uppslag.' },
    },
    'bildbok-separat-text': {
      'minimal': { perPage: '30-60', perSpread: '30-60', desc: 'Kort text på textsidan. 2-4 meningar. Bilderna dominerar berättelsen.' },
      'lite': { perPage: '60-100', perSpread: '60-100', desc: 'Enkel, lättläst text. 4-6 meningar per textsida. God balans bild/text.' },
      'medium': { perPage: '100-160', perSpread: '100-160', desc: 'Typisk Luna-bok textmängd. 6-10 meningar per textsida (~150 ord). Berättande text med detaljer.' },
      'mycket': { perPage: '160-220', perSpread: '160-220', desc: 'Mycket text per sida, upp mot 180-200 ord på textsidan. Riklig berättelse med dialoger och beskrivningar.' },
    },
    'kapitelbok': {
      'minimal': { perPage: '100-150', perSpread: '200-300', desc: 'Kortare stycken, mer luftig text. Enklare språk, korta meningar. Passar yngre läsare.' },
      'lite': { perPage: '150-200', perSpread: '300-400', desc: 'Lagom textmängd med tydliga stycken. Medellånga meningar och dialoger.' },
      'medium': { perPage: '200-280', perSpread: '400-560', desc: 'Typisk kapitelbok-textmängd. Detaljerade beskrivningar, dialoger och berättande. ~250 ord per sida.' },
      'mycket': { perPage: '280-350', perSpread: '560-700', desc: 'Riklig text som Harry Potter. Långa stycken, utförliga beskrivningar, komplex berättelse. ~300+ ord per sida.' },
    },
    'larobok': {
      'minimal': { perPage: '30-60', perSpread: '60-120', desc: 'Korta instruktioner och enkla övningar. Mest bilder och aktiviteter.' },
      'lite': { perPage: '60-100', perSpread: '120-200', desc: 'Tydliga förklaringar med övningar. Lagom text med visuellt stöd.' },
      'medium': { perPage: '100-150', perSpread: '200-300', desc: 'Utförligare förklaringar och fler övningar. Blandning av text och aktiviteter.' },
      'mycket': { perPage: '150-200', perSpread: '300-400', desc: 'Detaljerade förklaringar, exempel och uppgifter. Mer text, pedagogiskt djup.' },
    },
  };

  const range = wordRanges[format][density];
  const densityLabel = { 'minimal': 'MINIMAL', 'lite': 'LITE', 'medium': 'MEDIUM', 'mycket': 'MYCKET' }[density];

  return `${densityLabel} text - ca ${range.perPage} ord per sida (${range.perSpread} ord per uppslag).
${range.desc}`;
}

export async function generateBookContent(config: BookConfig): Promise<string> {
  const client = getClient();

  // Tryckkonvention: sida 1-5 är titelsida/copyright, innehållet börjar på sida 6
  // och bokens SISTA sida är slutsidan. numPages = bokens totala sidantal.
  const numSpreads = Math.max(1, Math.floor((config.numPages - 6) / 2));
  const lastContentPage = 5 + numSpreads * 2;
  const formatDesc = getFormatDescription(config.bookFormat);
  const formatTemplate = getFormatTemplate(config.bookFormat);

  const mainCharInstructions = config.characterNames.length > 0
    ? `Skapa EXAKT ${config.numCharacters} huvudkaraktärer med dessa namn: ${config.characterNames.join(', ')}. Skapa detaljerade beskrivningar för varje karaktär.`
    : `Skapa EXAKT ${config.numCharacters} huvudkaraktärer med svenska namn. Ge varje karaktär ett unikt utseende, personlighet och bakgrund.`;

  const characterInstructions = `${mainCharInstructions}
VIKTIGT OM BIKARAKTÄRER: ALLA namngivna figurer som förekommer i berättelsen (vuxna, lärare, husdjur, djur osv.) MÅSTE också listas i KARAKTÄRER-sektionen med Roll: bikaraktär. Varje karaktär (även djur!) ska ha fälten Art och Utseende ifyllda - annars går det inte att rita dem konsekvent. Lämna ALDRIG en namngiven figur olistad, och inför inga fler huvudkaraktärer än de ${config.numCharacters} begärda.`;

  const textDensityDesc = getTextDensityDescription(config.textDensity, config.bookFormat);

  const prompt = `Du är en erfaren barnboksförfattare. Skapa en komplett barnbok på SVENSKA.

BOKENS GRUNDDATA:
- Titel: "${config.title}"
- Målålder: ${config.targetAge}
- Antal sidor: ${config.numPages} (= ${numSpreads} uppslag)
- Antal karaktärer: ${config.numCharacters}
${config.subject ? `- Ämne: ${config.subject}` : ''}

HANDLING/TEMA: ${config.plot}
MILJÖ: ${config.setting}

TEXTMÄNGD PER SIDA:
${textDensityDesc}
${config.textStyleNotes ? `
SKRIVSTIL (baserad på analys av professionella barnböcker i samma genre - följ denna noga):
${config.textStyleNotes}
` : ''}${config.languageExamples && config.languageExamples.length > 0 ? `
SPRÅKLIGA FÖREBILDER - så här låter en professionell bok i denna stil. Studera meningsrytmen, ordvalet, dialogtonen och hur naturligt det flyter. Skriv DIN text med samma känsla och naturlighet - men HITTA PÅ helt egen text. Kopiera ALDRIG dessa meningar, fraser eller handlingen, använd dem bara för att förstå rösten:
${config.languageExamples.map(ex => `• "${ex}"`).join('\n')}

Undvik stolpig, mekanisk eller "AI-aktig" text. Skriv levande, varmt och naturligt precis som exemplen ovan.
` : ''}

BOKFORMAT:
${formatDesc}

${formatTemplate}

BILDSTIL (bara för stämningen - skriv INTE in ritstilen i bildpromptarna, den läggs på separat): ${config.imageStyle}

KARAKTÄRER:
${characterInstructions}

---

Skapa HELA boken i EXAKT detta format (det är viktigt att formatet följs exakt):

Titel: ${config.title}

KARAKTÄRER

* [Karaktärsnamn] - [ålder], [kort beskrivning]
Art: [människa/katt/hund/björn osv.]
Roll: [huvudkaraktär/bikaraktär]
Utseende: [detaljerad beskrivning av utseende - hårfärg, ögonfärg, kroppsbyggnad, speciella drag. För djur: päls/fjädrar, färger, storlek]
Vanliga kläder: [vad karaktären brukar ha på sig]
Personlighet: [personlighetsdrag]
${config.bookFormat === 'bildbok-text-pa-bild' ? 'Superhjältedräkt: [om relevant]' : ''}

(Upprepa för varje karaktär - både huvudkaraktärer och ALLA namngivna bikaraktärer)

OMSLAG

BILDPROMPT - OMSLAG:
[Bildprompt på ENGELSKA för bokens framsida. Visa huvudkaraktärerna i en iögonfallande scen som fångar bokens tema. Inkludera instruktionen att bokens titel "${config.title}" ska visas som stor, tydlig titeltext på svenska högst upp på omslaget.]

${config.bookFormat === 'kapitelbok' ? 'KAPITEL 1: [KAPITELNAMN]\n' : ''}SIDA 6-7 (Uppslag 1)

Text (sida 6 - textruta överst):
[Text här]

Text (sida 7 - textruta nedre):
[Text här]

BILDPROMPT - SIDA 6-7:
[Detaljerad bildprompt på ENGELSKA som beskriver illustrationen. Inkludera stil, komposition, karaktärernas positioner, bakgrund, belysning, stämning. Skriv alltid bildprompten på engelska.]

(Fortsätt med alla ${numSpreads} uppslag - sista uppslaget är SIDA ${lastContentPage - 1}-${lastContentPage})

SLUTSIDA

Text (sida ${config.numPages}):
[Avslutande text]

BILDPROMPT - SIDA ${config.numPages}:
[Avslutande illustration]

---

VIKTIGA REGLER:
1. Skriv ALL berättande text på SVENSKA
2. Skriv ALLA bildpromptar på ENGELSKA
3. Följ formatet EXAKT - parsern behöver "SIDA X-Y (Uppslag N)", "Text (sida X):", och "BILDPROMPT - SIDA X-Y:"
4. Skapa ALLA ${numSpreads} uppslag plus OMSLAG och SLUTSIDA - hoppa inte över några
${config.bookFormat === 'kapitelbok' ? '5. Varje kapitel ska ha en KAPITEL-rubrik' : '5. Använd INTE kapitelrubriker - berättelsen ska flöda utan kapitelindelning. Skriv ALDRIG ordet KAPITEL någonstans i boken eller bildpromptarna.'}
6. Sidnumrering: innehållet börjar på sida 6 (sida 1-5 är titelsida/copyright), sista uppslaget är sida ${lastContentPage - 1}-${lastContentPage} och SLUTSIDA är bokens sista sida (sida ${config.numPages}). Totalt ${config.numPages} sidor - överskrid ALDRIG sida ${config.numPages}.
7. Gör berättelsen engagerande, åldersanpassad och med en tydlig dramaturgi
8. Varje bildprompt ska vara detaljerad (minst 3-4 meningar) och beskriva motiv, komposition, miljö, ljus och stämning - men INTE ritstil, teknik eller hur ansikten ritas (stilen läggs på separat)
9. Karaktärsbeskrivningarna ska vara tillräckligt detaljerade för att kunna generera konsekventa bilder
10. ${config.bookFormat === 'bildbok-text-pa-bild' ? 'Inkludera i bildprompten var texten ska placeras (t.ex. "text box in upper left", "speech bubble")' : 'Bildprompten ska INTE inkludera text i bilden'}
11. Bildpromptarna får ALDRIG be om rubriker, kapitelbanderoller, sidnummer eller annan text utöver berättelsetexten${config.bookFormat === 'bildbok-text-pa-bild' ? ' i textrutor/pratbubblor' : ''}`;

  const model = await resolveLatestModel(client);

  const message = await createWithModelFallback(client, model, prompt);

  // Extract text content
  const textContent = message.content.find(c => c.type === 'text');
  if (!textContent || textContent.type !== 'text') {
    throw new Error('Inget textinnehåll i svaret från Claude');
  }

  return textContent.text;
}

async function createWithModelFallback(client: Anthropic, model: string, prompt: string) {
  return withModelFallback(model, m => generate(client, m, prompt));
}

export async function withModelFallback<T>(model: string, run: (model: string) => Promise<T>): Promise<T> {
  try {
    return await run(model);
  } catch (err) {
    // Om modellen hunnit pensioneras (404) - rensa cachen och kör fallback-aliaset.
    if (err instanceof Anthropic.NotFoundError && model !== FALLBACK_MODEL) {
      cachedModel = null;
      return run(FALLBACK_MODEL);
    }
    throw err;
  }
}

// ═══════════════════════════════════════════
//  Stilprovning: dela upp en textbit i scener
// ═══════════════════════════════════════════

export interface StyleTestCharacter {
  name: string;
  age: string;
  role: 'main' | 'supporting';
  appearance: string;
  normalClothes: string;
  personality: string;
}

export interface StyleTestScene {
  label: string;
  text: string;
  imagePrompt: string;
  // Serieformat: sidmanuset står i imagePrompt och de lettrade texterna här
  textBlocks?: TextBlock[];
}

export interface StyleTestPlan {
  title: string;
  characters: StyleTestCharacter[];
  coverPrompt: string;
  // Äldre provningar har en gemensam uppdelning; nya har en per stil
  scenes: StyleTestScene[];
  scenesByStyle?: Record<string, StyleTestScene[]>;
}

// En uppdelning av manusets början: stycke 1..lastParagraph i `count` delar
export interface StyleTestSplitRequest {
  key: string;
  lastParagraph: number;
  count: number;
}

export interface StyleTestRawPlan {
  title: string;
  characters: StyleTestCharacter[];
  coverPrompt: string;
  splits: { key: string; scenes: { startParagraph: number; label: string; imagePrompt: string }[] }[];
}

const CHARACTERS_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['name', 'age', 'role', 'appearance', 'normalClothes', 'personality'],
    properties: {
      name: { type: 'string' },
      age: { type: 'string' },
      role: { type: 'string', enum: ['main', 'supporting'] },
      appearance: { type: 'string' },
      normalClothes: { type: 'string' },
      personality: { type: 'string' },
    },
  },
};

const STYLE_TEST_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'characters', 'coverPrompt', 'splits'],
  properties: {
    title: { type: 'string' },
    characters: CHARACTERS_SCHEMA,
    coverPrompt: { type: 'string' },
    splits: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['key', 'scenes'],
        properties: {
          key: { type: 'string' },
          scenes: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['startParagraph', 'label', 'imagePrompt'],
              properties: {
                startParagraph: { type: 'integer' },
                label: { type: 'string' },
                imagePrompt: { type: 'string' },
              },
            },
          },
        },
      },
    },
  },
};

// Stilprovning: olika bokkoncept har olika mycket text per bild, så början av
// manuset delas upp en gång per koncept. Claude anger bara styckenummer - texten
// plockas ordagrant på servern.
export async function planStyleTest(
  paragraphs: string[],
  splits: StyleTestSplitRequest[],
  title?: string
): Promise<StyleTestRawPlan> {
  const client = getClient();
  const model = await resolveLatestModel(client);
  const numbered = paragraphs.map((p, i) => `[${i + 1}] ${p}`).join('\n');
  const splitLines = splits
    .map(sp => `   - key "${sp.key}": stycke 1-${sp.lastParagraph} i EXAKT ${sp.count} ${sp.count === 1 ? 'del' : 'delar'}`)
    .join('\n');

  const prompt = `Du hjälper en barnboksförfattare att prova olika illustrationsstilar på början av sitt manus, innan hela boken skapas.

MANUS (början, numrerade stycken):
"""
${numbered}
"""

${title ? `Författarens titel: "${title}"` : 'Ingen titel angiven - föreslå en kort, lockande titel på svenska utifrån texten.'}

UPPGIFT:
1. KARAKTÄRER: Lista alla namngivna figurer som syns i texten. Om utseendet inte beskrivs, hitta på ett konkret, konsekvent utseende som passar texten (ålder, hår, ögon, kroppsbyggnad, kläder). Använd det som faktiskt står i texten när det finns.
2. OMSLAG: Skriv en bildprompt på ENGELSKA för bokens framsida som fångar stämningen och visar huvudkaraktärerna. Instruera att titeln ska stå som stor titeltext på svenska.
3. UPPDELNINGAR: Olika boktyper har olika mycket text per bild. Gör följande uppdelningar av manusets början:
${splitLines}
   Varje del täcker en sammanhängande bit i ordning. Ange för varje del:
   - startParagraph: styckenumret där delen börjar (första delen börjar på 1, stigande ordning)
   - label: kort svensk rubrik för scenen (t.ex. "Drömmen i skogen")
   - imagePrompt: detaljerad bildprompt på ENGELSKA för delens mest bildstarka ögonblick. Beskriv komposition, miljö, ljus och stämning. Skriv in varje närvarande karaktärs fullständiga utseende (namn + hår, ögon, kläder) så att figurerna blir likadana på alla bilder.

Bildpromptarna ska INTE innehålla någon ritstil - stilen läggs på separat. De får inte be om text, rubriker eller sidnummer i bilden (utom titeln på omslaget).`;

  return withModelFallback(model, async (m) => {
    const stream = client.messages.stream({
      model: m,
      max_tokens: 32000,
      output_config: {
        effort: 'medium',
        format: { type: 'json_schema', schema: STYLE_TEST_SCHEMA },
      },
      messages: [{ role: 'user', content: prompt }],
    });
    const message = await stream.finalMessage();

    if (message.stop_reason === 'refusal') {
      throw new Error('Claude avböjde att analysera texten');
    }
    if (message.stop_reason === 'max_tokens') {
      throw new Error('Texten är för lång för en stilprovning - korta ner den till början av boken');
    }
    const textBlock = message.content.find(c => c.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      throw new Error('Inget svar från Claude');
    }
    return JSON.parse(textBlock.text) as StyleTestRawPlan;
  });
}

// ═══════════════════════════════════════════
//  Eget manus: planera en hel bok ur fri text
// ═══════════════════════════════════════════

export interface ManuscriptPlan {
  title: string;
  characters: StyleTestCharacter[];
  coverPrompt: string;
  // Varje uppslag börjar vid ett styckenummer (1-baserat) och sträcker sig till nästa
  spreads: { startParagraph: number; imagePrompt: string; composition?: Composition }[];
}

const MANUSCRIPT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'characters', 'coverPrompt', 'spreads'],
  properties: {
    title: { type: 'string' },
    characters: CHARACTERS_SCHEMA,
    coverPrompt: { type: 'string' },
    spreads: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['startParagraph', 'imagePrompt'],
        properties: {
          startParagraph: { type: 'integer' },
          imagePrompt: { type: 'string' },
        },
      },
    },
  },
};

export async function planManuscript(
  paragraphs: string[],
  options: {
    bookFormat: 'bildbok-separat-text' | 'kapitelbok';
    title?: string;
    minSpreads: number;
    maxSpreads: number;
    // Rörlig bildblandning: AI:n väljer bildtyp per del utifrån innehållet
    compositionMix?: Partial<Record<Composition, number>>;
  }
): Promise<ManuscriptPlan> {
  const client = getClient();
  const model = await resolveLatestModel(client);
  const numbered = paragraphs.map((p, i) => `[${i + 1}] ${p}`).join('\n');
  const isChapterBook = options.bookFormat === 'kapitelbok';
  const mix = options.compositionMix;
  const schema = mix ? {
    ...MANUSCRIPT_SCHEMA,
    properties: {
      ...MANUSCRIPT_SCHEMA.properties,
      spreads: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['startParagraph', 'composition', 'imagePrompt'],
          properties: {
            startParagraph: { type: 'integer' },
            composition: { type: 'string', enum: COMPOSITIONS.filter(c => (mix[c] ?? 0) > 0) },
            imagePrompt: { type: 'string' },
          },
        },
      },
    },
  } : MANUSCRIPT_SCHEMA;

  // Claude returnerar bara var uppslagen börjar - texten plockas ordagrant ur
  // manuset på servern, så inga ord kan ändras eller tappas
  const prompt = `Du är redaktör på ett barnboksförlag och ska göra en illustrerad ${isChapterBook ? 'kapitelbok' : 'bilderbok'} av ett färdigt manus. Texten får inte ändras.

MANUS - numrerade stycken:
"""
${numbered}
"""

${options.title ? `Författarens titel: "${options.title}"` : 'Ingen titel angiven - föreslå en kort, lockande titel på svenska utifrån texten.'}

UPPGIFT:
1. KARAKTÄRER: Lista alla namngivna figurer som återkommer. Använd utseendet som står i texten; där det saknas, hitta på ett konkret och konsekvent utseende som passar (ålder, hår, ögon, kroppsbyggnad, kläder).
2. OMSLAG: Bildprompt på ENGELSKA för framsidan som fångar bokens stämning och visar huvudkaraktärerna. Titeln ska stå som stor titeltext på svenska.
3. UPPSLAG: Dela upp HELA manuset i ${options.minSpreads}-${options.maxSpreads} på varandra följande delar. Ange för varje del vilket stycke den börjar på (startParagraph). Första delen börjar på stycke 1 och delarna ska komma i stigande ordning.
${isChapterBook
    ? '   - Kapitelbok: varje del får EN illustration. Lägg gränserna vid naturliga scenbyten och låt en kapitelrubrik alltid inleda en ny del. Delarna får gärna vara olika långa.'
    : '   - Bilderbok: varje del blir ett uppslag med en bild. Håll delarna ungefär lika långa och bryt vid naturliga bildmoment.'}
${mix ? `   - composition: vilken sorts bild delen får. Boken ska vara rörlig och blanda bildtyperna genom hela boken, aldrig samma form i lång rad. Välj efter innehållet:
${compositionGuide(mix)}
` : ''}   - imagePrompt: detaljerad bildprompt på ENGELSKA för delens mest bildstarka ögonblick${mix ? ', skriven för den valda bildtypen (spot: bara figurerna och det de håller i, ingen miljö; panels: beskriv 3-4 rutor i ordning; round: ett centrerat motiv)' : ''}. Beskriv motiv, komposition, miljö, ljus och stämning, och skriv in varje närvarande karaktärs fullständiga utseende (namn + hår, ögon, kläder).

Bildpromptarna ska INTE innehålla någon ritstil - stilen läggs på separat. De får inte be om text, rubriker eller sidnummer i bilden (utom titeln på omslaget).`;

  return withModelFallback(model, async (m) => {
    const stream = client.messages.stream({
      model: m,
      max_tokens: 32000,
      output_config: {
        effort: 'medium',
        format: { type: 'json_schema', schema },
      },
      messages: [{ role: 'user', content: prompt }],
    });
    const message = await stream.finalMessage();

    if (message.stop_reason === 'refusal') {
      throw new Error('Claude avböjde att bearbeta manuset');
    }
    if (message.stop_reason === 'max_tokens') {
      throw new Error('Manuset är för långt för att bearbetas i ett steg - dela upp det i flera böcker');
    }
    const textBlock = message.content.find(c => c.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      throw new Error('Inget svar från Claude');
    }
    return JSON.parse(textBlock.text) as ManuscriptPlan;
  });
}

// ═══════════════════════════════════════════
//  Serieroman: ett prosamanus blir seriesidor
// ═══════════════════════════════════════════

export interface ComicCastPlan {
  title: string;
  characters: StyleTestCharacter[];
  coverPrompt: string;
}

export interface ComicBookPlan extends ComicCastPlan {
  pages: ComicPage[];
}

const COMIC_CAST_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'characters', 'coverPrompt'],
  properties: {
    title: { type: 'string' },
    characters: CHARACTERS_SCHEMA,
    coverPrompt: { type: 'string' },
  },
};

const COMIC_PANEL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['size', 'description', 'caption', 'dialogue', 'sfx'],
  properties: {
    size: { type: 'string', enum: ['small', 'medium', 'large', 'wide'] },
    description: { type: 'string' },
    caption: { type: 'string' },
    dialogue: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['speaker', 'text'],
        properties: {
          speaker: { type: 'string' },
          text: { type: 'string' },
        },
      },
    },
    sfx: { type: 'string' },
  },
};

const COMIC_PAGES_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['sections'],
  properties: {
    sections: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['pages'],
        properties: {
          pages: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['panels'],
              properties: { panels: { type: 'array', items: COMIC_PANEL_SCHEMA } },
            },
          },
        },
      },
    },
  },
};

async function streamJson<T>(prompt: string, schema: { [key: string]: unknown }, opts: { effort: 'low' | 'medium'; maxTokens: number; refusal: string; tooLong: string }): Promise<T> {
  const client = getClient();
  const model = await resolveLatestModel(client);
  return withModelFallback(model, async (m) => {
    const stream = client.messages.stream({
      model: m,
      max_tokens: opts.maxTokens,
      output_config: {
        effort: opts.effort,
        format: { type: 'json_schema', schema },
      },
      messages: [{ role: 'user', content: prompt }],
    });
    const message = await stream.finalMessage();
    if (message.stop_reason === 'refusal') throw new Error(opts.refusal);
    if (message.stop_reason === 'max_tokens') throw new Error(opts.tooLong);
    const textBlock = message.content.find(c => c.type === 'text');
    if (!textBlock || textBlock.type !== 'text') throw new Error('Inget svar från Claude');
    return JSON.parse(textBlock.text) as T;
  });
}

// Steg 1: titel, figurer och omslag för hela serien (så att alla delar använder samma figurer)
export async function planComicCast(paragraphs: string[], title?: string): Promise<ComicCastPlan> {
  const numbered = paragraphs.map((p, i) => `[${i + 1}] ${p}`).join('\n');
  const prompt = `Du är redaktör på ett barnboksförlag och ska göra en färgglad, tokig serieroman för barn av ett färdigt manus.

MANUS - numrerade stycken:
"""
${numbered}
"""

${title ? `Författarens titel: "${title}"` : 'Ingen titel angiven - föreslå en kort, lockande titel på svenska utifrån texten.'}

UPPGIFT:
1. KARAKTÄRER: Lista alla namngivna figurer som återkommer (även djur och skurkar). Använd utseendet som står i texten; där det saknas, hitta på ett konkret, konsekvent och lätt tecknat utseende (ålder, art, hår/päls, ögon, kroppsbyggnad, ett tydligt kännetecken) och vardagskläder med färger.
2. OMSLAG: Bildprompt på ENGELSKA för framsidan av serieromanen: huvudfigurerna i en rolig, actionfylld pose med stor energi. Titeln ska stå som stor titeltext på svenska. Ingen ritstil (den läggs på separat).`;

  return streamJson<ComicCastPlan>(prompt, COMIC_CAST_SCHEMA, {
    effort: 'low',
    maxTokens: 8000,
    refusal: 'Claude avböjde att bearbeta manuset',
    tooLong: 'Manuset är för långt för att bearbetas - dela upp det i flera böcker',
  });
}

export interface ComicSectionInput {
  text: string;
  pages: number;
}

// Steg 2: manusdelar blir seriesidor. Varje del får exakt det antal sidor som anges.
export async function writeComicPages(input: {
  sections: ComicSectionInput[];
  cast: StyleTestCharacter[];
  title?: string;
  targetAge?: string;
  textStyle?: string;
  before?: string; // slutet av föregående del, bara som sammanhang
  effort?: 'low' | 'medium';
}): Promise<ComicPage[][]> {
  const cast = input.cast.length > 0
    ? input.cast.map(c => `- ${c.name}${c.age ? `, ${c.age}` : ''}: ${c.appearance}${c.personality ? ` (${c.personality})` : ''}`).join('\n')
    : '(inga angivna - använd figurerna i texten)';
  const sections = input.sections
    .map((s, i) => `<del nr="${i + 1}" sidor="${s.pages}">\n${s.text.trim()}\n</del>`)
    .join('\n\n');

  const prompt = `Du är manusförfattare och redaktör för en svensk serieroman för barn ${input.targetAge ?? '6-10 år'}: tokig, snäll och färgglad, med rutor, pratbubblor, små textrutor och stora ljudord. Du gör om ett färdigt prosamanus till seriesidor.
${input.title ? `\nTITEL: "${input.title}"\n` : ''}
FIGURER (använd exakt dessa namn):
${cast}
${input.before?.trim() ? `
SÅ HÄR SLUTADE FÖREGÅENDE DEL (bara sammanhang - gör inga sidor av den):
"""
${input.before.trim()}
"""
` : ''}
MANUSDELAR SOM SKA BLI SERIESIDOR:
${sections}

UPPGIFT: Gör varje del till EXAKT det antal seriesidor som står i sidor="...". Svara med en post i sections per del, i samma ordning (${input.sections.length} ${input.sections.length === 1 ? 'post' : 'poster'}).

SIDOR OCH RUTOR
- Varje sida har 2-6 rutor, oftast 3-5. Variera: en stor ruta när något stort händer, flera små när det går snabbt. Sidans sista ruta slutar gärna med en poäng eller en liten cliffhanger.
- Håll dig trogen manuset: samma händelser i samma ordning, samma figurer och samma slut. Du får korta, slå ihop och göra om berättartext till textrutor, repliker och bild - en serie kan inte ha all prosa. Hoppa aldrig över något som betyder något för handlingen. Hitta inte på nya händelser.
- En kapitelrubrik i manuset kan bli en textruta i första rutan på en ny sida, t.ex. "Kapitel 2: Den stora flykten".
- size: small, medium, large eller wide (hur stor rutan är på sidan). Använd wide eller large för etablerande bilder och stora ögonblick.
- description: 1-3 korta meningar på ENGELSKA om vad rutan visar: vilka figurer som syns (med namn exakt som i listan), vad de gör, tydliga ansiktsuttryck och kroppsspråk, miljön och bildvinkeln (närbild, helbild, från ovan). Skriv inte ritstil eller utseende - det läggs på separat. Ingen text, inga skyltar med ord och inga pratbubblor i beskrivningen.

TEXT I RUTORNA
- caption: kort textruta på svenska, högst 8 ord, t.ex. "Under tiden ..." eller "Senare samma kväll". Tom sträng om rutan inte behöver någon. Inte i varje ruta.
- dialogue: 0-3 repliker per ruta, i den ordning de sägs. speaker = figurens namn exakt som i listan (eller en kort beskrivning som "en polis" för okända). text = bara själva repliken på svenska, 2-10 ord, utan talstreck, citattecken eller namnet på den som pratar. Den som pratar ska synas i rutan. Högst ett betonat ORD i versaler per replik.
- sfx: ett ljudord när något låter eller smäller (t.ex. "KLONK!", "PANG!", "SVISCH!", "ZOOOM!"), annars tom sträng. Inte i varje ruta.
- Högst ca 30 ord text per sida sammanlagt, så att texten kan letras stort och läsas av barn.
- Skriv aldrig sidnummer.
${input.textStyle ? `
BOKTYPENS SPRÅK (fånga känslan, härma aldrig en förlaga):
${input.textStyle}
` : ''}
SPRÅKET I BUBBLOR OCH TEXTRUTOR
- Levande, naturlig talad svenska som barn själva kan läsa. Korta, roliga repliker som låter som när folk faktiskt pratar, med ordvitsar och slapstick där det passar.
- Stava rätt med å, ä och ö.
- Inga långa tankstreck (—) och inga tankstreck mitt i meningar. Inga klyschor som "magisk" eller "ett äventyr de aldrig skulle glömma".
- Figurer, namn, platser och varumärken från befintliga serier, böcker och filmer får aldrig förekomma, inte heller från den serie boktypen är inspirerad av. Behåll manusets egna namn.`;

  // Ungefär 450 tokens per sida - marginal för långa beskrivningar
  const totalPages = input.sections.reduce((n, s) => n + s.pages, 0);
  const raw = await streamJson<{ sections?: { pages?: Partial<ComicPage>[] }[] }>(prompt, COMIC_PAGES_SCHEMA, {
    effort: input.effort ?? 'medium',
    maxTokens: Math.min(32000, 4000 + totalPages * 900),
    refusal: 'Claude avböjde att göra serien',
    tooLong: 'Seriesidorna blev för långa - försök igen',
  });
  return input.sections.map((_, i) => normalizeComicPages(raw.sections?.[i]?.pages ?? []));
}

// Hela serieromanen: figurer först, sedan manuset i delar som skrivs parallellt
export async function planComicBook(
  paragraphs: string[],
  options: { title?: string; pages: number; wordsPerImage: number; targetAge?: string; textStyle?: string }
): Promise<ComicBookPlan> {
  const PAGES_PER_CALL = 14;
  // Högst 120 sidor = högst 9 delar - alla körs parallellt så att routen hinner inom 300 s
  const CONCURRENCY = 9;
  const wordCount = (p: string) => p.split(/\s+/).filter(Boolean).length;
  const totalWords = Math.max(1, paragraphs.reduce((n, p) => n + wordCount(p), 0));
  const wordsPerCall = Math.max(options.wordsPerImage, Math.round((totalWords / options.pages) * PAGES_PER_CALL));

  // Dela manuset vid styckegränser, helst vid en kapitelrubrik när delen nästan är full
  const chunks: string[][] = [];
  let current: string[] = [];
  let words = 0;
  for (const p of paragraphs) {
    const heading = /^(kapitel\s+\S+|prolog|epilog)\b/i.test(p);
    if (current.length > 0 && (words >= wordsPerCall || (heading && words >= wordsPerCall * 0.6))) {
      chunks.push(current);
      current = [];
      words = 0;
    }
    current.push(p);
    words += wordCount(p);
  }
  if (current.length > 0) {
    // En mycket kort sista del slås ihop med föregående
    if (chunks.length > 0 && words < wordsPerCall * 0.3) chunks[chunks.length - 1].push(...current);
    else chunks.push(current);
  }

  const castPlan = await planComicCast(paragraphs, options.title);
  const title = options.title || castPlan.title;

  const results: ComicPage[][] = new Array(chunks.length);
  let next = 0;
  const worker = async () => {
    while (next < chunks.length) {
      const i = next++;
      const text = chunks[i].join('\n');
      const pages = Math.max(1, Math.round((options.pages * wordCount(text)) / totalWords));
      const before = i > 0 ? chunks[i - 1].slice(-3).join('\n').slice(-600) : undefined;
      const run = () => writeComicPages({
        sections: [{ text, pages }],
        cast: castPlan.characters,
        title,
        targetAge: options.targetAge,
        textStyle: options.textStyle,
        before,
      });
      let pagesOut: ComicPage[][];
      try {
        pagesOut = await run();
      } catch (err) {
        console.warn(`[serie] del ${i + 1} misslyckades, försöker igen:`, err instanceof Error ? err.message : err);
        pagesOut = await run();
      }
      results[i] = pagesOut[0] ?? [];
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, chunks.length) }, worker));

  return { ...castPlan, title, pages: normalizeComicPages(results.flat()) };
}

async function generate(client: Anthropic, model: string, prompt: string) {
  // Streaming krävs vid höga max_tokens och skyddar långa genereringar mot timeout.
  const stream = client.messages.stream({
    model,
    max_tokens: 64000,
    thinking: { type: 'adaptive' },
    messages: [
      {
        role: 'user',
        content: prompt,
      },
    ],
  });
  return stream.finalMessage();
}

// ═══════════════════════════════════════════
//  Skriv med AI: slumpa handling, skriv början, skriv resten
// ═══════════════════════════════════════════

// Skrivstil från analyserade referensböcker (hämtas i API-routen)
export interface WritingStyleRef {
  textStyleNotes?: string;
  languageExamples?: string[];
}

export interface PlotSuggestion {
  title: string;
  plot: string;
  setting: string;
}

export interface BeginningInput {
  preset: StylePreset;
  targetAge: string;
  title?: string;
  plot: string;
  setting?: string;
  characterNotes?: string;
  characters?: { name: string; appearance?: string; personality?: string }[];
  style?: WritingStyleRef;
  voice?: AuthorVoiceRef; // författarens eget språk - går före seriens språkexempel
}

export interface BookBeginning {
  title: string;
  outline: string;
  rawText: string;
}

export interface ContinueInput {
  preset: StylePreset;
  targetAge: string;
  title: string;
  outline: string;
  rawText: string;
  style?: WritingStyleRef;
  voice?: AuthorVoiceRef; // författarens eget språk - går före seriens språkexempel
}

// Början = ungefär fyra illustrerade sidor, aldrig mer än hela boken.
// Samma formel finns i BookCreator (klienten får inte importera den här filen).
export function beginningWordTarget(book: BookConcept): number {
  return Math.min(book.targetWords, book.wordsPerImage * 4);
}

export function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

// Namn i en kort handling: ord med stor bokstav som inte är vanliga ord
function plotNames(plot: string): string[] {
  const common = new Set(['Det', 'Den', 'När', 'Men', 'Och', 'Hon', 'Han', 'De', 'En', 'Ett', 'Sverige', 'Kapitel', 'Till', 'Där', 'Under', 'Efter', 'Tillsammans', 'Problemet', 'Samtidigt', 'Varje', 'Ingen', 'Alla', 'Nu', 'Då']);
  return Array.from(new Set((plot.match(/\b[A-ZÅÄÖ][a-zåäöé]{1,14}\b/g) ?? []).filter(n => !common.has(n)))).slice(0, 8);
}

function pickOne<T>(list: T[]): T {
  return list[Math.floor(Math.random() * list.length)];
}

const PLOT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'plot', 'setting'],
  properties: {
    title: { type: 'string' },
    plot: { type: 'string' },
    setting: { type: 'string' },
  },
};

export async function suggestRandomPlot(preset: StylePreset, targetAge: string, hint?: string): Promise<PlotSuggestion> {
  const client = getClient();
  const [model, recent] = await Promise.all([resolveLatestModel(client), recentStories(40)]);
  const isChapterBook = preset.book.format === 'kapitelbok';
  const seeds = seedsBlock(drawStorySeeds(preset.id, avoidTextOf(recent)), hint ? 'krydda' : 'grund');

  const prompt = `Du är en prisbelönt svensk barnboksförfattare. Hitta på en ny, originell idé till en ${isChapterBook ? 'kapitelbok' : 'bilderbok'} på svenska.

BOKTYP: ${preset.label} – ${preset.concept}
LÄNGD: ca ${preset.book.targetWords} ord (${preset.book.lengthLabel})
MÅLÅLDER: ${targetAge}
${hint ? `
FÖRFATTARENS IDÉ (bygg vidare på den, den går före allt annat): ${hint}
` : ''}
${seeds}

${memoryBlock(recent)}

Svara med:
- title: kort, lockande svensk titel
- plot: 2-3 korta, vanliga meningar (högst 60 ord) om vad boken handlar om: vem huvudpersonen är (namn, och ålder om det behövs), vad hen vill eller måste lösa och vad som står i vägen. Avslöja inte slutet. Variera hur du börjar: inte alltid "Namn är åtta år och ...", inte "Problemet är att", inte "lögnen växer". Handlingen ska räcka till bokens längd${isChapterBook ? ' och bära flera kapitel' : ' och vara enkel nog för en bilderbok'}.
- setting: en kort mening om miljön

Skriv som en författare som berättar sin idé för en vän, inte som en säljtext. Inga tankstreck, inga långa bisatskedjor, inga klyschor. Anpassa innehållet till målåldern.

${variationBlock({ names: true, opening: false })}`;

  return withModelFallback(model, async (m) => {
    const message = await client.messages.create({
      model: m,
      max_tokens: 1500,
      output_config: {
        effort: 'low',
        format: { type: 'json_schema', schema: PLOT_SCHEMA },
      },
      messages: [{ role: 'user', content: prompt }],
    });
    if (message.stop_reason === 'refusal') {
      throw new Error('Claude avböjde att föreslå en handling - prova en annan idé');
    }
    const textBlock = message.content.find(c => c.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      throw new Error('Inget svar från Claude');
    }
    const raw = JSON.parse(textBlock.text) as PlotSuggestion;
    const plot = { title: sanitizeProse(raw.title), plot: sanitizeProse(raw.plot), setting: sanitizeProse(raw.setting) };
    // Kom ihåg idén så att nästa förslag inte upprepar den
    await rememberStory({
      kind: 'plot',
      style: preset.id,
      title: plot.title,
      names: plotNames(plot.plot),
      setting: plot.setting.slice(0, 160),
      premise: plot.plot.split(/(?<=[.!?])\s+/)[0]?.slice(0, 200),
    });
    return plot;
  });
}

// ═══════════════════════════════════════════
//  Författarspråk: hur en viss författare skriver ("Slutför din bok")
// ═══════════════════════════════════════════

export interface AuthorVoiceRef {
  profile: VoiceProfile;
  samples: string[];
}

// Replikmarkeringar som står först i raden och kan bytas mot varandra.
// Citattecken räknas inte - där måste repliken också avslutas.
export function lineDialogueMarker(marker?: string): string | undefined {
  const m = marker?.trim();
  if (m === '*') return '* ';
  if (m === '–' || m === '—' || m === '―') return '– ';
  if (m === '-') return '- ';
  return undefined;
}

// Promptblock med författarens röst: profil + ordagranna utdrag
export function authorVoiceBlock(voice: AuthorVoiceRef): string {
  const p = voice.profile;
  const line = (label: string, value?: string) => (value?.trim() ? `- ${label}: ${value.trim()}\n` : '');
  const list = (items?: string[]) => (items ?? []).filter(i => i?.trim()).map(i => `  • ${i.trim()}`).join('\n');
  const samples = voice.samples.filter(s => s?.trim());
  const marker = p.dialogueMarker ? JSON.stringify(p.dialogueMarker) : '';

  return `
FÖRFATTARSPRÅK - så skriver just den här författaren. Det här går före ALLA andra stilregler och stilexempel: där författarens röst skiljer sig från de allmänna reglerna (tempus, replikformat, stor eller liten bokstav i anföringen, meningslängd, ordval, talspråk) följer du författaren. Det enda undantaget är långa tankstreck (—), som aldrig får användas.
${line('Helhet', p.summary)}${line('Tempus', p.tense)}${line('Perspektiv', p.perspective)}${line('Meningsrytm', p.sentenceRhythm)}${line('Repliker', p.dialogue)}${marker ? `- Replikmarkering först i raden: ${marker} (exakt så, inklusive mellanslag)\n` : ''}${line('Ordförråd', p.vocabulary)}${line('Känslor', p.emotions)}${line('Detaljer', p.details)}${line('Humor', p.humor)}${line('Tempo', p.pacing)}${p.signatureMoves?.length ? `- Typiska grepp:\n${list(p.signatureMoves)}\n` : ''}${p.avoid?.length ? `- Gör aldrig:\n${list(p.avoid)}\n` : ''}${samples.length > 0 ? `
UTDRAG UR FÖRFATTARENS EGEN TEXT (ordagranna). Läs dem högt i huvudet: hör rytmen, se hur repliker skrivs och taggas, vilka ord och detaljer författaren väljer och hur känslor visas. Skriv så att en läsare tror att samma person skrivit din text. Kopiera aldrig meningar, fraser eller händelser ur utdragen.
${samples.map((s, i) => `<utdrag nr="${i + 1}">\n${s.trim()}\n</utdrag>`).join('\n')}
` : ''}`;
}

// Skrivstilsblock - samma formulering som i generateBookContent
function writingStyleBlock(style?: WritingStyleRef, voice?: AuthorVoiceRef): string {
  if (voice) {
    // Författarens eget språk ersätter seriens språkexempel; seriens stilnoter blir bakgrund
    return `${style?.textStyleNotes ? `
SERIENS SKRIVSTIL (bara bakgrund - författarspråket nedan går före):
${style.textStyleNotes}
` : ''}${authorVoiceBlock(voice)}`;
  }
  let block = '';
  if (style?.textStyleNotes) {
    block += `
SKRIVSTIL (baserad på analys av professionella barnböcker i samma genre - följ denna noga):
${style.textStyleNotes}
`;
  }
  if (style?.languageExamples && style.languageExamples.length > 0) {
    block += `
SPRÅKLIGA FÖREBILDER - så här låter en professionell bok i denna stil. Studera meningsrytmen, ordvalet, dialogtonen och hur naturligt det flyter. Skriv DIN text med samma känsla och naturlighet - men HITTA PÅ helt egen text. Kopiera ALDRIG dessa meningar, fraser eller handlingen, använd dem bara för att förstå rösten:
${style.languageExamples.map(ex => `• "${ex}"`).join('\n')}
`;
  }
  return block;
}

function proseRules(targetAge: string): string {
  return `SKRIVREGLER:
1. Skriv levande, idiomatisk SVENSKA som passar ${targetAge}.
2. Gör berättelsen engagerande och åldersanpassad med en tydlig dramaturgi: en huvudperson som vill något eller har ett problem, hinder som växer och ett avslut där huvudpersonen själv gör något avgörande.
3. Alla namngivna figurer ska vara konsekventa genom hela boken (namn, ålder, utseende, sätt att prata).

${PROSE_QUALITY_RULES}`;
}

// Dagboksroman (linjerat papper): manuset är dagboksinlägg som börjar med veckodagen
function isDiaryBook(preset: { id: string; book: { paper?: 'lined' } }): boolean {
  return preset.book.paper === 'lined' || preset.id === 'dagbok';
}

function diaryOutlineUnits(book: BookConcept): string {
  const weeks = Math.min(12, Math.max(3, Math.round(book.targetWords / 900)));
  return `${weeks} veckor (ca ${Math.round(book.targetWords / weeks / 50) * 50} ord per vecka, fördelade på 4-7 inlägg)`;
}

const DIARY_FORMAT_RULES = `- Boken är en DAGBOK. Varje inlägg börjar med veckodagen ensam på en egen rad, t.ex. "Måndag", "Tisdag" ... "Söndag" (ibland med datum eller tid på dagen, t.ex. "Onsdag 4 september" eller "Fredag kväll"), med en tom rad före. Veckodagarna kommer i rätt ordning; dagar utan något att berätta hoppas över.
- Inga kapitelrubriker och inga andra rubriker - skriv ALDRIG ordet Kapitel.
- Jagform genom hela boken. Korta stycken på 2-4 meningar, ett stycke per rad. Ett inlägg är oftast 3-8 stycken.`;

const DIARY_DIALOGUE_RULE = '- Repliker återges oftast indirekt i berättarens egna ord (Mamma sa att jag MÅSTE städa rummet). Ibland, när det gör skämtet bättre, ett kort citat inom svenska citattecken mitt i stycket, t.ex. ”Ut!” skrek Viktor genom dörren. Aldrig talstreck och aldrig långa samtal i replikform.';

function manuscriptFormatRules(isChapterBook: boolean, voice?: AuthorVoiceRef, dialogueStyle?: 'dash' | 'quotes', diary = false): string {
  const marker = lineDialogueMarker(voice?.profile.dialogueMarker);
  if (diary) {
    return `MANUSFORMAT (viktigt - texten sätts automatiskt i boken):
- Ren löptext med ett stycke per rad.
${DIARY_FORMAT_RULES}
${voice ? '- Repliker skrivs som i författarens text, men mest indirekt så att det låter som en dagbok.' : DIARY_DIALOGUE_RULE}
- Inga sidnummer, sidmarkeringar, bildbeskrivningar, kommentarer eller markdown (inga #, * eller **).`;
  }
  const dialogueRule = !voice && dialogueStyle === 'quotes'
    ? '- Repliker står i egna stycken inom svenska citattecken med anföringen efter, t.ex. ”Kom hit!” säger Ture. Flera korta repliker får gärna följa tätt på varandra.'
    : marker
    ? `- Repliker står i egna stycken som börjar med författarens replikmarkering "${marker}" precis som i författarens text, t.ex. "${marker}Kom hit!". Anföringsverb, versaler och skiljetecken i repliken skrivs som författaren gör.`
    : voice
      ? '- Repliker skrivs exakt som i författarens text (samma markering, placering och skiljetecken).'
      : '- Repliker står i egna stycken som börjar med talstreck och mellanslag, t.ex. "– Kom hit! ropade Otis." Använd aldrig citattecken för repliker.';
  return `MANUSFORMAT (viktigt - texten sätts automatiskt i boken):
- Ren löptext med ett stycke per rad.
${isChapterBook
    ? '- Kapitelrubriker på en egen rad i formen "Kapitel 1 – Titel" (eller "Prolog"), med en tom rad före rubriken.'
    : '- Inga kapitel eller rubriker - berättelsen flödar sammanhängande. Skriv ALDRIG ordet Kapitel.'}
${dialogueRule}
- Inga sidnummer, sidmarkeringar, bildbeskrivningar, kommentarer eller markdown (inga #, ${marker === '* ' ? '' : '* eller '}**).`;
}

// Städar bort markdown och fel talstreck så att manuset följer formatet
function normalizeManuscript(text: string, voice?: AuthorVoiceRef, diary = false): string {
  // Med författarspråk byts andra replikstreck mot författarens egen markering
  const marker = lineDialogueMarker(voice?.profile.dialogueMarker);
  const dashMarker = marker ? /^\s*[-—―–]\s+/ : /^\s*[-—―]\s+/;
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter(line => !/^\s*```/.test(line))
    .map(line => line
      .replace(/^\s*#{1,6}\s*/, '')
      .replace(/\*\*|__/g, '')
      .replace(dashMarker, marker ?? '– ')
      .trimEnd())
    .map(sanitizeProse)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    // Repliker som skrevs utan talstreck får det (tomma rader hoppas över).
    // Inte i dagböcker: där är "..., sa jag." indirekt berättartext, inte en replik.
    .replace(/^[\s\S]*$/, all => (diary ? all : restoreDialogueMarkers(all, marker ?? DEFAULT_MARKER).text));
}

// Serieroman: prosan görs om till seriesidor vid planeringen - skriv så att den blir en bra serie
function comicWritingHint(book: BookConcept): string {
  if (book.format !== 'bildbok-text-pa-bild') return '';
  return `
TEXTEN BLIR EN SERIE: Manuset görs sedan om till seriesidor med rutor, pratbubblor, textrutor och ljudord. Skriv därför för serien: mycket dialog i korta repliker, visuella skämt och slapstick som går att rita, ljudord när något händer (KLONK, PANG, SVISCH), korta scener med tydliga platser och mindre berättartext. Beskriv det man ser, inte långa tankar.
`;
}

function outlineUnits(book: BookConcept): string {
  if (book.format === 'kapitelbok') {
    const chapters = Math.min(15, Math.max(4, Math.round(book.targetWords / 600)));
    return `${chapters} kapitel (ca ${Math.round(book.targetWords / chapters / 50) * 50} ord per kapitel)`;
  }
  if (book.format === 'bildbok-text-pa-bild') {
    // Serieroman: dispositionen i scener, inte en rad per seriesida
    const scenes = Math.min(20, Math.max(8, Math.round(book.targetWords / 250)));
    return `${scenes} scener (ca ${Math.round(book.targetWords / scenes / 50) * 50} ord per scen)`;
  }
  const scenes = Math.max(6, Math.round(book.targetWords / book.wordsPerImage));
  return `${scenes} scener/bildmoment (ca ${book.wordsPerImage} ord per bild)`;
}

const BEGINNING_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'outline', 'beginning'],
  properties: {
    title: { type: 'string' },
    outline: { type: 'string' },
    beginning: { type: 'string' },
  },
};

export async function writeBookBeginning(input: BeginningInput): Promise<BookBeginning> {
  const client = getClient();
  const [model, recent] = await Promise.all([resolveLatestModel(client), recentStories(30)]);
  const { preset, targetAge } = input;
  const book = preset.book;
  const isChapterBook = book.format === 'kapitelbok';
  const diary = isDiaryBook(preset);
  const beginningWords = beginningWordTarget(book);

  const characterLines = [
    ...(input.characters ?? [])
      .filter(c => c.name?.trim())
      .map(c => `- ${c.name}${c.appearance ? ` – utseende: ${c.appearance}` : ''}${c.personality ? ` – personlighet: ${c.personality}` : ''}`),
    ...(input.characterNotes?.trim() ? [input.characterNotes.trim()] : []),
  ];

  const prompt = `Du är en erfaren svensk barnboksförfattare. Du ska skriva en ${diary ? 'dagboksroman' : isChapterBook ? 'kapitelbok' : 'bilderbok'} på SVENSKA - men i det här steget bara planera hela boken och skriva BÖRJAN, så att författaren kan läsa texten och prova illustrationerna innan resten skrivs.

BOKTYP: ${preset.label} – ${preset.concept}
MÅLÅLDER: ${targetAge}
HELA BOKENS LÄNGD: ca ${book.targetWords} ord (${book.lengthLabel}), ungefär ${book.wordsPerImage} ord text per illustration
${input.title?.trim() ? `TITEL: "${input.title.trim()}"` : 'TITEL: ingen angiven - hitta på en kort, lockande svensk titel'}

HANDLING: ${input.plot}
${input.setting?.trim() ? `MILJÖ: ${input.setting.trim()}\n` : ''}
KARAKTÄRER:
${characterLines.length > 0
    ? `${characterLines.join('\n')}\nAnvänd dessa figurer som de beskrivs. Lägg till fler figurer bara om berättelsen behöver dem.`
    : 'Inga angivna - skapa de figurer berättelsen behöver, med svenska namn.'}
${writingStyleBlock(input.style, input.voice)}${!input.voice && book.textStyle ? `
BOKTYPENS SPRÅK (beskrivet med egna ord - fånga känslan, härma aldrig en förlaga):
${book.textStyle}
` : ''}
UPPGIFT:
1. title: bokens titel${input.title?.trim() ? ' (använd författarens titel oförändrad)' : ''}.
2. outline: en kort disposition för HELA boken som ren text (ingen markdown), så att resten kan skrivas senare utan att tappa tråden:
   - Först raden "Karaktärer:" följd av en rad per namngiven figur: "– Namn, ålder – roll, utseende i några ord, personlighet".
${diary
    ? `   - Sedan raden "Veckor:" följd av ${diaryOutlineUnits(book)}, en rad var: "Vecka 1: vad som händer i 1-2 meningar".`
    : `   - Sedan raden "${isChapterBook ? 'Kapitel:' : 'Handling:'}" följd av ${outlineUnits(book)}, en rad var: ${isChapterBook ? '"Kapitel 1 – Titel: vad som händer i 1-2 meningar"' : '"1. vad som händer i 1-2 meningar"'}.`}
   - Planera en hel spänningskurva med ett tydligt, tillfredsställande slut.
3. beginning: BARA bokens början, ca ${beginningWords} ord (håll dig nära den längden). ${diary ? 'Börja med det första dagboksinlägget ("Måndag"), där berättaren presenterar sig själv och dagboken med egna ord, och sätt igång handlingen. Sluta efter ett avslutat inlägg' : 'Börja med en fångande öppning, presentera huvudpersonen och sätt igång handlingen. Sluta vid ett naturligt avbrott efter en scen'} - skriv INTE vidare i handlingen och avsluta inte berättelsen.

${manuscriptFormatRules(isChapterBook, input.voice, book.dialogue, diary)}
${comicWritingHint(book)}
${proseRules(targetAge)}

${variationBlock({ names: characterLines.length === 0, opening: true })}
${input.plot.trim().length < 120 ? `\n${seedsBlock(drawStorySeeds(preset.id, avoidTextOf(recent)), 'krydda')}\n` : ''}
${memoryBlock(recent)}`;

  return withModelFallback(model, async (m) => {
    // Strömmar - tänkande + prosa kan ta en stund
    const stream = client.messages.stream({
      model: m,
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      output_config: {
        effort: 'medium',
        format: { type: 'json_schema', schema: BEGINNING_SCHEMA },
      },
      messages: [{ role: 'user', content: prompt }],
    });
    const message = await stream.finalMessage();

    if (message.stop_reason === 'refusal') {
      throw new Error('Claude avböjde att skriva boken - prova att beskriva handlingen på ett annat sätt');
    }
    if (message.stop_reason === 'max_tokens') {
      throw new Error('Svaret blev för långt - försök igen');
    }
    const textBlock = message.content.find(c => c.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      throw new Error('Inget svar från Claude');
    }
    const result = JSON.parse(textBlock.text) as { title: string; outline: string; beginning: string };
    const beginning = {
      title: input.title?.trim() || result.title.trim(),
      outline: result.outline.trim(),
      rawText: normalizeManuscript(result.beginning, input.voice, diary),
    };
    // Kom ihåg namn, titel och öppning (inte författarens idé) för kommande böcker
    const opening = beginning.rawText.split('\n').map(l => l.trim())
      .find(l => l && !/^(kapitel\s+\S+|prolog|inledning)\b/i.test(l) && !(diary && /^(måndag|tisdag|onsdag|torsdag|fredag|lördag|söndag)\b.{0,25}$/i.test(l)));
    await rememberStory({
      kind: 'beginning',
      style: preset.id,
      title: beginning.title,
      names: extractNames(beginning.rawText),
      opening: opening?.slice(0, 160),
    });
    return beginning;
  });
}

/**
 * Skriver resten av boken efter författarens (ev. redigerade) början.
 * Avbryts strax före `deadline` (ms-tidsstämpel) så att routen hinner svara
 * inom maxDuration - då returneras det som hunnit skrivas med truncated: true.
 */
export async function continueBook(input: ContinueInput, deadline: number): Promise<{ rawText: string; truncated: boolean }> {
  const client = getClient();
  const model = await resolveLatestModel(client);
  const { preset, targetAge } = input;
  const book = preset.book;
  const isChapterBook = book.format === 'kapitelbok';
  const diary = isDiaryBook(preset);
  const writtenWords = countWords(input.rawText);
  const remainingWords = Math.max(book.targetWords - writtenWords, book.wordsPerImage * 2);

  // Senaste kapitelrubriken så att numreringen fortsätter rätt
  const headings = input.rawText.match(/^(Kapitel\s+\d+.*|Prolog.*)$/gim) ?? [];
  const lastHeading = headings[headings.length - 1]?.trim();
  // Dagbok: senaste veckodagen så att inläggen fortsätter i rätt ordning
  const days = input.rawText.match(/^(måndag|tisdag|onsdag|torsdag|fredag|lördag|söndag)\b.{0,25}$/gim) ?? [];
  const lastDay = days[days.length - 1]?.trim();

  // Svensk prosa blir ungefär 2-2,5 tokens per ord - marginal för att inte klippa slutet
  const maxTokens = Math.min(32000, Math.max(4000, Math.round(remainingWords * 3) + 1000));

  const prompt = `Du är en erfaren svensk barnboksförfattare och skriver klart en ${diary ? 'dagboksroman' : isChapterBook ? 'kapitelbok' : 'bilderbok'} på SVENSKA.

BOKTYP: ${preset.label} – ${preset.concept}
TITEL: "${input.title}"
MÅLÅLDER: ${targetAge}

DISPOSITION FÖR HELA BOKEN:
"""
${input.outline}
"""

BOKENS BÖRJAN (redan skriven och godkänd av författaren - den kan ha redigerats och avvika från dispositionen; i så fall gäller texten):
"""
${input.rawText}
"""
${writingStyleBlock(input.style, input.voice)}${!input.voice && book.textStyle ? `
BOKTYPENS SPRÅK (beskrivet med egna ord - fånga känslan, härma aldrig en förlaga):
${book.textStyle}
` : ''}
UPPGIFT:
Skriv RESTEN av boken, från exakt där början slutar till bokens slut. Ca ${remainingWords} ord till (hela boken blir då ca ${book.targetWords} ord) - fördela dem jämnt över återstoden av dispositionen${diary ? ' så att varje vecka får ungefär lika mycket text' : isChapterBook ? ' så att varje kapitel får ungefär lika mycket text' : ''}, och skynda inte igenom slutet.
- Fortsätt sömlöst i samma röst, tempus och berättarperspektiv. Upprepa inte något ur början och sammanfatta inte det som redan hänt.
${diary
    ? `- Fortsätt dagboken med nya inlägg${lastDay ? ` - senaste inlägget i början är "${lastDay}". Skriv klart det inlägget om det inte är avslutat och fortsätt sedan med nästa veckodag i ordning` : ''}. Inga kapitelrubriker.`
    : isChapterBook
    ? `- ${lastHeading ? `Senaste kapitelrubriken i början är "${lastHeading}". Skriv klart det kapitlet om det inte är avslutat, och fortsätt sedan numreringen därifrån.` : 'Början saknar kapitelrubriker - fortsätt med nästa kapitel enligt dispositionen och numrera från Kapitel 2.'}`
    : '- Berättelsen fortsätter utan rubriker.'}
- Knyt ihop alla trådar och avsluta med ett tydligt, tillfredsställande slut.
- Svara ENBART med fortsättningen av manuset - ingen inledning, inga kommentarer, inget "Slut".

${manuscriptFormatRules(isChapterBook, input.voice, book.dialogue, diary)}
${comicWritingHint(book)}
${proseRules(targetAge)}`;

  return withModelFallback(model, async (m) => {
    let written = '';
    // Ingen tänkbudget - hela tiden går till själva texten
    const stream = client.messages.stream({
      model: m,
      max_tokens: maxTokens,
      output_config: { effort: 'medium' },
      messages: [{ role: 'user', content: prompt }],
    });
    stream.on('text', delta => { written += delta; });
    const timer = setTimeout(() => stream.abort(), Math.max(1000, deadline - Date.now()));

    try {
      const message = await stream.finalMessage();
      if (message.stop_reason === 'refusal') {
        throw new Error('Claude avböjde att skriva klart boken');
      }
      const text = message.content
        .map(c => (c.type === 'text' ? c.text : ''))
        .join('');
      return finishContinuation(text || written, message.stop_reason === 'max_tokens', input.voice, diary);
    } catch (err) {
      if (err instanceof Anthropic.APIUserAbortError) {
        if (written.trim()) return finishContinuation(written, true, input.voice, diary);
        throw new Error('Det tog för lång tid att skriva resten av boken - försök igen');
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  });
}

function finishContinuation(text: string, truncated: boolean, voice?: AuthorVoiceRef, diary = false): { rawText: string; truncated: boolean } {
  let clean = text;
  // Avbruten text: släng det halvfärdiga sista stycket
  if (truncated) {
    const lastBreak = clean.lastIndexOf('\n');
    if (lastBreak > 0) clean = clean.slice(0, lastBreak);
  }
  return { rawText: normalizeManuscript(clean, voice, diary), truncated };
}

// ═══════════════════════════════════════════
//  Bokhandeln: kort baksidestext
// ═══════════════════════════════════════════

export interface BookBlurbInput {
  title: string;
  // Början av bokens text (redan avkortad av anroparen)
  text: string;
  mainCharacters: string[];
  targetAge?: string;
  bookFormat?: string;
}

const BLURB_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['description'],
  properties: {
    description: { type: 'string' },
  },
};

export async function generateBookBlurb(input: BookBlurbInput): Promise<string> {
  const client = getClient();
  const model = await resolveLatestModel(client);

  const prompt = `Skriv en baksidestext på SVENSKA till barnboken nedan, som den skulle stå på bokens baksida i en bokhandel.

KRAV:
- 2-3 korta meningar, högst 60 ord totalt.
- Väck nyfikenhet: presentera huvudpersonen/-personerna och utgångsläget.
- INGA spoilers - avslöja aldrig hur berättelsen slutar eller hur problemet löses.
- Varm, levande ton som passar ${input.targetAge ? `barn ${input.targetAge} år och deras vuxna` : 'barn och deras vuxna'}. Undvik klichéer som "en magisk resa" och "ett oförglömligt äventyr".
- Hitta inte på namn, platser eller händelser som inte finns i texten.
- Bara själva baksidestexten - ingen rubrik, inga citattecken runt texten.

TITEL: ${input.title}
${input.mainCharacters.length > 0 ? `HUVUDPERSONER: ${input.mainCharacters.join(', ')}\n` : ''}${input.bookFormat ? `FORMAT: ${input.bookFormat}\n` : ''}
BÖRJAN AV BOKEN:
"""
${input.text}
"""`;

  return withModelFallback(model, async (m) => {
    const message = await client.messages.create({
      model: m,
      max_tokens: 1024,
      output_config: {
        effort: 'low',
        format: { type: 'json_schema', schema: BLURB_SCHEMA },
      },
      messages: [{ role: 'user', content: prompt }],
    });

    if (message.stop_reason === 'refusal') {
      throw new Error('Claude avböjde att skriva en baksidestext');
    }
    const textBlock = message.content.find(c => c.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      throw new Error('Inget svar från Claude');
    }
    const parsed = JSON.parse(textBlock.text) as { description?: string };
    const description = sanitizeProse((parsed.description || '').trim());
    if (!description) throw new Error('Tom baksidestext');
    return description;
  });
}

// ═══════════════════════════════════════════
//  Slumpa karaktär: fyll i det som saknas
// ═══════════════════════════════════════════

export interface CharacterFields {
  name: string;
  age: string;
  role: 'main' | 'supporting' | 'villain';
  appearance: string;
  normalClothes: string;
  personality: string;
  heroName: string;
  heroCostume: string;
  power: string;
}

const CHARACTER_FIELDS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'age', 'role', 'appearance', 'normalClothes', 'personality', 'heroName', 'heroCostume', 'power'],
  properties: {
    name: { type: 'string' },
    age: { type: 'string' },
    role: { type: 'string', enum: ['main', 'supporting', 'villain'] },
    appearance: { type: 'string' },
    normalClothes: { type: 'string' },
    personality: { type: 'string' },
    heroName: { type: 'string' },
    heroCostume: { type: 'string' },
    power: { type: 'string' },
  },
};

const CHARACTER_SEEDS = {
  kinds: ['ett barn', 'ett barn', 'ett barn', 'en vuxen', 'en mor- eller farförälder', 'ett talande djur', 'ett fantasiväsen', 'en robot', 'en liten drake', 'ett spöke som är rädd för mörker'],
  traits: ['nyfiken', 'blyg men modig', 'busig', 'klok', 'tankspridd', 'envis', 'omtänksam', 'skrytig men snäll', 'uppfinningsrik', 'drömmande', 'orädd', 'lite grinig'],
  details: ['en speciell hatt', 'glasögon som alltid sitter snett', 'fräknar', 'ett plåster på knät', 'en ryggsäck full av saker', 'en halsduk i fel färg', 'ett husdjur i fickan', 'stora stövlar', 'en ficklampa', 'målarfärg på händerna'],
};

// Behåller allt författaren redan skrivit och fyller i resten. Utan några fält
// blir det en helt slumpad karaktär.
export async function suggestCharacter(partial: Partial<CharacterFields>, options: { hint?: string; hero?: boolean } = {}): Promise<CharacterFields> {
  const client = getClient();
  const model = await resolveLatestModel(client);
  const given = Object.entries(partial)
    .filter(([, v]) => typeof v === 'string' && v.trim())
    .map(([k, v]) => `- ${k}: ${v}`)
    .join('\n');

  const prompt = `Du hjälper en barnboksförfattare att hitta på en karaktär till en svensk barnbok. Skriv på svenska.

${given ? `REDAN IFYLLT AV FÖRFATTAREN:\n${given}\nBehåll namn, ålder och roll exakt. Korta eller vaga beskrivningar (t.ex. "en busig katt") ska du utveckla till konkreta beskrivningar med samma innebörd. Allt ska passa ihop med det ifyllda.` : 'Inget är ifyllt - hitta på en helt ny, minnesvärd karaktär.'}
${options.hint ? `\nFÖRFATTARENS IDÉ: ${options.hint}\n` : ''}
SLUMPADE IDÉFRÖN (använd bara om det passar det som redan är ifyllt):
- Typ: ${pickOne(CHARACTER_SEEDS.kinds)}
- Drag: ${pickOne(CHARACTER_SEEDS.traits)}
- Detalj: ${pickOne(CHARACTER_SEEDS.details)}
- Slumptal: ${Math.floor(Math.random() * 100000)}

Fyll i alla fält:
- name: ett svenskt eller passande namn
- age: t.ex. "7 år" (eller "okänd ålder" för väsen)
- role: main, supporting eller villain
- appearance: 1-2 konkreta meningar om hår, ögon, hy, kroppsbyggnad och ett särdrag (för djur: art, päls/fjäll, färger) - tillräckligt tydligt för att en illustratör ska rita samma figur varje gång
- normalClothes: vardagskläder med färger
- personality: 3-5 ord eller en kort mening
- heroName, heroCostume, power: ${options.hero ? 'fyll i en hjälteidentitet som passar' : 'lämna tomma strängar (om inte författaren själv fyllt i dem)'}

Undvik klyschor, håll det barnvänligt och konsekvent.`;

  return withModelFallback(model, async (m) => {
    const message = await client.messages.create({
      model: m,
      max_tokens: 1200,
      output_config: {
        effort: 'low',
        format: { type: 'json_schema', schema: CHARACTER_FIELDS_SCHEMA },
      },
      messages: [{ role: 'user', content: prompt }],
    });
    if (message.stop_reason === 'refusal') {
      throw new Error('Claude avböjde att föreslå en karaktär - prova en annan idé');
    }
    const textBlock = message.content.find(c => c.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      throw new Error('Inget svar från Claude');
    }
    const suggestion = JSON.parse(textBlock.text) as CharacterFields;
    for (const k of Object.keys(suggestion) as (keyof CharacterFields)[]) {
      if (typeof suggestion[k] === 'string') (suggestion as unknown as Record<string, string>)[k] = sanitizeProse(suggestion[k] as string);
    }
    // Namn, ålder, roll och längre beskrivningar som författaren skrivit vinner alltid;
    // korta beskrivningar får AI:ns utvecklade version
    const out = suggestion as unknown as Record<string, string>;
    for (const [k, v] of Object.entries(partial)) {
      if (typeof v !== 'string' || !v.trim()) continue;
      const exact = k === 'name' || k === 'age' || k === 'role' || v.trim().length >= 60;
      if (exact || !out[k]?.trim()) out[k] = v;
    }
    if (!options.hero) {
      for (const k of ['heroName', 'heroCostume', 'power'] as const) {
        if (!partial[k]?.trim()) out[k] = '';
      }
    }
    return suggestion;
  });
}
