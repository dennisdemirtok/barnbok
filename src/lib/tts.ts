// Ljudbok: gör om bokens text till uppläst ljud med ElevenLabs.
//
// Texten delas i avsnitt (kapitel), och varje avsnitt läses i bitar som hålls
// ihop av previous_text/next_text så att rösten behåller tonen över skarvarna.
import { createHash } from 'crypto';
import { BookProject } from './types';
import { DEFAULT_VOICE_ID } from './tts-voices';
import { estimateSeconds, narrationSegments } from './narration';
import { prepareForSpeech } from './swedish-speech';

// Avsnittsindelningen bor i narration.ts (delas med sidan) - samma namn som förut här
export { estimateSeconds, narrationSegments };
export type { NarrationSegment } from './narration';

const API = 'https://api.elevenlabs.io/v1/text-to-speech';

// Lägen att läsa i. Kvoten hos ElevenLabs räknas per tecken: de flesta kostar
// ett tecken per tecken, det snabba läget hälften. v4 (september 2026) är
// ElevenLabs nyaste modell: jämnare röst genom långa texter.
export type TtsQuality = 'best' | 'expressive' | 'economy' | 'v4';
const MODELS: Record<TtsQuality, string> = {
  best: 'eleven_multilingual_v2',
  expressive: 'eleven_v3',
  economy: 'eleven_flash_v2_5',
  v4: 'eleven_v4',
};
export const CREDIT_FACTOR: Record<TtsQuality, number> = { best: 1, expressive: 1, economy: 0.5, v4: 1 };
export const QUALITY_IDS: TtsQuality[] = ['best', 'expressive', 'economy', 'v4'];
export const isQuality = (value: unknown): value is TtsQuality =>
  typeof value === 'string' && (QUALITY_IDS as string[]).includes(value);
// Max tecken per anrop. Korta bitar gör att ett fel kan rättas genom att bara
// den biten läses om (ungefär en minut ljud), och bitarna hålls ihop av
// tidigare inläsningar så att skarvarna inte hörs.
const CHUNK_CHARS = 1200;
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

/** Det som faktiskt skickas till rösten: bokens uttalslista först, sedan svensk textförberedelse. */
export function spokenText(text: string, rules: PronunciationRule[]): string {
  return prepareForSpeech(applyPronunciations(text, rules));
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

// Röstinställningar. Version 1 gav mer variation mellan kapitel (lägre stabilitet
// och stil på 0,2, som ElevenLabs avråder från). En bok läses alltid klart med
// samma version, så att kapitel som läses om låter som resten.
export type VoiceSettingsVersion = 1 | 2;
export const CURRENT_VOICE_SETTINGS: VoiceSettingsVersion = 2;
const VOICE_SETTINGS: Record<VoiceSettingsVersion, { stability: number; similarity_boost: number; style: number; use_speaker_boost: boolean }> = {
  1: { stability: 0.45, similarity_boost: 0.75, style: 0.2, use_speaker_boost: true },
  2: { stability: 0.55, similarity_boost: 0.75, style: 0, use_speaker_boost: true },
};
export const isVoiceSettingsVersion = (value: unknown): value is VoiceSettingsVersion => value === 1 || value === 2;

// Så länge väntar vi när ElevenLabs säger "för många anrop" eller är överbelastat
const RETRY_DELAYS_MS = [3000, 8000, 15000, 30000];

// Sammanhanget runt en bit: texten före och efter, och de närmaste tidigare och
// senare inläsningarna. ElevenLabs lyssnar på inläsningarna ("request stitching")
// och håller samma röst och ton som i dem - text räcker inte för det.
interface SpeechContext {
  before?: string;
  after?: string;
  previousRequestIds?: string[];
  nextRequestIds?: string[];
}

interface SpeechResult { audio: Buffer; requestId: string | null; credits: number }

async function speak(text: string, voiceId: string, context: SpeechContext, quality: TtsQuality, settings: VoiceSettingsVersion): Promise<SpeechResult> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await withSlot(() => speakOnce(text, voiceId, context, quality, settings));
    } catch (err) {
      if (!(err instanceof TtsBusyError) || attempt >= RETRY_DELAYS_MS.length) throw err;
      const wait = Math.max(RETRY_DELAYS_MS[attempt], err.retryAfterMs);
      console.warn(`[Ljud] ElevenLabs är upptaget - nytt försök om ${Math.round(wait / 1000)} s`);
      await new Promise(resolve => setTimeout(resolve, wait));
    }
  }
}

// Modeller som inte tar emot tidigare inläsningar (eleven_v3 gör det inte enligt
// ElevenLabs, och fler kan visa sig). Upptäcks det skickas bara texten.
const noStitching = new Set<string>(['eleven_v3']);

async function speakOnce(text: string, voiceId: string, context: SpeechContext, quality: TtsQuality, settings: VoiceSettingsVersion): Promise<SpeechResult> {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error('ElevenLabs-nyckeln saknas på servern (ELEVENLABS_API_KEY)');

  const model = MODELS[quality];
  const stitch = !noStitching.has(model);
  const previousIds = stitch ? (context.previousRequestIds || []).filter(Boolean).slice(-3) : [];
  const nextIds = stitch ? (context.nextRequestIds || []).filter(Boolean).slice(0, 3) : [];
  const body = {
    text,
    model_id: model,
    // Säg alltid att texten är svensk - annars drar rösterna åt engelskt uttal
    language_code: 'sv',
    // Sammanhanget gör att tonen hänger ihop mellan bitarna. Finns tidigare
    // inläsningar används de i stället för texten (ElevenLabs ignorerar då texten).
    previous_text: context.before?.slice(-500) || undefined,
    next_text: context.after?.slice(0, 500) || undefined,
    previous_request_ids: previousIds.length > 0 ? previousIds : undefined,
    next_request_ids: nextIds.length > 0 ? nextIds : undefined,
    voice_settings: VOICE_SETTINGS[settings],
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
    // Avvisas de tidigare inläsningarna (för gamla, eller modellen tar inte emot
    // dem) läses biten utan dem i stället för att hela kapitlet misslyckas
    if ((res.status === 400 || res.status === 422) && (previousIds.length > 0 || nextIds.length > 0)) {
      if (/model|not supported|not available/i.test(detail)) noStitching.add(model);
      console.warn(`[Ljud] tidigare inläsningar avvisades (${res.status}) - läser utan dem`);
      return speakOnce(text, voiceId, { before: context.before, after: context.after }, quality, settings);
    }
    throw new Error(ttsErrorMessage(res.status, detail));
  }
  return {
    audio: Buffer.from(await res.arrayBuffer()),
    requestId: res.headers.get('request-id'),
    // Det ElevenLabs faktiskt drog från kvoten
    credits: Number(res.headers.get('character-cost')) || text.length,
  };
}

function ttsErrorMessage(status: number, detail: string): string {
  if (status === 401) return 'ElevenLabs-nyckeln godtogs inte (kontrollera nyckeln i Railway)';
  if (status === 429) return 'ElevenLabs hann inte med fler anrop just då - försök igen om en stund';
  if (status >= 500) return 'ElevenLabs hade ett tillfälligt fel - försök igen om en stund';
  return `ElevenLabs svarade ${status}${detail ? `: ${detail.slice(0, 200)}` : ''}`;
}

// Varje bit från ElevenLabs är en egen mp3-fil med ID3-tagg och en Info-ruta som
// anger bitens längd. Hopsatta som de är kan en spelare tro att filen är lika lång
// som första biten. Utan dem blir filen en ren ström som alla spelare räknar rätt på.
export function stripMp3Headers(mp3: Buffer): Buffer {
  let offset = 0;
  if (mp3.length > 10 && mp3.toString('latin1', 0, 3) === 'ID3') {
    const size = ((mp3[6] & 0x7f) << 21) | ((mp3[7] & 0x7f) << 14) | ((mp3[8] & 0x7f) << 7) | (mp3[9] & 0x7f);
    offset = 10 + size + ((mp3[5] & 0x10) ? 10 : 0);
  }
  // Första ramen: hoppa över den om den bara bär en Xing/Info-rubrik
  if (offset + 4 < mp3.length && mp3[offset] === 0xff && (mp3[offset + 1] & 0xe0) === 0xe0) {
    const header = mp3.readUInt32BE(offset);
    const versionBits = (header >> 19) & 3; // 3 = MPEG1
    const bitrateIndex = (header >> 12) & 15;
    const rateIndex = (header >> 10) & 3;
    const padding = (header >> 9) & 1;
    const mono = ((header >> 6) & 3) === 3;
    const mpeg1 = versionBits === 3;
    const bitrates = mpeg1
      ? [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0]
      : [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];
    const rates = mpeg1 ? [44100, 48000, 32000] : versionBits === 2 ? [22050, 24000, 16000] : [11025, 12000, 8000];
    const bitrate = bitrates[bitrateIndex] * 1000;
    const rate = rates[rateIndex];
    if (bitrate && rate) {
      const frameLength = Math.floor(((mpeg1 ? 144 : 72) * bitrate) / rate) + padding;
      const sideInfo = mpeg1 ? (mono ? 17 : 32) : (mono ? 9 : 17);
      const tag = mp3.toString('latin1', offset + 4 + sideInfo, offset + 8 + sideInfo);
      if (tag === 'Xing' || tag === 'Info') offset += frameLength;
    }
  }
  return offset > 0 && offset < mp3.length ? mp3.subarray(offset) : mp3;
}

export interface TakeChunk {
  text: string;
  audio: Buffer;
  requestId: string | null;
}

export interface Take {
  audio: Buffer;
  chunks: TakeChunk[];
  // ElevenLabs id för varje bit i ordning - nästa kapitel kan läsas "efter" dem
  requestIds: string[];
  // Krediter som gick åt, även för bitar som lästes om
  credits: number;
}

function assemble(chunks: TakeChunk[], credits: number): Take {
  return {
    audio: Buffer.concat(chunks.map(c => c.audio)),
    chunks,
    requestIds: chunks.map(c => c.requestId).filter((id): id is string => !!id),
    credits,
  };
}

type TakeOptions = { settings?: VoiceSettingsVersion; previousRequestIds?: string[]; nextRequestIds?: string[] };

/**
 * Läser upp ett avsnitt i bitar. Varje bit lyssnar på bitarna före, och första
 * biten på slutet av förra kapitlet (om det lästes in nyss), så att rösten
 * håller samma ton genom hela boken.
 */
export async function synthesizeTake(text: string, voiceId = DEFAULT_VOICE_ID, quality: TtsQuality = 'best', options: TakeOptions = {}): Promise<Take> {
  const settings = options.settings ?? CURRENT_VOICE_SETTINGS;
  const texts = chunkText(text);
  const chunks: TakeChunk[] = [];
  let credits = 0;
  for (let i = 0; i < texts.length; i++) {
    const earlier = [...(options.previousRequestIds || []), ...chunks.map(c => c.requestId).filter((id): id is string => !!id)];
    const result = await speak(texts[i], voiceId, {
      before: texts[i - 1],
      after: texts[i + 1],
      previousRequestIds: earlier.slice(-3),
      nextRequestIds: i === texts.length - 1 ? options.nextRequestIds : undefined,
    }, quality, settings);
    chunks.push({ text: texts[i], audio: stripMp3Headers(result.audio), requestId: result.requestId });
    credits += result.credits;
  }
  return assemble(chunks, credits);
}

/** Läser om en bit i en tagning, med bitarna runt omkring som sammanhang. */
export async function rereadChunk(take: Take, index: number, voiceId: string, quality: TtsQuality, options: TakeOptions = {}): Promise<Take> {
  const settings = options.settings ?? CURRENT_VOICE_SETTINGS;
  const ids = (list: TakeChunk[]) => list.map(c => c.requestId).filter((id): id is string => !!id);
  const before = [...(options.previousRequestIds || []), ...ids(take.chunks.slice(0, index))];
  const after = [...ids(take.chunks.slice(index + 1)), ...(options.nextRequestIds || [])];
  const result = await speak(take.chunks[index].text, voiceId, {
    before: take.chunks[index - 1]?.text,
    after: take.chunks[index + 1]?.text,
    previousRequestIds: before.slice(-3),
    nextRequestIds: after.slice(0, 3),
  }, quality, settings);
  const chunks = take.chunks.map((c, i) => (i === index ? { text: c.text, audio: stripMp3Headers(result.audio), requestId: result.requestId } : c));
  return assemble(chunks, take.credits + result.credits);
}

/** Läser upp en text och ger tillbaka en mp3. Långa texter läses i bitar. */
export async function synthesize(text: string, voiceId = DEFAULT_VOICE_ID, quality: TtsQuality = 'best'): Promise<Buffer> {
  return (await synthesizeTake(text, voiceId, quality)).audio;
}

// Kort mening att välja röst på. Samma text för alla röster, så att de går att jämföra.
export const VOICE_SAMPLE_TEXT =
  'Hej! Det är jag som läser boken för dig. Vilja sjunker alltid åt vänster i vattnet, och det tycker hon är ganska tjatigt.';
