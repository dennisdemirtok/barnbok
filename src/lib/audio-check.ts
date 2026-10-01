// Mätning av ett uppläst ljud: brusgolvet i pauserna. Ett kapitel (eller en bit)
// som brusar mer än resten av boken låter "annorlunda" och läses om.
// Mätt på riktiga inläsningar: rena tagningar ligger runt -86 till -91 dB,
// en tagning med hörbart brus låg på -75 dB.

export interface AudioCheck {
  floor: number; // brusgolv i dB (tystaste tiondelen av ljudet)
  seconds: number;
}

// Över den här nivån hörs brus i pauserna
export const NOISE_LIMIT_DB = -80;

const db = (x: number) => 20 * Math.log10(Math.max(x, 1e-9));

export async function analyzeMp3(mp3: Buffer): Promise<AudioCheck | null> {
  try {
    const { MPEGDecoder } = await import('mpg123-decoder');
    const decoder = new MPEGDecoder();
    await decoder.ready;
    try {
      const { channelData, sampleRate } = decoder.decode(new Uint8Array(mp3));
      const samples = channelData[0];
      if (!samples || samples.length < sampleRate) return null;
      const win = Math.round(sampleRate * 0.05);
      const n = Math.floor(samples.length / win);
      const rms: number[] = [];
      for (let i = 0; i < n; i++) {
        let sum = 0;
        for (let j = i * win; j < (i + 1) * win; j++) sum += samples[j] * samples[j];
        rms.push(Math.sqrt(sum / win));
      }
      rms.sort((a, b) => a - b);
      return { floor: db(rms[Math.floor(n * 0.1)]), seconds: samples.length / sampleRate };
    } finally {
      decoder.free();
    }
  } catch (err) {
    console.warn('[Ljud] kunde inte mäta ljudet:', err instanceof Error ? err.message : err);
    return null;
  }
}

/** Brusar ljudet: över gränsen, eller tydligt mer än bokens andra kapitel. */
export function isNoisy(check: AudioCheck, otherFloors: number[] = []): boolean {
  if (check.floor > NOISE_LIMIT_DB) return true;
  if (otherFloors.length === 0) return false;
  const sorted = [...otherFloors].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  return check.floor > median + 6;
}
