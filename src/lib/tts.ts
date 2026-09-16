// Ljudbok: gör om bokens text till uppläst ljud med ElevenLabs.
//
// Texten delas i avsnitt (kapitel), och varje avsnitt läses i bitar som hålls
// ihop av previous_text/next_text så att rösten behåller tonen över skarvarna.
import { BookProject, Spread } from './types';
import { DEFAULT_VOICE_ID } from './tts-voices';

const API = 'https://api.elevenlabs.io/v1/text-to-speech';

// Två lägen: bästa uttalet, eller den snabbare modellen som bara kostar halva
// kvoten hos ElevenLabs (bra när man vill hinna med fler böcker i månaden).
export type TtsQuality = 'best' | 'economy';
const MODELS: Record<TtsQuality, string> = {
  best: 'eleven_multilingual_v2',
  economy: 'eleven_turbo_v2_5',
};
// Hur mycket av kvoten en bokstav kostar i respektive läge
export const CREDIT_FACTOR: Record<TtsQuality, number> = { best: 1, economy: 0.5 };
// Max tecken per anrop. Kortare bitar ger snabbare svar och mindre att göra om
const CHUNK_CHARS = 2200;
const REQUEST_TIMEOUT_MS = 120_000;

export interface NarrationSegment {
  index: number;
  label: string; // "Kapitel 3" eller "Början"
  text: string;
}

export function hasTtsKey(): boolean {
  return !!process.env.ELEVENLABS_API_KEY;
}

// ── Texten som ska läsas ──

const CHAPTER_RE = /^(kapitel\s+[\wåäö]+|prolog|epilog|förord|efterord)\b/i;

// Talstreck och radbrytningar ska inte läsas upp som tecken
function forNarration(line: string): string {
  return line
    .replace(/^\s*[-–—*]\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function spreadLines(spread: Spread): string[] {
  return spread.textBlocks
    .map(b => b.text)
    .join('\n')
    .split('\n')
    .map(forNarration)
    .filter(Boolean);
}

/**
 * Delar boken i uppläsningsavsnitt. Kapitelböcker delas per kapitel, bilderböcker
 * i lagom långa stycken. Titel och författare läses först.
 */
export function narrationSegments(book: BookProject): NarrationSegment[] {
  const segments: NarrationSegment[] = [];
  let current: string[] = [];
  let label = 'Början';

  const push = () => {
    const text = current.join('\n\n').trim();
    if (text) segments.push({ index: segments.length, label, text });
    current = [];
  };

  const intro = [book.title, book.author ? `av ${book.author}` : ''].filter(Boolean).join('. ');
  current.push(intro);

  for (const spread of book.spreads) {
    if (spread.pages === 'omslag') continue;
    for (const line of spreadLines(spread)) {
      if (CHAPTER_RE.test(line) && line.length <= 80) {
        push();
        label = line.replace(/\s*[-–—:.]\s*/, ': ').trim();
        current.push(label);
        continue;
      }
      current.push(line);
    }
    // Bilderbok utan kapitel: dela i avsnitt som inte blir orimligt långa
    if (current.join(' ').length > 6000) {
      push();
      label = `Del ${segments.length + 1}`;
    }
  }
  push();
  // Ett pyttelitet avsnitt (bara titeln, eller en rubrik utan text) blir inget
  // eget spår - det läggs ihop med nästa så att spellistan blir vettig
  const merged: NarrationSegment[] = [];
  for (const segment of segments) {
    const previous = merged[merged.length - 1];
    if (previous && previous.text.split(/\s+/).length < 30) {
      merged[merged.length - 1] = { ...previous, label: segment.label, text: `${previous.text}\n\n${segment.text}` };
      continue;
    }
    merged.push(segment);
  }
  return merged.map((seg, i) => ({ ...seg, index: i }));
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

async function speak(text: string, voiceId: string, around: { before?: string; after?: string }, quality: TtsQuality): Promise<Buffer> {
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
    throw new Error(ttsErrorMessage(res.status, detail));
  }
  return Buffer.from(await res.arrayBuffer());
}

function ttsErrorMessage(status: number, detail: string): string {
  if (status === 401) return 'ElevenLabs-nyckeln godtogs inte (kontrollera nyckeln i Railway)';
  if (status === 429) return 'ElevenLabs säger stopp för tillfället (för många anrop) - försök igen om en stund';
  if (status === 422 && /quota|credits/i.test(detail)) return 'Ljudkvoten hos ElevenLabs är slut för den här månaden';
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

// Grov speltid: uppläsning ligger runt 150 ord i minuten
export function estimateSeconds(text: string): number {
  return Math.round((text.split(/\s+/).filter(Boolean).length / 150) * 60);
}
