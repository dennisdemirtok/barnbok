// Korrekturlyssning: Gemini lyssnar på uppläsningen och jämför ord för ord med
// texten, som en korrekturläsare på ett förlag. Felen får tid och mening, så att
// rätt bit kan läsas om och författaren kan lyssna själv.
import { GoogleGenAI } from '@google/genai';

export type ProofKind =
  | 'mispronounced'
  | 'cut_off_ending'
  | 'skipped'
  | 'added_or_repeated'
  | 'wrong_stress'
  | 'unclear'
  | 'noise_or_glitch'
  | 'odd_pause';

export interface ProofIssue {
  time: string; // mm:ss i ljudet
  word: string; // ordet eller orden ur texten
  sentence: string; // meningen ur texten
  heard: string; // hur det lät
  kind: ProofKind;
  severity: 'minor' | 'major';
  // Förslag på hur ordet kan skrivas för att låta rätt (för uttalslistan)
  sayAs?: string;
}

export interface ProofResult {
  issues: ProofIssue[];
  overall: string;
}

const MODELS = [process.env.GEMINI_PROOF_MODEL, 'gemini-flash-latest', 'gemini-3.8-flash', 'gemini-3.6-flash']
  .filter((m, i, arr): m is string => !!m && arr.indexOf(m) === i);

// Inline-ljud till Gemini får vara högst ungefär så här stort
const MAX_INLINE_BYTES = 18 * 1024 * 1024;

const SCHEMA = {
  type: 'object',
  properties: {
    issues: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          time: { type: 'string' },
          word: { type: 'string' },
          sentence: { type: 'string' },
          heard: { type: 'string' },
          kind: { type: 'string', enum: ['mispronounced', 'cut_off_ending', 'skipped', 'added_or_repeated', 'wrong_stress', 'unclear', 'noise_or_glitch', 'odd_pause'] },
          severity: { type: 'string', enum: ['minor', 'major'] },
          sayAs: { type: 'string' },
        },
        required: ['time', 'word', 'sentence', 'heard', 'kind', 'severity'],
      },
    },
    overall: { type: 'string' },
  },
  required: ['issues', 'overall'],
};

function prompt(text: string, notes: string[]): string {
  return `Du är en noggrann svensk korrekturlyssnare för en ljudbok som ska ges ut. Ljudet är en AI-uppläsning av texten nedan. Lyssna hela vägen och jämför ord för ord.

Rapportera VARJE ställe där uppläsningen avviker från hur en svensk professionell inläsare skulle läsa texten:
- mispronounced: ordet uttalas fel (fel vokal eller konsonant, engelskt eller utländskt uttal, ett annat ord)
- cut_off_ending: ordets slut sväljs, klipps av eller blir konstigt
- skipped: ett ord eller en del av texten läses inte
- added_or_repeated: något läses som inte står i texten, eller upprepas
- wrong_stress: fel betoning eller fel tonaccent
- unclear: mumlat eller svårt att uppfatta
- noise_or_glitch: brus, klick, sprak eller andra konstiga ljud
- odd_pause: onaturlig paus mitt i en mening

För varje fel: time (mm:ss i ljudet), word (ordet eller orden exakt som i texten), sentence (hela meningen exakt som i texten), heard (hur det lät), severity (major = en lyssnare märker det direkt, minor = knappt märkbart). Gäller felet ett namn eller ord som rösten verkar säga fel varje gång: ge sayAs, ett förslag på hur ordet kan stavas för att en svensk röst ska säga det rätt (t.ex. "Alli" för Allie).

Rapportera bara det du faktiskt hör - hitta inte på fel. En annan men korrekt läsart är inget fel. overall: en mening om helhetsintrycket.
${notes.length > 0 ? `\nAvsiktliga uttal (inte fel):\n${notes.map(n => `- ${n}`).join('\n')}\n` : ''}
TEXTEN:
"""
${text}
"""`;
}

/** Lyssnar igenom ett uppläst avsnitt. null om korrekturlyssningen inte gick att göra. */
export async function proofreadAudio(mp3: Buffer, text: string, notes: string[] = []): Promise<ProofResult | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || mp3.length > MAX_INLINE_BYTES || !text.trim()) return null;
  const ai = new GoogleGenAI({ apiKey });

  for (const model of MODELS) {
    // Tillfälliga fel (för många anrop, överbelastat) väntar och försöker igen -
    // annars blir kapitel okontrollerade bara för att anropen kom tätt
    for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await ai.models.generateContent({
        model,
        contents: [{
          role: 'user',
          parts: [
            { inlineData: { mimeType: 'audio/mpeg', data: mp3.toString('base64') } },
            { text: prompt(text, notes) },
          ],
        }],
        config: {
          responseMimeType: 'application/json',
          responseSchema: SCHEMA as never,
          temperature: 0.1,
          httpOptions: { timeout: 120_000 },
        },
      });
      const raw = JSON.parse(res.text || '{}') as Partial<ProofResult>;
      const issues = (raw.issues || []).filter(i => i && i.word && i.kind && i.severity);
      return { issues, overall: (raw.overall || '').trim() };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const transient = /429|RESOURCE_EXHAUSTED|503|UNAVAILABLE|500|INTERNAL|deadline|timed? ?out|fetch failed|ECONNRESET/i.test(message);
      console.warn(`[Korrektur] ${model} misslyckades (försök ${attempt + 1}):`, message.slice(0, 200));
      if (!transient || attempt === 2) break;
      await new Promise(resolve => setTimeout(resolve, attempt === 0 ? 8000 : 20000));
    }
    }
  }
  return null;
}

// Fel som en ny tagning kan rätta (en tillfällig felsägning, ett hack, brus).
// Ett namn som rösten säger fel varje gång rättas i stället i uttalslistan.
const RETAKE_KINDS: ProofKind[] = ['skipped', 'added_or_repeated', 'unclear', 'noise_or_glitch', 'cut_off_ending', 'odd_pause', 'mispronounced', 'wrong_stress'];

const normalizeWord = (w: string) => w.toLocaleLowerCase('sv-SE').replace(/[^a-zåäöéü0-9]+/g, ' ').trim();

/** Ord som rösten säger fel på flera ställen, eller namn: rättas med uttalslistan. */
export function isSystematic(issue: ProofIssue, all: ProofIssue[]): boolean {
  if (issue.kind !== 'mispronounced' && issue.kind !== 'wrong_stress') return false;
  const word = normalizeWord(issue.word);
  const repeated = all.filter(i => normalizeWord(i.word) === word).length >= 2;
  // Namn: stor bokstav mitt i meningen
  const sentence = issue.sentence.trim();
  const midSentence = sentence.length > 0 && !sentence.startsWith(issue.word.trim());
  const name = /^[A-ZÅÄÖ]/.test(issue.word.trim()) && midSentence;
  return repeated || name || !!issue.sayAs;
}

export function needsRetake(issue: ProofIssue, all: ProofIssue[]): boolean {
  return issue.severity === 'major' && RETAKE_KINDS.includes(issue.kind) && !isSystematic(issue, all);
}

// "02:47" -> 167 sekunder
export function issueSeconds(issue: ProofIssue): number | null {
  const m = issue.time.match(/(\d+):(\d{1,2})/);
  return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : null;
}

/** Vilken bit av uppläsningen felet ligger i: efter meningens ord, annars efter tiden. */
export function chunkForIssue(issue: ProofIssue, chunkTexts: string[], chunkSeconds: number[]): number {
  const words = normalizeWord(issue.sentence || issue.word).split(' ').filter(w => w.length > 2);
  if (words.length > 0) {
    let best = -1;
    let bestScore = 0;
    chunkTexts.forEach((text, i) => {
      const have = new Set(normalizeWord(text).split(' '));
      const score = words.filter(w => have.has(w)).length / words.length;
      if (score > bestScore) { bestScore = score; best = i; }
    });
    if (best >= 0 && bestScore >= 0.6) return best;
  }
  const at = issueSeconds(issue);
  if (at !== null) {
    let start = 0;
    for (let i = 0; i < chunkSeconds.length; i++) {
      if (at < start + chunkSeconds[i]) return i;
      start += chunkSeconds[i];
    }
  }
  return -1;
}
