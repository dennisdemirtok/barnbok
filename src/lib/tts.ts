// Ljudbok: gör om bokens text till uppläst ljud med ElevenLabs.
//
// Texten delas i avsnitt (kapitel), och varje avsnitt läses i bitar som hålls
// ihop av previous_text/next_text så att rösten behåller tonen över skarvarna.
import { createHash } from 'crypto';
import { BookProject } from './types';
import { DEFAULT_VOICE_ID } from './tts-voices';
import { estimateSeconds, narrationSegments } from './narration';

// Avsnittsindelningen bor i narration.ts (delas med sidan) - samma namn som förut här
export { estimateSeconds, narrationSegments };
export type { NarrationSegment } from './narration';

const API = 'https://api.elevenlabs.io/v1/text-to-speech';

// Tre lägen att läsa i. Kvoten hos ElevenLabs räknas per tecken: de två första
// kostar ett tecken per tecken, det snabba läget hälften.
export type TtsQuality = 'best' | 'expressive' | 'economy';
const MODELS: Record<TtsQuality, string> = {
  best: 'eleven_multilingual_v2',
  expressive: 'eleven_v3',
  economy: 'eleven_flash_v2_5',
};
export const CREDIT_FACTOR: Record<TtsQuality, number> = { best: 1, expressive: 1, economy: 0.5 };
export const QUALITY_IDS: TtsQuality[] = ['best', 'expressive', 'economy'];
export const isQuality = (value: unknown): value is TtsQuality =>
  typeof value === 'string' && (QUALITY_IDS as string[]).includes(value);
// Max tecken per anrop. Kortare bitar ger snabbare svar och mindre att göra om
const CHUNK_CHARS = 2200;
const REQUEST_TIMEOUT_MS = 120_000;

export function hasTtsKey(): boolean {
  return !!process.env.ELEVENLABS_API_KEY;
}

// ── Uttal ──
// En egen uttalslista per bok: ord som rösten säger konstigt skrivs om till hur
// de ska låta innan texten skickas till ElevenLabs ("Gunbritt" -> "Gunn-britt").
// Funkar med alla röster och modeller och kräver inga extra rättigheter.
export interface PronunciationRule { word: string; sayAs: string }

const LETTER = 'A-Za-zÅÄÖåäöÉéÜü';

function wordPattern(word: string): RegExp {
  const escaped = word.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Hela ord: inga bokstäver direkt före eller efter
  // Genitiv-s följer med: "Gunbritts" blir "Gunn-britts"
  return new RegExp(`(^|[^${LETTER}])(${escaped})(s?)(?=$|[^${LETTER}])`, 'gi');
}

export function applyPronunciations(text: string, rules: PronunciationRule[]): string {
  let out = text;
  for (const rule of rules) {
    if (!rule.word?.trim() || !rule.sayAs?.trim()) continue;
    out = out.replace(wordPattern(rule.word), (_m, before: string, found: string, genitive: string) => {
      // Stor bokstav först i ordet behålls, så att meningar börjar rätt
      const say = rule.sayAs.trim();
      const capital = found[0] === found[0].toUpperCase() && found[0] !== found[0].toLowerCase();
      return before + (capital ? say.charAt(0).toUpperCase() + say.slice(1) : say) + genitive;
    });
  }
  return out;
}

export function containsWord(text: string, word: string): boolean {
  return !!word.trim() && wordPattern(word).test(text);
}

// Fingeravtryck av texten som faktiskt lästes - ändras texten eller uttalet
// syns det att kapitlet behöver läsas om
export function textStamp(text: string): string {
  return createHash('sha1').update(text).digest('hex').slice(0, 10);
}

// Kapitellista med vad varje avsnitt kostar att läsa upp
export interface SegmentSummary { index: number; label: string; characters: number; seconds: number }

export function segmentSummaries(book: BookProject): SegmentSummary[] {
  return narrationSegments(book).map(seg => ({
    index: seg.index,
    label: seg.label,
    characters: seg.text.length,
    seconds: estimateSeconds(seg.text),
  }));
}

// Provlyssning: bokens första sidor, ungefär så här många ord
export function previewText(book: BookProject, maxWords = 280): string {
  const segments = narrationSegments(book);
  if (segments.length === 0) return book.title;
  // Provet går över avsnittsgränsen: titel, kapitelrubrik och bokens första sidor
  const full = segments.map(s => s.text).join('\n\n');
  const words = full.split(/\s+/);
  if (words.length <= maxWords) return full;
  // Klipp vid en meningsslut så att provet inte slutar mitt i
  const cut = words.slice(0, maxWords).join(' ');
  const lastStop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  return lastStop > 200 ? cut.slice(0, lastStop + 1) : cut;
}

// ── Talet ──

function chunkText(text: string): string[] {
  const paragraphs = text.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let buffer = '';
  for (const paragraph of paragraphs) {
    if (buffer && buffer.length + paragraph.length + 2 > CHUNK_CHARS) {
      chunks.push(buffer);
      buffer = '';
    }
    if (paragraph.length > CHUNK_CHARS) {
      // Ett mycket långt stycke delas vid meningsslut
      const sentences = paragraph.match(/[^.!?]+[.!?]*\s*/g) || [paragraph];
      for (const sentence of sentences) {
        if (buffer.length + sentence.length > CHUNK_CHARS) { chunks.push(buffer); buffer = ''; }
        buffer += sentence;
      }
      continue;
    }
    buffer = buffer ? `${buffer}\n\n${paragraph}` : paragraph;
  }
  if (buffer.trim()) chunks.push(buffer);
  return chunks;
}

// ElevenLabs tillåter bara några anrop samtidigt per konto (Starter: 3). Alla
// uppläsningar i servern - ljudböcker, provlyssningar, uttal - delar därför på
// två platser och väntar på sin tur, i stället för att få "för många anrop".
const MAX_CONCURRENT = Math.max(1, Number(process.env.ELEVENLABS_CONCURRENCY) || 2);
let activeCalls = 0;
const waiting: (() => void)[] = [];

async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  // En ledig plats tas direkt, annars lämnas platsen över av den som blir klar
  if (activeCalls >= MAX_CONCURRENT) await new Promise<void>(resolve => waiting.push(resolve));
  else activeCalls++;
  try {
    return await fn();
  } finally {
    const next = waiting.shift();
    if (next) next();
    else activeCalls--;
  }
}

// Kvoten slut: ingen idé att försöka igen eller fortsätta med fler kapitel
export class TtsQuotaError extends Error {}

// För många anrop just nu, eller tillfälligt fel hos ElevenLabs - går att försöka igen
class TtsBusyError extends Error {
  constructor(message: string, public retryAfterMs = 0) { super(message); }
}

// Så länge väntar vi när ElevenLabs säger "för många anrop" eller är överbelastat
const RETRY_DELAYS_MS = [3000, 8000, 15000, 30000];

async function speak(text: string, voiceId: string, around: { before?: string; after?: string }, quality: TtsQuality): Promise<Buffer> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await withSlot(() => speakOnce(text, voiceId, around, quality));
    } catch (err) {
      if (!(err instanceof TtsBusyError) || attempt >= RETRY_DELAYS_MS.length) throw err;
      const wait = Math.max(RETRY_DELAYS_MS[attempt], err.retryAfterMs);
      console.warn(`[Ljud] ElevenLabs är upptaget - nytt försök om ${Math.round(wait / 1000)} s`);
      await new Promise(resolve => setTimeout(resolve, wait));
    }
  }
}

async function speakOnce(text: string, voiceId: string, around: { before?: string; after?: string }, quality: TtsQuality): Promise<Buffer> {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error('ElevenLabs-nyckeln saknas på servern (ELEVENLABS_API_KEY)');

  const body = {
    text,
    model_id: MODELS[quality],
    // Säg alltid att texten är svensk - annars drar rösterna åt engelskt uttal
    language_code: 'sv',
    // Sammanhanget gör att tonen hänger ihop mellan bitarna
    previous_text: around.before?.slice(-500) || undefined,
    next_text: around.after?.slice(0, 500) || undefined,
    voice_settings: { stability: 0.45, similarity_boost: 0.75, style: 0.2, use_speaker_boost: true },
  };

  const res = await fetch(`${API}/${voiceId}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    cache: 'no-store',
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    if (/quota_exceeded|exceeds your quota|credits remaining/i.test(detail)) {
      throw new TtsQuotaError('Ljudkvoten hos ElevenLabs är slut för den här perioden - resten kan läsas in när kvoten fylls på');
    }
    if (res.status === 429 || res.status >= 500) {
      const retryAfter = Number(res.headers.get('retry-after')) * 1000 || 0;
      throw new TtsBusyError(ttsErrorMessage(res.status, detail), retryAfter);
    }
    throw new Error(ttsErrorMessage(res.status, detail));
  }
  return Buffer.from(await res.arrayBuffer());
}

function ttsErrorMessage(status: number, detail: string): string {
  if (status === 401) return 'ElevenLabs-nyckeln godtogs inte (kontrollera nyckeln i Railway)';
  if (status === 429) return 'ElevenLabs hann inte med fler anrop just då - försök igen om en stund';
  if (status >= 500) return 'ElevenLabs hade ett tillfälligt fel - försök igen om en stund';
  return `ElevenLabs svarade ${status}${detail ? `: ${detail.slice(0, 200)}` : ''}`;
}

/** Läser upp en text och ger tillbaka en mp3. Långa texter läses i bitar. */
export async function synthesize(text: string, voiceId = DEFAULT_VOICE_ID, quality: TtsQuality = 'best'): Promise<Buffer> {
  const chunks = chunkText(text);
  const parts: Buffer[] = [];
  for (let i = 0; i < chunks.length; i++) {
    parts.push(await speak(chunks[i], voiceId, { before: chunks[i - 1], after: chunks[i + 1] }, quality));
  }
  return Buffer.concat(parts);
}

// Kort mening att välja röst på. Samma text för alla röster, så att de går att jämföra.
export const VOICE_SAMPLE_TEXT =
  'Hej! Det är jag som läser boken för dig. Vilja sjunker alltid åt vänster i vattnet, och det tycker hon är ganska tjatigt.';
