// Läser in ett kapitel med kvalitetskontroll: läs upp i bitar, mät bruset,
// korrekturlyssna, och läs om de bitar som har tydliga fel. Det som inte går att
// rätta med en ny tagning (ett namn som alltid sägs fel) blir förslag till
// bokens uttalslista.
import { analyzeMp3, isNoisy } from './audio-check';
import { chunkForIssue, needsRetake, isSystematic, proofreadAudio, ProofIssue } from './audio-proof';
import { rereadChunk, synthesizeTake, Take, TtsQuality, VoiceSettingsVersion } from './tts';

export interface ChapterQuality {
  // Brusgolv för hela kapitlet (dB)
  floor?: number;
  // Fel som finns kvar efter rättningarna - för författaren att lyssna på
  issues: ProofIssue[];
  // Om korrekturlyssningen kunde göras
  checked: boolean;
  // Hur många bitar som lästes om
  fixed: number;
  overall?: string;
}

export interface ChapterReading {
  take: Take;
  quality: ChapterQuality;
}

interface ReadOptions {
  spoken: string; // texten som läses (uttalslista och textförberedelse gjorda)
  original: string; // texten som den står i boken - korrekturlyssnaren jämför med den
  notes: string[]; // avsiktliga uttal ur uttalslistan
  voiceId: string;
  quality: TtsQuality;
  settings: VoiceSettingsVersion;
  previousRequestIds?: string[];
  nextRequestIds?: string[];
  otherFloors: number[]; // bokens andra kapitel
  maxRetakes?: number;
}

// Ungefärlig längd per bit: 128 kbit/s
const chunkSeconds = (take: Take) => take.chunks.map(c => (c.audio.length * 8) / 128_000);

async function chunkIssues(take: Take, index: number, notes: string[]): Promise<ProofIssue[] | null> {
  const result = await proofreadAudio(take.chunks[index].audio, take.chunks[index].text, notes);
  return result ? result.issues.filter(i => needsRetake(i, result.issues)) : null;
}

export async function readChapter(options: ReadOptions): Promise<ChapterReading> {
  const stitching = { settings: options.settings, previousRequestIds: options.previousRequestIds, nextRequestIds: options.nextRequestIds };
  let take = await synthesizeTake(options.spoken, options.voiceId, options.quality, stitching);

  // 1. Brus: mät varje bit, så att just den bit som brusar kan läsas om
  const floors = await Promise.all(take.chunks.map(c => analyzeMp3(c.audio)));
  // 2. Korrekturlyssna hela kapitlet mot bokens text
  let proof = await proofreadAudio(take.audio, options.original, options.notes);

  const retake = new Map<number, string>();
  floors.forEach((check, i) => {
    if (check && isNoisy(check, options.otherFloors)) retake.set(i, `brus (${check.floor.toFixed(0)} dB)`);
  });
  for (const issue of proof?.issues || []) {
    if (!needsRetake(issue, proof!.issues)) continue;
    const i = chunkForIssue(issue, take.chunks.map(c => c.text), chunkSeconds(take));
    if (i >= 0 && !retake.has(i)) retake.set(i, `${issue.kind} "${issue.word}"`);
  }

  // 3. Läs om de bitar som har fel - högst några per kapitel, så att ett
  // överivrigt utslag aldrig kostar en hel bok
  let fixed = 0;
  const maxRetakes = options.maxRetakes ?? 2;
  for (const [index, reason] of Array.from(retake.entries()).slice(0, maxRetakes)) {
    console.log(`[Korrektur] läser om bit ${index + 1} av ${take.chunks.length}: ${reason}`);
    const before = await chunkIssues(take, index, options.notes);
    const candidate = await rereadChunk(take, index, options.voiceId, options.quality, stitching);
    const [after, oldFloor, newFloor] = await Promise.all([
      chunkIssues(candidate, index, options.notes),
      analyzeMp3(take.chunks[index].audio),
      analyzeMp3(candidate.chunks[index].audio),
    ]);
    // Den nya tagningen behålls om den har färre fel, eller lika många men mindre brus
    const oldCount = before?.length ?? 1;
    const newCount = after?.length ?? oldCount;
    const quieter = !!(oldFloor && newFloor && newFloor.floor < oldFloor.floor - 1);
    if (newCount < oldCount || (newCount === oldCount && quieter)) {
      take = candidate;
      fixed++;
    } else {
      // Krediterna för försöket räknas ändå
      take = { ...take, credits: candidate.credits };
    }
  }

  // 4. Lyssna igenom en gång till om något lästes om, så att felen och tiderna stämmer
  if (fixed > 0) proof = (await proofreadAudio(take.audio, options.original, options.notes)) ?? proof;
  const whole = await analyzeMp3(take.audio);

  const issues = (proof?.issues || []).filter(i => i.severity === 'major' || isSystematic(i, proof!.issues));
  return {
    take,
    quality: {
      floor: whole?.floor,
      issues,
      checked: !!proof,
      fixed,
      overall: proof?.overall,
    },
  };
}
