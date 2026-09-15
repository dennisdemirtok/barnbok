import { GoogleGenAI } from '@google/genai';
import {
  Character,
  Spread,
  BookFormat,
  IllustrationShape,
  SpreadQualityCheck,
  QualityIssueCategory,
} from './types';
import { generatePageImage, resolveIllustrationShape, textInImage, PageImageOptions } from './gemini';
import { textSideForSpread } from './styles';

function getClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY saknas');
  return new GoogleGenAI({ apiKey });
}

// Granskaren: snabb Gemini-vision med JSON-schema. Första modellen som svarar används.
const REVIEW_MODELS = [process.env.GEMINI_REVIEW_MODEL, 'gemini-flash-latest', 'gemini-2.5-flash']
  .filter((m, i, arr): m is string => !!m && arr.indexOf(m) === i);

export interface CheckIssue {
  character: string;
  issue: string;
  severity: 'minor' | 'major';
  category?: QualityIssueCategory;
  correction?: string;
}

export interface CheckResult {
  passed: boolean;
  characters_found?: number;
  characters_expected?: number;
  issues: CheckIssue[];
  summary: string;
  score?: number;
  attempts?: number;
  reviewed?: boolean;
}

function detectMimeType(base64: string): string {
  if (base64.startsWith('/9j/')) return 'image/jpeg';
  if (base64.startsWith('UklGR')) return 'image/webp';
  return 'image/png';
}

function responseText(response: { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[] }): string {
  const parts = response.candidates?.[0]?.content?.parts || [];
  return parts.filter(p => p.text && !p.thought).map(p => p.text).join('');
}

// ═══════════════════════════════════════════
//  Äldre karaktärskontroll (utan scenkontext)
// ═══════════════════════════════════════════

// Analyze a generated illustration against the character descriptions.
// Comic-panel aware: the same character in several panels is normal storytelling.
export async function checkCharacterConsistency(
  imageBase64: string,
  characters: Character[]
): Promise<CheckResult> {
  const ai = getClient();

  const charDescriptions = characters.map(c =>
    `- ${c.name}: ${c.appearance}${c.heroCostume ? `. Kostym: ${c.heroCostume}` : ''}`
  ).join('\n');

  const prompt = `You are a quality control system for children's book illustrations. Analyze this illustration and check if the characters match their descriptions.

CHARACTERS THAT SHOULD APPEAR:
${charDescriptions}

ANALYZE THE IMAGE AND RESPOND IN THIS EXACT JSON FORMAT:
{
  "passed": true/false,
  "characters_found": number,
  "characters_expected": ${characters.length},
  "issues": [
    {
      "character": "character name",
      "issue": "brief description of mismatch",
      "severity": "minor" or "major"
    }
  ],
  "summary": "Brief overall assessment in Swedish"
}

CHECK FOR:
1. Is each character present in the image?
2. Do hair color, clothing, species (human/animal) and key features match the descriptions?
3. Is the same character drawn twice WITHIN A SINGLE PANEL/SCENE?
4. Are proportions and style consistent?
5. Is there any English text on the image (the book is Swedish)? English text is a "major" issue.
6. Are there any EMPTY speech bubbles or text boxes? Empty bubbles are a "major" issue.

IMPORTANT - COMIC PANEL RULES:
- If the illustration is a comic page with MULTIPLE PANELS, the same character appearing in several different panels is NORMAL comic storytelling and NOT an issue. Do not report it.
- A character shown both in normal clothes and in hero costume across different panels (a transformation) is NORMAL and NOT an issue.
- ONLY report duplication if the same character appears more than once inside ONE panel/scene.

SEVERITY GUIDE:
- "major": wrong species (e.g. animal drawn as human), wrong hair color, missing main character, duplicated character within one panel, English text, empty speech bubbles
- "minor": small detail differences (missing freckles, slightly different shade, missing small accessory)

Mark as "passed": true if there are no major issues (minor style variations are OK).
Mark as "passed": false only when there is at least one major issue.

RESPOND WITH ONLY THE JSON, no other text.`;

  const response = await ai.models.generateContent({
    model: REVIEW_MODELS[0],
    contents: [
      { text: prompt },
      { inlineData: { mimeType: detectMimeType(imageBase64), data: imageBase64 } },
    ],
    config: { responseMimeType: 'application/json' },
  });

  const jsonMatch = responseText(response).match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Kunde inte tolka svaret');
  }

  return JSON.parse(jsonMatch[0]) as CheckResult;
}

// ═══════════════════════════════════════════
//  Granskning av en sidbild mot scenens inställningar
// ═══════════════════════════════════════════

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Helordsmatchning (Unicode) - "Bo" ska inte träffa "book", men "Otis's" ska träffa "Otis"
function mentionsTerm(text: string, term: string): boolean {
  const t = term.trim();
  if (t.length < 2) return false;
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(t)}s?($|[^\\p{L}\\p{N}])`, 'iu').test(text);
}

function mentionsCharacter(text: string, char: Character): boolean {
  const terms = [char.name, ...char.name.split(/\s+/), char.heroName || ''];
  return terms.some(term => mentionsTerm(text, term));
}

// Vilka figurer ska synas? Namn i bildprompten = krävs. Namn bara i berättartexten = får synas.
export function expectedCharactersForSpread(spread: Spread, characters: Character[]): {
  required: Character[];
  optional: Character[];
} {
  const promptText = spread.imagePrompt || '';
  const storyText = (spread.textBlocks || []).map(tb => tb.text).join(' ');
  const required = characters.filter(c => mentionsCharacter(promptText, c));
  const optional = characters.filter(c => !required.includes(c) && mentionsCharacter(storyText, c));
  return { required, optional };
}

export interface ReviewContext {
  spread: Spread;
  characters: Character[];
  bookFormat?: BookFormat;
  shape?: IllustrationShape;
}

export interface ReviewIssue {
  category: QualityIssueCategory;
  character: string;
  severity: 'minor' | 'major';
  descriptionSv: string;
  correction: string;
}

export interface ImageReview {
  passed: boolean;
  score: number;
  issues: ReviewIssue[];
  problemsSv: string;
  charactersExpected: number;
  charactersFound: number;
  model: string;
}

const ISSUE_CATEGORIES: QualityIssueCategory[] = [
  'missing_character',
  'duplicate_character',
  'extra_figure',
  'wrong_appearance',
  'missing_element',
  'unwanted_text',
  'anatomy',
  'cropped_character',
  'layout',
  'other',
];

const CATEGORY_LABEL_SV: Record<QualityIssueCategory, string> = {
  missing_character: 'Saknad figur',
  duplicate_character: 'Dubbel figur',
  extra_figure: 'Extra figur',
  wrong_appearance: 'Utseende',
  missing_element: 'Scen',
  unwanted_text: 'Text i bilden',
  anatomy: 'Anatomi',
  cropped_character: 'Beskärning',
  layout: 'Layout',
  other: 'Övrigt',
};

const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    characters: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          should_be_visible: { type: 'boolean' },
          visible: { type: 'boolean' },
          max_count_in_one_scene: { type: 'integer', minimum: 0 },
          matches_reference: { type: 'boolean' },
          note: { type: 'string' },
        },
        required: ['name', 'should_be_visible', 'visible', 'max_count_in_one_scene', 'matches_reference', 'note'],
      },
    },
    issues: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          category: { type: 'string', enum: ISSUE_CATEGORIES },
          character: { type: 'string' },
          severity: { type: 'string', enum: ['minor', 'major'] },
          description_sv: { type: 'string' },
          correction: { type: 'string' },
        },
        required: ['category', 'character', 'severity', 'description_sv', 'correction'],
      },
    },
    score: { type: 'integer', minimum: 0, maximum: 100 },
    problems_sv: { type: 'string' },
  },
  required: ['characters', 'issues', 'score', 'problems_sv'],
};

interface RawReview {
  characters?: {
    name: string;
    should_be_visible: boolean;
    visible: boolean;
    max_count_in_one_scene: number;
    matches_reference: boolean;
    note: string;
  }[];
  issues?: { category: string; character: string; severity: string; description_sv: string; correction: string }[];
  score?: number;
  problems_sv?: string;
}

function describeCharacter(c: Character, hasReference: boolean): string {
  const details = [
    c.role === 'main' ? 'main character' : c.role,
    c.age ? `age ${c.age}` : '',
    c.appearance,
    c.normalClothes ? `normal clothes: ${c.normalClothes}` : '',
    c.heroCostume ? `hero costume: ${c.heroCostume}` : '',
  ].filter(Boolean).join('; ');
  return `- ${c.name}${c.heroName ? ` (hero name: ${c.heroName})` : ''} - ${details} [${hasReference ? 'reference sheet attached' : 'no reference sheet'}]`;
}

function buildReviewPrompt(ctx: ReviewContext, required: Character[], optional: Character[], withRef: Set<Character>): string {
  const { spread, bookFormat } = ctx;
  const isCover = spread.pages === 'omslag';
  const isComic = bookFormat === 'bildbok-text-pa-bild';
  const shape = isCover ? 'page' : resolveIllustrationShape(bookFormat, ctx.shape);
  const textAllowed = !isCover && textInImage(bookFormat);
  const scene = isComic ? 'panel' : 'scene';

  const formatLine = isCover
    ? 'FRONT COVER of the book (portrait 16x21 cm).'
    : isComic
    ? 'Comic / graphic-novel double-page spread with several panels, speech bubbles and narration boxes (landscape 32x21 cm).'
    : bookFormat === 'larobok'
    ? `Educational activity book illustration (${shape === 'spread' ? 'landscape double-page spread 32x21 cm' : 'portrait page 16x21 cm'}).`
    : shape === 'spread'
    ? 'Picture book DOUBLE-PAGE SPREAD illustration (landscape 32x21 cm); the story text is typeset on top of the image afterwards.'
    : 'Picture book SINGLE PAGE illustration (portrait 16x21 cm); the story text is on a separate page.';

  let textRules: string;
  if (isCover) {
    textRules = `This is the FRONT COVER: the book title (given in the brief) MUST appear as large, legible Swedish title lettering, spelled exactly as in the brief including å, ä, ö. Title missing -> major missing_element. Title misspelled or garbled -> major unwanted_text. ANY other text (taglines, author names, labels, stray letters, signs with words) -> major unwanted_text.`;
  } else if (textAllowed) {
    const expected = (spread.textBlocks || []).map((tb, i) => `  ${i + 1}. "${tb.text}"`).join('\n') || '  (no texts)';
    textRules = `Text belongs in the image in this format${isComic ? ' (in speech bubbles and narration boxes)' : bookFormat === 'larobok' ? ' (helpful labels and arrows are also allowed)' : ''}. Expected Swedish texts:
${expected}
Major unwanted_text: English text, empty speech bubbles or empty text boxes, invented text not in the list above${bookFormat === 'larobok' ? ' (apart from short helpful labels)' : ''}, headings, page numbers or position labels, garbled/unreadable pseudo-letters. An expected text that is missing completely -> major missing_element. Small spelling slips in otherwise correct text -> minor.`;
  } else {
    textRules = `NO text is allowed anywhere in this image: no letters, words, numbers, speech bubbles, captions, labels, signs or book covers with writing, watermarks or signatures. Any legible text or pseudo-letters -> major unwanted_text (correction e.g. "No text, letters or speech bubbles anywhere; keep the shop sign blank"). Tiny texture marks that do not read as letters are fine.`;
  }

  let layoutRules: string;
  if (isCover) {
    layoutRules = 'Portrait cover. The title area in the upper part must be uncluttered and the title must not cover a character\'s face (covered face -> major layout). Image must be portrait (landscape -> major layout).';
  } else if (spread.composition === 'spot') {
    layoutRules = 'Square SPOT illustration: the figures should stand on plain white paper with no scenery (a small soft color patch under the feet is fine). A full background or room -> major layout. Missing environment from the brief is NOT an issue for spots.';
  } else if (spread.composition === 'round') {
    layoutRules = 'Square image that will be cropped to a circle: the main motif must be centered, with nothing important in the corners (key detail in a corner -> major layout).';
  } else if (spread.composition === 'band') {
    layoutRules = 'Wide 16:9 band across a text page: the scene should read left to right; heads or key details cut off at the top or bottom edge -> major layout.';
  } else if (spread.composition === 'panels') {
    layoutRules = 'One image with 3-4 comic panels in a grid: fewer than 3 or more than 4 panels -> major layout. The same characters must look identical in all panels; each named character may appear once PER PANEL (appearing in several panels is expected, not a duplicate). Speech bubbles or sound words -> major unwanted_text.';
  } else if (shape === 'spread') {
    const side = textSideForSpread(spread.spreadNumber).toUpperCase();
    layoutRules = `Landscape double-page spread. The vertical center line is the book's fold (gutter): a character's face or a key story detail sitting on or right next to the center line -> major layout.${!isComic && bookFormat !== 'larobok'
      ? ` The ${side} THIRD of the image is reserved for typeset story text and must be a calm, low-detail area (sky, wall, floor, soft background): a main character or the main action placed in that third -> major layout; some moderate detail there -> minor layout.`
      : ''} Image must be landscape (portrait -> major layout).`;
  } else {
    layoutRules = 'Portrait single page; no gutter rules. The key moment must read clearly. Image must be portrait (landscape -> major layout).';
  }

  const requiredList = required.length > 0
    ? required.map(c => describeCharacter(c, withRef.has(c))).join('\n')
    : '(no named characters - check that no named book character is duplicated and that figures match the brief)';
  const optionalList = optional.map(c => describeCharacter(c, withRef.has(c))).join('\n');

  return `You are the art director doing final quality control of one illustration for a printed Swedish children's book. Compare the IMAGE TO REVIEW with the brief below and with the attached character reference sheets. Be precise and concrete, report only problems you can actually see, and do not invent problems. Stylization dictated by the art style (simplified hands, big heads, etc.) is NOT an error.

FORMAT: ${formatLine}

BRIEF - IMAGE DESCRIPTION THE ILLUSTRATOR RECEIVED:
"""
${spread.imagePrompt}
"""

CHARACTERS NAMED IN THE BRIEF (each should normally be visible exactly once${isComic ? ' - in comics at least in one panel, never twice inside the same panel' : ''}):
${requiredList}
${optionalList ? `
OTHER BOOK CHARACTERS MENTIONED IN THE STORY TEXT (optional - they may or may not appear; if they appear they must match their reference and appear only once per ${scene}):
${optionalList}
` : ''}
TEXT RULES:
${textRules}

LAYOUT RULES:
${layoutRules}

CHECKLIST:
1. CHARACTERS: add one entry to "characters" for EVERY character listed above (required and optional). should_be_visible = true for characters named in the brief unless the brief clearly says they are absent, off-screen or only thought of; false for optional ones. visible = whether you can see them. max_count_in_one_scene = how many times that character is drawn inside one ${scene} (0 if absent, 2+ means duplicated). matches_reference = hair, clothes, species, age/size match the reference/description. note = short English observation.
2. MISSING: a character that should be visible but is not -> major missing_character.
3. DUPLICATES: the same character drawn twice or more in one ${scene} -> major duplicate_character.${isComic ? ' The same character in DIFFERENT panels (also normal clothes vs hero costume in different panels) is normal comic storytelling - not an issue.' : ''} Unexplained twin/clone figures, or unnamed figures that look like a copy of a book character -> major extra_figure. Background extras that the brief calls for are fine.
4. APPEARANCE: compare with the reference sheets (they contain labels and color swatches - those are not part of the character). Wrong hair color/style, wrong outfit (neither the normal clothes nor, when fitting the scene, the hero costume), wrong species, clearly wrong age/size or skin tone -> major wrong_appearance. Small shade or accessory differences -> minor.
5. SCENE ELEMENTS: identify the few elements the brief makes essential to this moment (the action, important props, animals, places, time of day). An essential element missing or clearly wrong -> major missing_element. A missing background detail -> minor.
6. TEXT: apply TEXT RULES.
7. ANATOMY: clearly visible extra or missing fingers, extra/missing limbs, fused or merged bodies, two heads, badly broken faces -> major anatomy.
8. CROPPING: a main character's head or face cut off by the image edge, or a body cut off in a way that looks accidental -> major cropped_character. A face touching the very edge (print trim) -> minor.
9. LAYOUT: apply LAYOUT RULES.

SEVERITY: major = a reader or parent would notice it, or the story/brief is broken. minor = small acceptable deviation.

For each issue:
- character: the character's name, or "" if not about a specific character
- description_sv: short Swedish description for the author (max 15 words)
- correction: a concrete English instruction for the illustrator to fix it in a new version, naming characters and positions, e.g. "Draw Otis exactly once, standing on the right next to the red bike", "Allie must be clearly visible on the left side, holding the lantern", "Remove all letters from the shop sign and leave it blank", "Move Maja's face away from the center fold toward the right"

score: 0-100 overall quality against the brief (95-100 flawless, 80-94 only minor issues, below 70 when there is any major issue).
problems_sv: very short Swedish past-tense summary of the MAJOR problems only (max 12 words, no trailing period, e.g. "Allie saknades, Otis ritades två gånger"), or "" if there are none.`;
}

function normalizeReview(raw: RawReview, required: Character[], optional: Character[], isComic: boolean, model: string): ImageReview {
  const issues: ReviewIssue[] = (raw.issues || []).map(i => ({
    category: (ISSUE_CATEGORIES as string[]).includes(i.category) ? i.category as QualityIssueCategory : 'other',
    character: i.character || '',
    severity: i.severity === 'major' ? 'major' : 'minor',
    descriptionSv: i.description_sv || '',
    correction: i.correction || '',
  }));

  const sameName = (a: string, b: string) => {
    const x = a.trim().toLowerCase();
    const y = b.trim().toLowerCase();
    return !!x && !!y && (x.includes(y) || y.includes(x));
  };
  const hasIssue = (category: QualityIssueCategory, name: string) =>
    issues.some(i => i.category === category && i.severity === 'major' && sameName(i.character, name));

  const entries = raw.characters || [];
  const findEntry = (c: Character) => entries.find(e =>
    sameName(e.name || '', c.name) || (!!c.heroName && sameName(e.name || '', c.heroName)));

  const problemsExtra: string[] = [];
  let found = 0;
  for (const c of [...required, ...optional]) {
    const entry = findEntry(c);
    if (!entry) continue;
    if (entry.visible) found++;
    const isRequired = required.includes(c);
    // Säkerhetsnät: om modellen noterat felet i listan men glömt lägga det som issue
    if (isRequired && entry.should_be_visible && !entry.visible && !hasIssue('missing_character', c.name)) {
      issues.push({
        category: 'missing_character',
        character: c.name,
        severity: 'major',
        descriptionSv: `${c.name} saknas i bilden`,
        correction: `${c.name} must be clearly visible in the ${isComic ? 'panels where the brief places them' : 'scene'}, drawn exactly once and matching the reference sheet`,
      });
      problemsExtra.push(`${c.name} saknades`);
    }
    if (entry.max_count_in_one_scene > 1 && !hasIssue('duplicate_character', c.name)) {
      issues.push({
        category: 'duplicate_character',
        character: c.name,
        severity: 'major',
        descriptionSv: `${c.name} är ritad ${entry.max_count_in_one_scene} gånger`,
        correction: `Draw ${c.name} exactly ONCE${isComic ? ' per panel' : ' in the whole image'} - never duplicate this character`,
      });
      problemsExtra.push(`${c.name} ritades flera gånger`);
    }
  }

  const majors = issues.filter(i => i.severity === 'major');
  const passed = majors.length === 0;
  const rawScore = typeof raw.score === 'number' ? raw.score : passed ? 80 : 50;
  let score = Math.round(Math.min(100, Math.max(0, rawScore)));
  if (!passed) score = Math.min(score, 69);

  let problemsSv = '';
  if (!passed) {
    problemsSv = (raw.problems_sv || '').trim().replace(/\.$/, '');
    // Lägg till säkerhetsnätets fynd som modellen inte själv sammanfattade
    const missingFromSummary = problemsExtra.filter(p => !problemsSv.toLowerCase().includes(p.split(' ')[0].toLowerCase()));
    problemsSv = [problemsSv, ...missingFromSummary].filter(Boolean).join(', ');
    if (!problemsSv) problemsSv = majors.slice(0, 2).map(i => i.descriptionSv).filter(Boolean).join(', ');
  }

  return {
    passed,
    score,
    issues,
    problemsSv,
    charactersExpected: required.length,
    charactersFound: found,
    model,
  };
}

// Granska en genererad bild mot scenens prompt, figurer (med referensbilder), format och bildform
export async function reviewPageImage(
  imageBase64: string,
  ctx: ReviewContext,
  opts: { timeoutMs?: number } = {}
): Promise<ImageReview> {
  const ai = getClient();
  const { required, optional } = expectedCharactersForSpread(ctx.spread, ctx.characters);
  const isComic = ctx.bookFormat === 'bildbok-text-pa-bild';

  // Referensbilder för figurerna i scenen (max 6 för att hålla nere anropet)
  const refChars = [...required, ...optional].filter(c => !!c.referenceImage).slice(0, 6);
  const withRef = new Set(refChars);

  const contents: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];
  for (const c of refChars) {
    contents.push({ text: `Reference sheet for "${c.name}"${c.heroName ? ` (${c.heroName})` : ''}:` });
    contents.push({ inlineData: { mimeType: detectMimeType(c.referenceImage!), data: c.referenceImage! } });
  }
  contents.push({ text: 'IMAGE TO REVIEW:' });
  contents.push({ inlineData: { mimeType: detectMimeType(imageBase64), data: imageBase64 } });
  contents.push({ text: buildReviewPrompt(ctx, required, optional, withRef) });

  let lastError: unknown;
  const startedAt = Date.now();
  for (const model of REVIEW_MODELS) {
    const remaining = opts.timeoutMs ? opts.timeoutMs - (Date.now() - startedAt) : undefined;
    if (remaining !== undefined && remaining < 8000) break;
    try {
      const response = await ai.models.generateContent({
        model,
        contents,
        config: {
          responseMimeType: 'application/json',
          responseJsonSchema: REVIEW_SCHEMA,
          temperature: 0.2,
          ...(remaining ? { httpOptions: { timeout: remaining } } : {}),
        },
      });
      const text = responseText(response);
      if (!text) throw new Error('Tomt svar från granskaren');
      const raw = JSON.parse(text) as RawReview;
      return normalizeReview(raw, required, optional, isComic, model);
    } catch (err) {
      lastError = err;
      console.warn(`[Granskning] ${model} misslyckades:`, err instanceof Error ? err.message : err);
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Granskningen misslyckades');
}

export function reviewToCheckResult(review: ImageReview, extra: { summary?: string; attempts?: number } = {}): CheckResult {
  return {
    passed: review.passed,
    score: review.score,
    characters_expected: review.charactersExpected,
    characters_found: review.charactersFound,
    issues: review.issues.map(i => ({
      character: i.character || CATEGORY_LABEL_SV[i.category],
      issue: i.descriptionSv || i.correction,
      severity: i.severity,
      category: i.category,
      correction: i.correction,
    })),
    summary: extra.summary ?? (review.passed ? 'Godkänd' : `Avvikelser: ${review.problemsSv}`),
    attempts: extra.attempts,
    reviewed: true,
  };
}

// ═══════════════════════════════════════════
//  Generera → granska → rätta (max 3 försök)
// ═══════════════════════════════════════════

export interface QualityGenerationResult {
  image: string;
  check?: CheckResult;
  qualityCheck: SpreadQualityCheck;
  attempts: number;
  autoFixed: boolean;
}

export interface QualityLoopOptions {
  maxAttempts?: number;
  // Absolut tidpunkt (ms) då loopen ska sluta starta nya försök
  deadline?: number;
}

export const MAX_QUALITY_ATTEMPTS = 3;
// Route maxDuration är 300 s - lämna marginal för svar och serialisering
export const DEFAULT_QUALITY_BUDGET_MS = 250_000;
const MIN_GENERATION_ESTIMATE_MS = 45_000;
const MIN_REVIEW_ESTIMATE_MS = 20_000;
const SAFETY_MARGIN_MS = 10_000;
const MAX_REVIEW_TIMEOUT_MS = 90_000;

interface Attempt {
  n: number;
  image: string;
  review: ImageReview | null;
}

function buildCorrections(attempts: Attempt[]): string[] {
  const latest = attempts[attempts.length - 1].review;
  const current = (latest?.issues || []).filter(i => i.severity === 'major' && i.correction).map(i => i.correction);
  const earlier = attempts.slice(0, -1)
    .flatMap(a => (a.review?.issues || []).filter(i => i.severity === 'major' && i.correction).map(i => i.correction))
    .filter(c => !current.includes(c));
  const corrections = [
    ...current.slice(0, 8),
    ...Array.from(new Set(earlier)).slice(0, 4).map(c => `(also keep fixed from an earlier attempt) ${c}`),
  ];
  const cats = new Set((latest?.issues || []).filter(i => i.severity === 'major').map(i => i.category));
  if (cats.has('duplicate_character') || cats.has('extra_figure')) {
    corrections.push('Count the characters before finishing: every named character appears exactly once - no twins, clones or repeated figures');
  }
  return corrections;
}

function rank(a: Attempt): number {
  if (!a.review) return -1;
  return (a.review.passed ? 1000 : 0) + a.review.score;
}

export async function generatePageWithQualityCheck(
  spread: Spread,
  characters: Character[],
  styleGuide: string,
  bookFormat?: BookFormat,
  options: PageImageOptions = {},
  loop: QualityLoopOptions = {}
): Promise<QualityGenerationResult> {
  const startedAt = Date.now();
  const deadline = loop.deadline ?? startedAt + DEFAULT_QUALITY_BUDGET_MS;
  const maxAttempts = Math.min(MAX_QUALITY_ATTEMPTS, Math.max(1, loop.maxAttempts ?? MAX_QUALITY_ATTEMPTS));
  const ctx: ReviewContext = { spread, characters, bookFormat, shape: options.shape };
  const label = `Uppslag ${spread.pages}`;

  const attempts: Attempt[] = [];
  let generationEstimate = MIN_GENERATION_ESTIMATE_MS;
  let reviewEstimate = MIN_REVIEW_ESTIMATE_MS;
  let stoppedForTime = false;
  let correctionFailed = false;

  for (let n = 1; n <= maxAttempts; n++) {
    let image: string;
    const genStart = Date.now();

    if (n === 1) {
      // Första bilden: fel här ska fortfarande nå anroparen - det finns ingen bild att leverera
      image = await generatePageImage(spread, characters, styleGuide, bookFormat, { ...options, corrections: undefined });
    } else {
      const remaining = deadline - Date.now();
      if (remaining < generationEstimate + reviewEstimate + SAFETY_MARGIN_MS) {
        stoppedForTime = true;
        console.log(`[Kvalitetsloop] ${label}: ingen tid för försök ${n} (${Math.round(remaining / 1000)} s kvar)`);
        break;
      }
      const corrections = buildCorrections(attempts);
      console.log(`[Kvalitetsloop] ${label}: försök ${n} med ${corrections.length} rättelser`);
      try {
        image = await generatePageImage(spread, characters, styleGuide, bookFormat, {
          ...options,
          corrections,
          maxRetries: remaining > 2 * generationEstimate + reviewEstimate + SAFETY_MARGIN_MS ? 1 : 0,
          timeoutMs: Math.max(30_000, remaining - reviewEstimate - SAFETY_MARGIN_MS),
        });
      } catch (err) {
        // En misslyckad rättelse fäller aldrig uppslaget - bästa bilden hittills behålls
        correctionFailed = true;
        console.warn(`[Kvalitetsloop] ${label}: försök ${n} kunde inte genereras:`, err instanceof Error ? err.message : err);
        break;
      }
    }
    generationEstimate = Math.max(generationEstimate, Date.now() - genStart);

    // Granskningen får dra lite över deadline (maxDuration har marginal) men aldrig hänga
    const reviewWindow = Math.min(MAX_REVIEW_TIMEOUT_MS, deadline + SAFETY_MARGIN_MS * 2 - Date.now());
    let review: ImageReview | null = null;
    if (reviewWindow >= 10_000) {
      const reviewStart = Date.now();
      try {
        review = await reviewPageImage(image, ctx, { timeoutMs: reviewWindow });
        reviewEstimate = Math.max(reviewEstimate, Date.now() - reviewStart);
        const majors = review.issues.filter(i => i.severity === 'major').length;
        console.log(`[Kvalitetsloop] ${label}: försök ${n} poäng ${review.score}, ${majors} allvarliga fel${review.problemsSv ? ` (${review.problemsSv})` : ''}`);
      } catch (err) {
        console.warn(`[Kvalitetsloop] ${label}: granskningen kunde inte köras:`, err instanceof Error ? err.message : err);
      }
    }

    attempts.push({ n, image, review });
    // Godkänd - eller granskningen gick inte att köra (då regenererar vi inte i blindo)
    if (!review || review.passed) break;
  }

  // Välj bästa bilden: (godkänd, poäng). En ogranskad sista bild är gjord med rättelser och vinner.
  const last = attempts[attempts.length - 1];
  const best = !last.review
    ? last
    : attempts.reduce((a, b) => (rank(b) > rank(a) ? b : a));
  const totalAttempts = attempts.length;
  const first = attempts[0];

  let summary: string;
  if (!best.review) {
    summary = totalAttempts === 1
      ? 'Kvalitetsgranskningen kunde inte köras – granska bilden manuellt'
      : `Försök ${totalAttempts} kunde inte granskas – granska manuellt (första bilden: ${first.review?.problemsSv || 'avvikelser'})`;
  } else if (best.review.passed) {
    const minors = best.review.issues.filter(i => i.severity === 'minor').length;
    summary = best.n === 1
      ? `Godkänd vid första granskningen${minors ? ` (${minors} mindre avvikelse${minors > 1 ? 'r' : ''})` : ''}`
      : `Godkänd efter ${best.n} försök – första bilden: ${first.review?.problemsSv || 'avvikelser'}`;
  } else {
    summary = `Ej godkänd efter ${totalAttempts} försök – ${best.review.problemsSv || 'avvikelser kvar'}. Granska manuellt${stoppedForTime ? ' (tidsgränsen nåddes)' : correctionFailed ? ' (rättelsen kunde inte genereras)' : ''}`;
  }

  const autoFixed = best.n > 1;
  const check: CheckResult = best.review
    ? reviewToCheckResult(best.review, { summary, attempts: totalAttempts })
    : { passed: false, issues: [], summary, attempts: totalAttempts, reviewed: false };

  const qualityCheck: SpreadQualityCheck = {
    passed: check.passed,
    summary,
    autoFixed,
    issues: check.issues.map(i => ({ character: i.character, issue: i.issue, severity: i.severity, category: i.category })),
    attempts: totalAttempts,
    score: best.review?.score,
    reviewed: !!best.review,
  };

  console.log(`[Kvalitetsloop] ${label}: ${summary} (${Math.round((Date.now() - startedAt) / 1000)} s)`);

  return { image: best.image, check, qualityCheck, attempts: totalAttempts, autoFixed };
}
