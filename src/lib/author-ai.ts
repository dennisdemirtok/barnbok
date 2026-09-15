// "Slutför din bok": AI-stöd för författare som skrivit början själva.
// Analyserar författarens språk, planerar tidslinjen, skriver kapitel och
// skriver om markerade stycken - alltid med författarens röst.
import Anthropic from '@anthropic-ai/sdk';
import { restoreDialogueMarkers, DEFAULT_MARKER } from './dialogue';
import {
  getClient,
  resolveLatestModel,
  withModelFallback,
  countWords,
  authorVoiceBlock,
  lineDialogueMarker,
  AuthorVoiceRef,
} from './claude';
import { PROSE_QUALITY_RULES, sanitizeProse } from './writing';
import type {
  ChapterContext,
  FinishSettings,
  ProjectContext,
  RewriteRequest,
  TimelineResponse,
  VoiceProfile,
  VoiceResponse,
} from './author-types';

// Fel i indata - routen svarar 400 i stället för 500
export class AuthorInputError extends Error {}

type Effort = 'low' | 'medium' | 'high';

// ═══════════════════════════════════════════
//  Gemensamt: validering och hjälpfunktioner
// ═══════════════════════════════════════════

const LIMITS = {
  title: 300,
  premise: 8000,
  ending: 4000,
  chapterTitle: 200,
  notes: 4000,
  chapters: 80,
  chapterText: 200_000, // tecken per kapitel
  totalText: 1_500_000, // tecken i hela boken (~250 000 ord)
  voiceText: 400_000,
  sampleChars: 20_000,
  samples: 8,
};

const TENSES: VoiceProfile['tense'][] = ['presens', 'preteritum', 'blandat'];
const PROFILE_TEXT_FIELDS = [
  'summary', 'perspective', 'sentenceRhythm', 'dialogue', 'vocabulary', 'emotions', 'details', 'humor', 'pacing',
] as const;

function str(value: unknown, max: number): string {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

// Städar ett sparat författarspråk från klienten. Returnerar undefined om det saknas.
export function normalizeVoice(raw: unknown): AuthorVoiceRef | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as { profile?: Record<string, unknown>; samples?: unknown };
  if (!r.profile || typeof r.profile !== 'object') return undefined;
  const p = r.profile;
  const profile: VoiceProfile = {
    summary: '', perspective: '', sentenceRhythm: '', dialogue: '', vocabulary: '',
    emotions: '', details: '', humor: '', pacing: '',
    tense: TENSES.includes(p.tense as VoiceProfile['tense']) ? p.tense as VoiceProfile['tense'] : 'blandat',
    dialogueMarker: str(p.dialogueMarker, 5),
    signatureMoves: Array.isArray(p.signatureMoves) ? p.signatureMoves.map(s => str(s, 600)).filter(Boolean).slice(0, 12) : [],
    avoid: Array.isArray(p.avoid) ? p.avoid.map(s => str(s, 600)).filter(Boolean).slice(0, 12) : [],
  };
  for (const k of PROFILE_TEXT_FIELDS) profile[k] = str(p[k], 2000);
  const samples = Array.isArray(r.samples)
    ? r.samples.map(s => str(s, LIMITS.sampleChars)).filter(s => s.trim()).slice(0, LIMITS.samples)
    : [];
  if (!profile.summary.trim() && !profile.dialogue.trim() && samples.length === 0) return undefined;
  return { profile, samples };
}

function normalizeSettings(raw: unknown): FinishSettings {
  const s = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const freedom = s.freedom === 'follow' || s.freedom === 'free' ? s.freedom : 'balanced';
  return {
    targetAge: str(s.targetAge, 60).trim() || '9-12 år',
    totalChapters: clampInt(s.totalChapters, 1, 60, 12),
    wordsPerChapter: clampInt(s.wordsPerChapter, 200, 8000, 1500),
    genre: str(s.genre, 200).trim() || undefined,
    freedom,
  };
}

// Validerar projektet som klienten skickar. Kastar AuthorInputError vid fel.
export function normalizeProject(raw: unknown, options: { requireChapters?: boolean } = {}): ProjectContext {
  if (!raw || typeof raw !== 'object') throw new AuthorInputError('Projektet saknas');
  const r = raw as Record<string, unknown>;
  const chaptersRaw = Array.isArray(r.chapters) ? r.chapters : [];
  if (chaptersRaw.length > LIMITS.chapters) {
    throw new AuthorInputError(`Boken har för många kapitel (högst ${LIMITS.chapters})`);
  }
  let totalChars = 0;
  const chapters: ChapterContext[] = chaptersRaw.map((c, i) => {
    const ch = (c && typeof c === 'object' ? c : {}) as Record<string, unknown>;
    const text = typeof ch.text === 'string' ? ch.text.replace(/\r\n?/g, '\n') : '';
    if (text.length > LIMITS.chapterText) {
      throw new AuthorInputError(`Kapitlet "${str(ch.title, 80) || i + 1}" är för långt`);
    }
    totalChars += text.length;
    return {
      id: str(ch.id, 100) || `kapitel-${i + 1}`,
      title: str(ch.title, LIMITS.chapterTitle).trim(),
      notes: str(ch.notes, LIMITS.notes).trim(),
      text: text.trim(),
      source: ch.source === 'ai' ? 'ai' : 'author',
    };
  });
  if (totalChars > LIMITS.totalText) throw new AuthorInputError('Boken är för lång för att bearbetas');
  if (options.requireChapters && chapters.length === 0) throw new AuthorInputError('Boken har inga kapitel');

  return {
    title: str(r.title, LIMITS.title).trim() || 'Namnlös bok',
    premise: str(r.premise, LIMITS.premise).trim(),
    ending: str(r.ending, LIMITS.ending).trim() || undefined,
    voice: normalizeVoice(r.voice),
    settings: normalizeSettings(r.settings),
    chapters,
  };
}

function splitParagraphs(text: string): string[] {
  return text.replace(/\r\n?/g, '\n').split('\n').map(p => p.trim()).filter(Boolean);
}

const HEADING_RE = /^(kapitel\s+\d+|prolog|epilog|förord|efterord)\b/i;

function isHeading(paragraph: string): boolean {
  return HEADING_RE.test(paragraph) && paragraph.length < 120 && !/[.!?]$/.test(paragraph);
}

// Vilken markering inleder repliker i texten? Räknas på servern så att den blir exakt.
function detectDialogueMarker(paragraphs: string[]): string | undefined {
  const counts = new Map<string, number>();
  for (const p of paragraphs) {
    const m = p.match(/^(\* |– |— |- |» |” |" )/);
    if (m) counts.set(m[1], (counts.get(m[1]) ?? 0) + 1);
  }
  const [best] = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  if (!best || best[1] < 2) return undefined;
  // Långa tankstreck används aldrig - talstreck är samma sak i tryck
  return best[0] === '— ' ? '– ' : best[0];
}

function bookInfo(project: Pick<ProjectContext, 'title' | 'premise' | 'ending' | 'settings'>): string {
  const s = project.settings;
  return `TITEL: "${project.title}"
MÅLÅLDER: ${s.targetAge}${s.genre ? `\nGENRE: ${s.genre}` : ''}
VAD BOKEN HANDLAR OM: ${project.premise || '(inte angivet - utgå från texten)'}${project.ending ? `\nSLUTET FÖRFATTAREN TÄNKT SIG: ${project.ending}` : ''}`;
}

// Regler för prosan: författarens röst går före de allmänna reglerna
function proseRulesForAuthor(hasVoice: boolean): string {
  return `ALLMÄNNA SKRIVREGLER (${hasVoice
    ? 'gäller bara där författarspråket inte säger något annat - författarens röst vinner alltid'
    : 'anpassa dem till hur författaren skriver i texten - författarens röst vinner alltid'}. Långa tankstreck (—) är dock alltid förbjudna.)

${PROSE_QUALITY_RULES}`;
}

function voiceOrFallback(voice?: AuthorVoiceRef): string {
  if (voice) return authorVoiceBlock(voice);
  return `
FÖRFATTARSPRÅK: Ingen sparad analys finns. Läs författarens egna kapitel noga och härma exakt hur hen skriver: tempus, perspektiv, meningsrytm, hur repliker markeras och taggas, ordval och hur känslor visas.
`;
}

// Tar bort markdown, rubriker och fel replikstreck. Ett stycke per rad.
function normalizeProse(text: string, voice?: AuthorVoiceRef, dropTitle?: string): string {
  const marker = lineDialogueMarker(voice?.profile.dialogueMarker) ?? DEFAULT_MARKER;
  let lines = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter(line => !/^\s*```/.test(line))
    .map(line => {
      let l = line.replace(/^\s*#{1,6}\s*/, '').replace(/\*\*|__/g, '').trim();
      // Andra replikstreck byts mot författarens markering
      if (marker) l = l.replace(/^[-—―–*]\s+/, marker);
      return sanitizeProse(l);
    })
    .filter(Boolean);
  // Kapitelrubriken lagras separat - ta bort den om modellen ändå skrev den
  if (dropTitle !== undefined && lines.length > 0) {
    const first = lines[0].replace(/[.:]$/, '').trim().toLowerCase();
    if ((dropTitle && first === dropTitle.trim().toLowerCase()) || isHeading(lines[0])) lines = lines.slice(1);
  }
  // Repliker som AI:n skrev utan markering får den
  return restoreDialogueMarkers(lines.join('\n'), marker).text.trim();
}

function textOf(message: Anthropic.Message): string {
  return message.content.map(c => (c.type === 'text' ? c.text : '')).join('');
}

// Strömmar ett JSON-svar (structured outputs) och avbryter vid deadline
async function streamJson<T>(opts: {
  system?: string;
  content: string | Anthropic.TextBlockParam[];
  schema: Record<string, unknown>;
  effort: Effort;
  maxTokens: number;
  deadline: number;
  what: string; // "analysera texten" osv. för felmeddelanden
}): Promise<T> {
  const client = getClient();
  const model = await resolveLatestModel(client);
  return withModelFallback(model, async (m) => {
    const stream = client.messages.stream({
      model: m,
      max_tokens: opts.maxTokens,
      thinking: { type: 'adaptive' },
      output_config: { effort: opts.effort, format: { type: 'json_schema', schema: opts.schema } },
      ...(opts.system ? { system: opts.system } : {}),
      messages: [{ role: 'user', content: opts.content }],
    });
    const timer = setTimeout(() => stream.abort(), Math.max(1000, opts.deadline - Date.now()));
    try {
      const message = await stream.finalMessage();
      if (message.stop_reason === 'refusal') throw new Error(`Claude avböjde att ${opts.what}`);
      if (message.stop_reason === 'max_tokens') throw new Error(`Svaret blev för långt när Claude skulle ${opts.what} - försök igen`);
      const text = textOf(message);
      if (!text.trim()) throw new Error('Inget svar från Claude');
      return JSON.parse(text) as T;
    } catch (err) {
      if (err instanceof Anthropic.APIUserAbortError) {
        throw new Error(`Det tog för lång tid att ${opts.what} - försök igen`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  });
}

// ═══════════════════════════════════════════
//  1. Författarspråk: analysera hur författaren skriver
// ═══════════════════════════════════════════

const VOICE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'profile', 'samples'],
  properties: {
    name: { type: 'string' },
    profile: {
      type: 'object',
      additionalProperties: false,
      required: [
        'summary', 'tense', 'perspective', 'sentenceRhythm', 'dialogue', 'dialogueMarker', 'vocabulary',
        'emotions', 'details', 'humor', 'pacing', 'signatureMoves', 'avoid',
      ],
      properties: {
        summary: { type: 'string' },
        tense: { type: 'string', enum: TENSES },
        perspective: { type: 'string' },
        sentenceRhythm: { type: 'string' },
        dialogue: { type: 'string' },
        dialogueMarker: { type: 'string' },
        vocabulary: { type: 'string' },
        emotions: { type: 'string' },
        details: { type: 'string' },
        humor: { type: 'string' },
        pacing: { type: 'string' },
        signatureMoves: { type: 'array', items: { type: 'string' } },
        avoid: { type: 'array', items: { type: 'string' } },
      },
    },
    samples: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['startParagraph', 'endParagraph'],
        properties: {
          startParagraph: { type: 'integer' },
          endParagraph: { type: 'integer' },
        },
      },
    },
  },
};

const SAMPLE_WORD_BUDGET = 1800;

export const VOICE_MIN_WORDS = 150;
export const VOICE_MAX_CHARS = LIMITS.voiceText;

export async function analyzeVoice(text: string, name: string | undefined, deadline: number): Promise<VoiceResponse['voice']> {
  const words = countWords(text);
  if (words < VOICE_MIN_WORDS) {
    throw new AuthorInputError(`Klistra in mer text så att författarspråket kan analyseras (minst ${VOICE_MIN_WORDS} ord)`);
  }
  let paragraphs = splitParagraphs(text);
  let detectedMarker = detectDialogueMarker(paragraphs);
  // Repliker utan talstreck (punktlistor som tappats vid inklistring): lägg tillbaka
  // dem innan analysen, så att AI:n lär sig att repliker står i egna stycken med streck
  if (!detectedMarker) {
    const restored = restoreDialogueMarkers(paragraphs.join('\n'), DEFAULT_MARKER);
    if (restored.added >= 2) {
      paragraphs = splitParagraphs(restored.text);
      detectedMarker = DEFAULT_MARKER;
    }
  }
  const numbered = paragraphs.map((p, i) => `[${i + 1}] ${p}`).join('\n');

  const prompt = `Du är en erfaren svensk förlagsredaktör och stilanalytiker. En författare har skrivit början av sin bok själv. Resten ska skrivas så att ingen läsare märker var författaren slutade. Din uppgift är att beskriva EXAKT hur just den här författaren skriver, så noggrant att en annan skribent kan härma rösten utan att se originalet.

Beskriv hur texten faktiskt ÄR, inte hur den borde vara. Värdera inte och rätta inte. Ovanliga val (stor bokstav i anföringen efter en replik, talspråk, utdragna ord, upprepningar, blandade tempus) är en del av rösten och ska beskrivas som regler att följa.

FÖRFATTARENS TEXT (numrerade stycken, ett stycke per rad i originalet):
"""
${numbered}
"""

Skriv alla beskrivningar på svenska, konkret och med korta ordagranna citat ur texten (högst 12 ord per citat) som belägg. Inga långa tankstreck (—).

profile:
- summary: 2-3 meningar om hur författaren låter som helhet.
- tense: presens, preteritum eller blandat (berättartexten, inte replikerna).
- perspective: vem som berättar, hur nära vi är, vems tankar vi får och hur tankarna skrivs (t.ex. som frågor i berättartexten).
- sentenceRhythm: ungefärlig meningslängd, hur mycket den varierar, hur stycken byggs och hur långa de är. Ge konkreta iakttagelser med citat.
- dialogue: EXAKT hur repliker skrivs: vad som inleder repliken, om repliken står i eget stycke, var anföringen står, om anföringsverbet börjar med stor eller liten bokstav efter ! och ? respektive efter komma, vilka anföringsverb som används, dubbla skiljetecken (?!, ??), utdragna ord, om handling och replik blandas i samma stycke. Citera två repliker ordagrant.
- dialogueMarker: den exakta teckenföljden som står först i ett replikstycke, inklusive mellanslag (t.ex. "* ", "– ", "- "). Tom sträng om repliker inte inleds med en markering först i stycket (t.ex. citattecken inne i texten).
- vocabulary: ordnivå, vardagsord och talspråk, moderna ord och varumärken, smeknamn och tilltal, regionala eller ålderstypiska uttryck.
- emotions: hur känslor visas (kropp, handling, tankar, uttalade känsloord) med exempel.
- details: vilka slags detaljer författaren väljer och hur många.
- humor: hur och hur ofta humor förekommer. Säg tydligt om den saknas.
- pacing: tempo, scen kontra sammanfattning, tidshopp, hur kapitel och scener börjar och slutar, hur spänning byggs.
- signatureMoves: 3-8 konkreta, typiska grepp, vart och ett med ett kort exempel ur texten.
- avoid: 3-8 saker författaren inte gör och som en härmare lätt skulle lägga till (t.ex. långa liknelser, poetiska bilder, semikolon, berättarkommentarer).

name: ${name ? `använd "${name}"` : 'ett kort namn på språket i formen "Mitt författarspråk – [genre/stämning] [målålder]", t.ex. "Mitt författarspråk – spänning 9–12 år". Gissa genre och ålder ur texten.'}

samples: välj 4-6 utdrag som tillsammans bäst visar rösten. Varje utdrag är en följd av 2-8 stycken i rad, angivna med startParagraph och endParagraph (styckenummer, inklusive). Tillsammans högst ca 1500 ord. Minst två utdrag ska innehålla repliker, minst ett ska visa berättartext med känslor eller detaljer. Sprid utdragen över texten, låt dem inte överlappa och ta inte med kapitelrubriker.`;

  const result = await streamJson<{ name: string; profile: VoiceProfile; samples: { startParagraph: number; endParagraph: number }[] }>({
    content: prompt,
    schema: VOICE_SCHEMA,
    effort: 'high',
    maxTokens: 24000,
    deadline,
    what: 'analysera författarspråket',
  });

  // Städa profilen; replikmarkeringen räknas fram ur texten när den går att se
  const profile = normalizeVoice({ profile: result.profile, samples: [] })?.profile;
  if (!profile) throw new Error('Analysen av författarspråket blev tom - försök igen');
  for (const k of PROFILE_TEXT_FIELDS) profile[k] = sanitizeProse(profile[k]);
  profile.signatureMoves = profile.signatureMoves.map(sanitizeProse).slice(0, 8);
  profile.avoid = profile.avoid.map(sanitizeProse).slice(0, 8);
  if (detectedMarker) profile.dialogueMarker = detectedMarker;
  else if (profile.dialogueMarker.trim() === '—') profile.dialogueMarker = '– ';

  return {
    name: name || sanitizeProse(result.name.trim()).slice(0, 120) || 'Mitt författarspråk',
    profile,
    samples: pickSamples(paragraphs, result.samples),
  };
}

// Plockar utdragen ordagrant ur texten utifrån styckenummer
function pickSamples(paragraphs: string[], ranges: { startParagraph: number; endParagraph: number }[]): string[] {
  const used = new Set<number>();
  const picked: string[] = [];
  let budget = SAMPLE_WORD_BUDGET;

  const take = (start: number, end: number) => {
    const parts: string[] = [];
    for (let i = start; i <= end && budget > 0; i++) {
      if (used.has(i) || isHeading(paragraphs[i])) {
        if (parts.length > 0) break; // utdragen ska vara sammanhängande
        continue;
      }
      const w = countWords(paragraphs[i]);
      if (parts.length > 0 && w > budget) break;
      parts.push(paragraphs[i]);
      used.add(i);
      budget -= w;
    }
    if (parts.length > 0) picked.push(parts.join('\n'));
  };

  const valid = (Array.isArray(ranges) ? ranges : [])
    .map(r => {
      const a = clampInt(r.startParagraph, 1, paragraphs.length, 1) - 1;
      const b = clampInt(r.endParagraph, 1, paragraphs.length, a + 1) - 1;
      return [Math.min(a, b), Math.min(Math.max(a, b), Math.min(a, b) + 11)] as const;
    })
    .slice(0, 6);
  for (const [a, b] of valid) {
    if (budget <= 0) break;
    take(a, b);
  }

  // Reserv: jämnt spridda bitar om modellens val inte gav något
  if (picked.length < 3) {
    const step = Math.max(1, Math.floor(paragraphs.length / 5));
    for (let i = 0; i < paragraphs.length && picked.length < 5 && budget > 0; i += step) {
      take(i, Math.min(paragraphs.length - 1, i + 3));
    }
  }
  return picked;
}

// ═══════════════════════════════════════════
//  2. Tidslinje: planera kapitlen som återstår
// ═══════════════════════════════════════════

const TIMELINE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['chapters'],
  properties: {
    chapters: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'title', 'notes'],
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          notes: { type: 'string' },
        },
      },
    },
  },
};

// Över så här många ord i skrivna kapitel visas bara början och slutet av varje kapitel
const TIMELINE_FULL_TEXT_WORDS = 30_000;
const MAX_TOTAL_CHAPTERS = 60;

function headWords(text: string, n: number): string {
  const w = text.split(/\s+/).filter(Boolean);
  return w.length <= n ? text : `${w.slice(0, n).join(' ')} …`;
}

function tailWords(text: string, n: number): string {
  const w = text.split(/\s+/).filter(Boolean);
  return w.length <= n ? text : `… ${w.slice(-n).join(' ')}`;
}

// Rubriker som bara är ett nummer får en riktig titel av AI:n; annars behålls författarens
function isPlaceholderTitle(title: string): boolean {
  return /^((kapitel|kap\.?)\s*\d*|prolog|epilog|nytt kapitel)?\s*[-–:]?\s*$/i.test(title.trim());
}

export async function planTimeline(
  project: ProjectContext,
  mode: 'fill' | 'rework',
  instruction: string | undefined,
  deadline: number,
): Promise<TimelineResponse> {
  const { chapters, settings } = project;
  const writtenWords = chapters.reduce((sum, c) => sum + countWords(c.text), 0);
  const showFullText = writtenWords <= TIMELINE_FULL_TEXT_WORDS;

  const editable = new Set(chapters
    .filter(c => !c.text && (mode === 'rework' || !c.notes))
    .map(c => c.id));
  const allowedNew = mode === 'fill'
    ? Math.max(0, settings.totalChapters - chapters.length)
    : Math.max(0, MAX_TOTAL_CHAPTERS - chapters.length);

  if (mode === 'fill' && editable.size === 0 && allowedNew === 0) return { chapters: [] };
  if (mode === 'rework' && chapters.every(c => c.text)) {
    throw new AuthorInputError('Det finns inga planerade kapitel att göra om - lägg till kapitel eller öka antalet kapitel');
  }

  const chapterList = chapters.map((c, i) => {
    const status = c.text ? `SKRIVET av ${c.source === 'ai' ? 'AI:n' : 'författaren'} (får inte ändras)` : 'PLANERAT';
    const body = c.text
      ? showFullText
        ? `\nText:\n${c.text}`
        : `\nBörjan: ${headWords(c.text, 250)}\nSlutet: ${tailWords(c.text, 350)}`
      : '';
    return `<kapitel nr="${i + 1}" id="${c.id}" status="${status}">
Rubrik: ${c.title || '(ingen rubrik)'}
Anteckningar: ${c.notes || '(inga)'}${body}
</kapitel>`;
  }).join('\n');

  const headingExamples = chapters.map(c => c.title).filter(t => t && !isPlaceholderTitle(t)).slice(0, 4);

  const task = mode === 'fill'
    ? `UPPGIFT (fyll i tidslinjen):
- Skriv anteckningar för varje PLANERAT kapitel som saknar anteckningar${editable.size > 0 ? ` (id: ${Array.from(editable).join(', ')})` : ' (inga just nu)'}. Använd kapitlets id.
- Planerade kapitel som redan har anteckningar är författarens fasta punkter. Returnera dem inte, men bygg handlingen runt dem.
${allowedNew > 0
    ? `- Lägg sedan till EXAKT ${allowedNew} nya kapitel efter alla befintliga, så att boken får ${settings.totalChapters} kapitel totalt. Nya kapitel har id "" (tom sträng).`
    : '- Lägg inte till några nya kapitel.'}`
    : `UPPGIFT (gör om planen):
- Författarens önskemål: ${instruction?.trim() || 'gör planen för de kapitel som återstår starkare, tydligare och mer sammanhängande'}
- Gör om de PLANERADE kapitlen (rubrik och anteckningar) enligt önskemålet. Returnera varje planerat kapitel du ändrar med dess id. Kapitel som inte behöver ändras kan utelämnas.
- Lägg bara till nya kapitel (id "") om önskemålet kräver det eller om boken har färre än ${settings.totalChapters} kapitel. Nya kapitel hamnar efter alla befintliga.`;

  const prompt = `Du är förlagsredaktör och hjälper en svensk författare att planera resten av sin bok. Författaren är bra på att skriva men behöver hjälp med riktningen och med att ta boken hela vägen till ett slut.

${bookInfo(project)}
ANTAL KAPITEL TOTALT: ${settings.totalChapters} (ca ${settings.wordsPerChapter} ord per kapitel)
${project.voice?.profile.pacing ? `FÖRFATTARENS TEMPO: ${project.voice.profile.pacing}\n` : ''}
KAPITLEN SOM FINNS NU (i ordning):
${chapterList}

${task}

REGLER FÖR PLANEN:
- Skrivna kapitel är fakta. Motsäg dem aldrig och planera aldrig om dem. Plocka upp trådar, frågor och ledtrådar som redan finns i texten.
- Bygg en sammanhängande båge fram till slutet: stegring, vändpunkter, en lägsta punkt och ett avgörande där huvudpersonen själv gör något. ${project.ending ? 'Slutet ska landa i det slut författaren tänkt sig.' : 'Planera ett tydligt och tillfredsställande slut i sista kapitlet.'}
- Anpassa innehållet och spänningen till målåldern.
- notes: 2-4 konkreta meningar per kapitel om vad som händer och vad som förändras (för huvudpersonen, relationerna eller vad läsaren får veta). Ingen prosa, inga repliker, inga stämningsord, inga långa tankstreck (—).
- title: följ författarens rubrikstil exakt och numrera vidare i ordning.${headingExamples.length > 0 ? ` Befintliga rubriker: ${headingExamples.map(h => `"${h}"`).join(', ')}.` : ' Författaren har inga rubriker med titel ännu - använd "Kapitel N - Titel".'} Behåll rubriker som författaren redan gett planerade kapitel om de inte bara är ett nummer.`;

  const result = await streamJson<{ chapters: { id: string; title: string; notes: string }[] }>({
    content: prompt,
    schema: TIMELINE_SCHEMA,
    effort: 'medium',
    maxTokens: 16000,
    deadline,
    what: 'planera kapitlen',
  });

  // Servern bestämmer vad som får ändras: aldrig skrivna kapitel, aldrig okända id
  const byId = new Map(chapters.map(c => [c.id, c]));
  const seen = new Set<string>();
  const out: TimelineResponse['chapters'] = [];
  let added = 0;
  for (const item of Array.isArray(result.chapters) ? result.chapters : []) {
    const id = (item.id ?? '').trim();
    const notes = sanitizeProse((item.notes ?? '').trim()).slice(0, LIMITS.notes);
    const aiTitle = sanitizeProse((item.title ?? '').trim()).slice(0, LIMITS.chapterTitle);
    if (!notes) continue;
    if (id && byId.has(id)) {
      if (!editable.has(id) || seen.has(id)) continue;
      seen.add(id);
      const existing = byId.get(id)!.title;
      const keepTitle = mode === 'fill' && existing && !isPlaceholderTitle(existing);
      out.push({ id, title: keepTitle ? existing : aiTitle || existing, notes });
    } else if (!id && added < allowedNew) {
      added++;
      out.push({ title: aiTitle || `Kapitel ${chapters.length + added}`, notes });
    }
  }
  return { chapters: out };
}

// ═══════════════════════════════════════════
//  3. Kapitel: skriv (eller skriv om) ett kapitel med författarens röst
// ═══════════════════════════════════════════

// Så mycket av boken hittills som skickas ordagrant; äldre kapitel sammanfattas
const STORY_VERBATIM_WORDS = 40_000;
// Tid som sammanfattningen av äldre kapitel får ta av budgeten
const SUMMARY_BUDGET_MS = 75_000;

const FREEDOM_TEXT: Record<FinishSettings['freedom'], string> = {
  follow: 'Följ författarens anteckningar noga. Lägg inte till egna scener, figurer eller vändningar. Fyll bara ut det anteckningarna säger med levande scener.',
  balanced: 'Följ anteckningarna, men du får lägga till mindre scener, detaljer och övergångar som gör kapitlet levande. Inga nya viktiga figurer eller vändningar.',
  free: 'Anteckningarna är riktningen. Du får lägga till scener, bifigurer och vändningar som tjänar berättelsen, så länge kapitlet leder dit anteckningarna och kommande kapitel pekar.',
};

export async function writeChapter(
  project: ProjectContext,
  chapterId: string,
  comment: string | undefined,
  deadline: number,
): Promise<{ text: string; truncated: boolean }> {
  const index = project.chapters.findIndex(c => c.id === chapterId);
  if (index < 0) throw new AuthorInputError('Kapitlet finns inte i boken');
  const chapter = project.chapters[index];
  const { settings, voice } = project;
  const previous = project.chapters.slice(0, index).filter(c => c.text);
  const later = project.chapters.slice(index + 1);
  const rewriting = Boolean(chapter.text && comment);

  if (previous.length === 0 && !voice && !rewriting) {
    throw new AuthorInputError('Skriv eller klistra in bokens början först, så att AI:n kan lära sig ditt språk');
  }

  const story = await storySoFar(previous, project, deadline);
  const marker = voice?.profile.dialogueMarker?.trim() ? voice.profile.dialogueMarker : DEFAULT_MARKER;

  const system = `Du är spökskrivare åt en svensk författare. Författaren har skrivit början av sin bok själv och du skriver nästa del så att ingen läsare kan märka var författaren slutade och du tog vid. Du skriver med författarens röst, aldrig med din egen.
${voiceOrFallback(voice)}
${proseRulesForAuthor(Boolean(voice))}`;

  const laterList = later.map((c, i) => {
    const plan = c.notes || (c.text ? `(skrivet) ${headWords(c.text, 120)}` : '(ingen plan ännu)');
    return `- ${c.title || `Kapitel ${index + i + 2}`}: ${plan}`;
  }).join('\n');

  const isLast = later.length === 0 && project.chapters.length >= settings.totalChapters;

  const task = `${bookInfo(project)}

KAPITLET DU SKA ${rewriting ? 'SKRIVA OM' : 'SKRIVA'}: ${chapter.title || `kapitel ${index + 1}`} (kapitel ${index + 1} av ${Math.max(settings.totalChapters, project.chapters.length)})

FÖRFATTARENS ANTECKNINGAR FÖR KAPITLET:
${chapter.notes || '(inga anteckningar - skriv det kapitel berättelsen naturligt behöver här, på väg mot slutet)'}

${laterList ? `KOMMANDE KAPITEL (bara så att du kan förbereda det som kommer - skriv INTE det som händer i dem):
${laterList}
` : ''}
FRIHET: ${FREEDOM_TEXT[settings.freedom]}
${rewriting ? `
NUVARANDE VERSION AV KAPITLET:
"""
${chapter.text}
"""

FÖRFATTARENS KOMMENTAR: ${comment}

Skriv om kapitlet enligt kommentaren. Behåll allt som kommentaren inte ber dig ändra (händelser, repliker, formuleringar) så långt det går, och gör ändringarna så att texten fortfarande hänger ihop.` : `${chapter.text ? 'Författaren vill ha en helt ny version av kapitlet. Skriv det från början och pröva gärna andra scenval och formuleringar.\n' : ''}${comment ? `\nFÖRFATTARENS ÖNSKEMÅL FÖR KAPITLET: ${comment}\n` : ''}`}
LÄNGD: ca ${settings.wordsPerChapter} ord (håll dig inom 15 % åt båda hållen). Skynda inte igenom händelserna.

SÅ SKRIVER DU KAPITLET:
- ${previous.length > 0 ? 'Fortsätt precis där föregående kapitel slutar. Läsaren har nyss läst det: upprepa inte och sammanfatta inte det som redan hänt.' : 'Det här är bokens första text - börja direkt i en scen.'}
- Samma tempus, perspektiv, replikformat och ordval som författaren. Figurernas namn, sätt att prata och vad de vet ska stämma med boken hittills.
- ${isLast ? 'Det här är bokens sista kapitel: knyt ihop trådarna och ge ett tydligt, tillfredsställande slut i författarens ton.' : 'Kapitlet ska sluta där anteckningarna slutar, vid ett naturligt avbrott. Inte med en olycksbådande enradare om det inte är så författaren brukar göra.'}

FORMAT:
- Svara ENBART med kapitlets brödtext. Ingen kapitelrubrik (den lagras separat), ingen inledning, inga kommentarer, inget "Slut".
- Ett stycke per rad, inga tomma rader mellan styckena.
- ${lineDialogueMarker(marker)
    ? `Varje replik står i ett eget stycke som börjar med exakt "${lineDialogueMarker(marker)}", som i författarens text. Glöm aldrig markeringen, inte heller på korta repliker som "Vad blir det för mat?".`
    : 'Repliker skrivs exakt som i författarens text.'}
- Ingen markdown.`;

  const content: Anthropic.TextBlockParam[] = [
    // Boken hittills är samma vid omskrivningar av kapitlet - cachas
    { type: 'text', text: story, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: task },
  ];

  // Svensk prosa ~2,5-3 tokens per ord + utrymme för tänkande
  const maxTokens = Math.min(64000, Math.round(settings.wordsPerChapter * 3.5) + 12000);
  const client = getClient();
  const model = await resolveLatestModel(client);

  return withModelFallback(model, async (m) => {
    let written = '';
    const stream = client.messages.stream({
      model: m,
      max_tokens: maxTokens,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium' },
      system,
      messages: [{ role: 'user', content }],
    });
    stream.on('text', delta => { written += delta; });
    const timer = setTimeout(() => stream.abort(), Math.max(1000, deadline - Date.now()));

    try {
      const message = await stream.finalMessage();
      if (message.stop_reason === 'refusal') throw new Error('Claude avböjde att skriva kapitlet');
      return finishChapter(textOf(message) || written, message.stop_reason === 'max_tokens', project, chapter.title);
    } catch (err) {
      if (err instanceof Anthropic.APIUserAbortError) {
        if (written.trim()) return finishChapter(written, true, project, chapter.title);
        throw new Error('Det tog för lång tid att skriva kapitlet - försök igen');
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  });
}

function finishChapter(raw: string, truncated: boolean, project: ProjectContext, title: string) {
  let clean = raw;
  // Avbruten text: släng det halvfärdiga sista stycket
  if (truncated) {
    const lastBreak = clean.trimEnd().lastIndexOf('\n');
    if (lastBreak > 0) clean = clean.slice(0, lastBreak);
  }
  const text = normalizeProse(clean, project.voice, title);
  if (!text) throw new Error('Kapitlet blev tomt - försök igen');
  return { text, truncated };
}

// Boken hittills: de senaste ~40 000 orden ordagrant, äldre kapitel sammanfattade
async function storySoFar(previous: ChapterContext[], project: ProjectContext, deadline: number): Promise<string> {
  if (previous.length === 0) return 'BOKEN HITTILLS: (inget skrivet ännu)';

  const verbatim: ChapterContext[] = [];
  let words = 0;
  for (let i = previous.length - 1; i >= 0; i--) {
    const w = countWords(previous[i].text);
    if (words + w > STORY_VERBATIM_WORDS) {
      // Det närmaste kapitlet är alltid med - vid behov bara slutet av det
      if (verbatim.length === 0) verbatim.unshift({ ...previous[i], text: tailWords(previous[i].text, STORY_VERBATIM_WORDS) });
      break;
    }
    verbatim.unshift(previous[i]);
    words += w;
  }
  const older = previous.slice(0, previous.length - verbatim.length);

  let summary = '';
  if (older.length > 0) {
    summary = await summarizeChapters(older, project, Math.min(deadline - 150_000, Date.now() + SUMMARY_BUDGET_MS))
      .catch(err => {
        console.warn('[author] sammanfattning misslyckades, använder anteckningar:', err);
        return older.map(c => `${c.title}: ${c.notes || headWords(c.text, 150)}`).join('\n');
      });
  }

  const block = (c: ChapterContext) =>
    `<kapitel rubrik="${c.title.replace(/"/g, "'")}" skrivet_av="${c.source === 'ai' ? 'AI:n' : 'författaren'}">\n${c.text}\n</kapitel>`;

  return `BOKEN HITTILLS (kapitel skrivna av författaren själv är den säkraste förebilden för rösten)
${summary ? `\nSAMMANFATTNING AV DE FÖRSTA KAPITLEN:\n${summary}\n\nDE SENASTE KAPITLEN ORDAGRANT:\n` : ''}${verbatim.map(block).join('\n\n')}`;
}

async function summarizeChapters(chapters: ChapterContext[], project: ProjectContext, deadline: number): Promise<string> {
  if (deadline - Date.now() < 10_000) throw new Error('Ingen tid för sammanfattning');
  const client = getClient();
  const model = await resolveLatestModel(client);
  const text = chapters.map(c => `<kapitel rubrik="${c.title}">\n${c.text}\n</kapitel>`).join('\n\n');
  const prompt = `Sammanfatta kapitlen nedan ur boken "${project.title}" så att en författare kan skriva vidare utan att tappa trådar. Per kapitel: rubrik och 4-8 meningar om vad som händer, vilka figurer som är med, vad de får veta, löften, ledtrådar och olösta frågor. Ta med namn, platser och konkreta detaljer som kan komma tillbaka. Ren text, inga långa tankstreck.

${text}`;

  return withModelFallback(model, async (m) => {
    const stream = client.messages.stream({
      model: m,
      max_tokens: 12000,
      output_config: { effort: 'low' },
      messages: [{ role: 'user', content: prompt }],
    });
    const timer = setTimeout(() => stream.abort(), Math.max(1000, deadline - Date.now()));
    try {
      const message = await stream.finalMessage();
      const out = sanitizeProse(textOf(message).trim());
      if (!out) throw new Error('Tom sammanfattning');
      return out;
    } finally {
      clearTimeout(timer);
    }
  });
}

// ═══════════════════════════════════════════
//  4. Skriv om en markerad del
// ═══════════════════════════════════════════

const REWRITE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['variants'],
  properties: {
    variants: { type: 'array', items: { type: 'string' } },
  },
};

export const REWRITE_LIMITS = { selection: 15_000, before: 4000, after: 2000, comment: 2000 };

export async function rewritePassage(req: RewriteRequest, deadline: number): Promise<string[]> {
  const voice = normalizeVoice(req.project.voice);
  const settings = normalizeSettings(req.project.settings);
  const project = {
    title: str(req.project.title, LIMITS.title).trim() || 'Namnlös bok',
    premise: str(req.project.premise, LIMITS.premise).trim(),
    settings,
  };
  // Bara närmaste sammanhanget skickas
  const before = str(req.before, 1_000_000).slice(-REWRITE_LIMITS.before);
  const after = str(req.after, 1_000_000).slice(0, REWRITE_LIMITS.after);
  const selection = req.selection;
  const comment = req.comment?.trim();
  const count = req.mode === 'variants' ? 2 : 1;
  const selectionWords = countWords(selection);

  const modeTask = {
    comment: `Skriv EN ny version av det markerade som följer författarens kommentar: "${comment}". Ändra bara det kommentaren ber om. Behåll resten av innehållet och formuleringarna så långt det går.`,
    variants: 'Skriv TVÅ tydligt olika versioner av det markerade. Samma plats i berättelsen och samma funktion, men olika lösningar: t.ex. olika detaljer, annan vinkel på känslan, annan replik eller annat tempo. Båda ska vara lika bra och låta som författaren.',
    polish: 'Skriv EN putsad version av det markerade: bättre flyt och rytm, bort med allt som låter stolpigt eller som AI-text (klyschor, staplade liknelser, uppräkningar i tre led, förklarande känsloord). Behåll innehållet, händelserna och författarens röst. Ändra så lite som behövs.',
  }[req.mode];

  const system = `Du är redaktör åt en svensk författare och skriver om ett markerat stycke i hens bok. Det du skriver ska låta som författaren själv, aldrig som en redaktör eller en AI.
${voiceOrFallback(voice)}
${proseRulesForAuthor(Boolean(voice))}`;

  const prompt = `${bookInfo(project)}
KAPITEL: ${str(req.chapterTitle, LIMITS.chapterTitle) || '(okänt)'}

TEXTEN FÖRE MARKERINGEN:
<före>${before}</före>

DET MARKERADE (ska ersättas):
<markerat>${selection}</markerat>

TEXTEN EFTER MARKERINGEN:
<efter>${after}</efter>
${!voice ? '\nHärma rösten i texten före och efter markeringen.\n' : ''}
UPPGIFT: ${modeTask}

KRAV:
- Ersättningen ska passa sömlöst mellan <före> och <efter>: läs före + din text + efter i ett svep och kontrollera att det hänger ihop grammatiskt och i handlingen. Börjar markeringen mitt i en mening ska din text också göra det.
- Upprepa inga meningar, ord eller händelser från texten före eller efter. Skriv bara ersättningen.
- Samma tempus, perspektiv och replikformat som författaren${lineDialogueMarker(voice?.profile.dialogueMarker) ? ` (repliker i egna stycken som börjar med "${lineDialogueMarker(voice?.profile.dialogueMarker)}")` : ''}. Behåll styckeindelningen: ett stycke per rad.
- Längd: ungefär som det markerade (ca ${selectionWords} ord)${req.mode === 'comment' ? ' om inte kommentaren ber om något annat' : ''}.
- Inga långa tankstreck (—), ingen markdown, inga citattecken runt hela texten, inga förklaringar.

variants: ${count === 2 ? 'exakt två versioner' : 'exakt en version'}.`;

  const client = getClient();
  const model = await resolveLatestModel(client);
  const result = await withModelFallback(model, async (m) => {
    const stream = client.messages.stream({
      model: m,
      max_tokens: Math.min(32000, selectionWords * 3 * count + 6000),
      thinking: { type: 'adaptive' },
      output_config: {
        effort: req.mode === 'polish' ? 'low' : 'medium',
        format: { type: 'json_schema', schema: REWRITE_SCHEMA },
      },
      system,
      messages: [{ role: 'user', content: prompt }],
    });
    const timer = setTimeout(() => stream.abort(), Math.max(1000, deadline - Date.now()));
    try {
      const message = await stream.finalMessage();
      if (message.stop_reason === 'refusal') throw new Error('Claude avböjde att skriva om texten');
      if (message.stop_reason === 'max_tokens') throw new Error('Svaret blev för långt - markera en kortare del');
      return JSON.parse(textOf(message)) as { variants: string[] };
    } catch (err) {
      if (err instanceof Anthropic.APIUserAbortError) throw new Error('Det tog för lång tid att skriva om texten - försök igen');
      throw err;
    } finally {
      clearTimeout(timer);
    }
  });

  const variants = (Array.isArray(result.variants) ? result.variants : [])
    .map(v => fitReplacement(typeof v === 'string' ? v : '', before, selection, after, voice))
    .filter(Boolean)
    .slice(0, count);
  if (variants.length === 0) throw new Error('Inget förslag kom tillbaka - försök igen');
  return variants;
}

// Städar ett förslag och ser till att det passar in där markeringen stod
function fitReplacement(raw: string, before: string, selection: string, after: string, voice?: AuthorVoiceRef): string {
  const marker = lineDialogueMarker(voice?.profile.dialogueMarker) ?? DEFAULT_MARKER;
  let text = raw
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => {
      let l = line.replace(/^\s*#{1,6}\s*/, '').replace(/\*\*|__/g, '').trim();
      if (marker) l = l.replace(/^[-—―–*]\s+/, marker);
      return sanitizeProse(l);
    })
    .filter(Boolean)
    .join('\n');
  text = restoreDialogueMarkers(text, marker).text;
  // Citattecken runt hela förslaget
  if (/^["”»][^"”»]*["”«]$/.test(text) && !/^["”»]/.test(selection.trim())) text = text.slice(1, -1).trim();
  text = stripOverlap(text, before, after);
  if (!text) return '';

  // Samma omgivande blanksteg som markeringen, så att texten klistras in rätt
  const lead = selection.match(/^\s*/)?.[0] ?? '';
  const trail = selection.match(/\s*$/)?.[0] ?? '';
  // Markeringen börjar mitt i en rad: inte en replikmarkering som inte fanns där
  if (marker && !selection.trimStart().startsWith(marker.trim()) && before && !/\n\s*$/.test(before) && text.startsWith(marker)) {
    text = text.slice(marker.length);
  }
  return `${lead}${text}${trail}`;
}

// Tar bort text som modellen upprepat från före/efter markeringen
function stripOverlap(text: string, before: string, after: string): string {
  let t = text;
  const b = before.trimEnd();
  for (let len = Math.min(b.length, t.length, 400); len >= 20; len--) {
    if (t.startsWith(b.slice(-len))) { t = t.slice(len).trimStart(); break; }
  }
  const a = after.trimStart();
  for (let len = Math.min(a.length, t.length, 400); len >= 20; len--) {
    if (t.endsWith(a.slice(0, len))) { t = t.slice(0, t.length - len).trimEnd(); break; }
  }
  return t;
}
