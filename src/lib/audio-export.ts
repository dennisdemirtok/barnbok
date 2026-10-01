// Export för utgivning (Spotify for Authors m.fl.): varje kapitel mastras till
// branschens ljudkrav, och boken får en M4B-fil med kapitelmarkeringar och ett
// kvadratiskt omslag i 3000×3000.
//
// Kraven (Spotify/ACX): mp3 192 kbit/s CBR, 44,1 kHz mono, toppar högst -3 dBFS,
// RMS mellan -23 och -18 dB, brusgolv under -60 dB.
import { spawn } from 'child_process';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { createHash } from 'crypto';

export const SPEC = { bitrate: 192, sampleRate: 44100, peakMax: -3, rmsMin: -23, rmsMax: -18, rmsTarget: -20 };

// Topparna får nå hit (-3,5 dBFS) - lite marginal till kravet på -3
const LIMIT_LINEAR = 0.668;

async function ffmpegPath(): Promise<string> {
  const mod = await import('ffmpeg-static');
  const p = (mod as unknown as { default?: string }).default ?? (mod as unknown as string);
  if (!p) throw new Error('ffmpeg saknas på servern');
  return p;
}

function run(args: string[]): Promise<string> {
  return ffmpegPath().then(bin => new Promise((resolve, reject) => {
    const proc = spawn(bin, ['-hide_banner', '-nostdin', ...args]);
    let stderr = '';
    proc.stderr.on('data', d => { stderr += d.toString(); if (stderr.length > 200_000) stderr = stderr.slice(-100_000); });
    proc.on('error', reject);
    proc.on('close', code => (code === 0 ? resolve(stderr) : reject(new Error(`ffmpeg avslutade med ${code}: ${stderr.slice(-400)}`))));
  }));
}

export interface LevelStats { rms: number; peak: number; seconds: number }

async function measure(file: string): Promise<LevelStats> {
  const out = await run(['-i', file, '-af', 'astats=measure_overall=RMS_level+Peak_level:measure_perchannel=none', '-f', 'null', '-']);
  const num = (re: RegExp) => { const m = out.match(re); return m ? parseFloat(m[1]) : NaN; };
  const d = out.match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/);
  return {
    rms: num(/RMS level dB: (-?[\d.]+|-inf)/),
    peak: num(/Peak level dB: (-?[\d.]+|-inf)/),
    seconds: d ? parseInt(d[1], 10) * 3600 + parseInt(d[2], 10) * 60 + parseFloat(d[3]) : 0,
  };
}

/** Mastrar ett kapitel: ljudnivå, toppbegränsning, lite tystnad före och efter, 192 kbit/s. */
async function masterFile(input: string, output: string): Promise<LevelStats> {
  const before = await measure(input);
  let gain = SPEC.rmsTarget - before.rms;
  let stats: LevelStats = before;
  // Begränsaren sänker RMS något - justera en gång om nivån hamnar för lågt
  for (let pass = 0; pass < 2; pass++) {
    await run([
      '-y', '-i', input,
      '-af', `highpass=f=70,volume=${gain.toFixed(2)}dB,alimiter=limit=${LIMIT_LINEAR}:level=disabled,adelay=700:all=1,apad=pad_dur=2`,
      '-ar', String(SPEC.sampleRate), '-ac', '1', '-c:a', 'libmp3lame', '-b:a', `${SPEC.bitrate}k`,
      output,
    ]);
    stats = await measure(output);
    if (stats.rms >= SPEC.rmsTarget - 1.5) break;
    gain += SPEC.rmsTarget - stats.rms;
  }
  return stats;
}

// Kvadratiskt omslag 3000×3000. Stående omslag läggs mitt på en suddig
// förstoring av sig själv, så att inget av bilden skärs bort.
async function squareCover(image: Buffer): Promise<Buffer> {
  const sharp = (await import('sharp')).default;
  const meta = await sharp(image).metadata();
  const size = 3000;
  if (meta.width && meta.height && Math.abs(meta.width - meta.height) / Math.max(meta.width, meta.height) < 0.02) {
    return sharp(image).resize(size, size, { kernel: 'lanczos3' }).jpeg({ quality: 92 }).toBuffer();
  }
  const background = await sharp(image).resize(size, size, { fit: 'cover' }).blur(40).modulate({ brightness: 0.85 }).toBuffer();
  const front = await sharp(image).resize(size, size, { fit: 'inside', kernel: 'lanczos3' }).toBuffer();
  return sharp(background).composite([{ input: front, gravity: 'center' }]).jpeg({ quality: 92 }).toBuffer();
}

const safeName = (text: string) => text.replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Kapitel';

// Molnet tillåter bara enkla tecken i sökvägar - filen får sitt riktiga namn vid nedladdning
const storageKey = (text: string) => text
  .toLowerCase()
  .replace(/[åä]/g, 'a').replace(/ö/g, 'o').replace(/[éè]/g, 'e').replace(/ü/g, 'u')
  .replace(/[^a-z0-9.]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 80) || 'fil';

export interface ExportChapterInput { index: number; label: string; url: string }

export interface ExportFile { name: string; path: string; bytes: number; seconds?: number; rms?: number; peak?: number }

export interface ExportResult {
  files: ExportFile[]; // ett mp3 per kapitel
  m4b?: ExportFile;
  cover?: ExportFile;
  seconds: number;
  specOk: boolean;
}

/**
 * Mastrar alla kapitel och bygger M4B och omslag. Filerna laddas upp med
 * `upload` (sökväg, innehåll, typ) - funktionen bryr sig inte om var de hamnar.
 */
export async function buildRelease(input: {
  title: string;
  author?: string;
  narrator: string;
  chapters: ExportChapterInput[];
  coverUrl?: string;
  folder: string;
  upload: (filePath: string, data: Buffer, contentType: string) => Promise<string | null>;
  onProgress?: (done: number, total: number) => void;
}): Promise<ExportResult> {
  const dir = await mkdtemp(path.join(tmpdir(), 'ljudbok-'));
  try {
    const files: ExportFile[] = [];
    const mastered: { file: string; title: string; seconds: number }[] = [];
    const total = input.chapters.length + 1;
    for (let i = 0; i < input.chapters.length; i++) {
      const chapter = input.chapters[i];
      const source = path.join(dir, `in-${i}.mp3`);
      const target = path.join(dir, `out-${i}.mp3`);
      const res = await fetch(chapter.url, { cache: 'no-store' });
      if (!res.ok) throw new Error(`Kunde inte hämta ${chapter.label}`);
      await writeFile(source, Buffer.from(await res.arrayBuffer()));
      const stats = await masterFile(source, target);
      const data = await readFile(target);
      const name = `${String(i + 1).padStart(2, '0')} - ${safeName(chapter.label)}.mp3`;
      const filePath = `${input.folder}/${storageKey(name)}`;
      if (!(await input.upload(filePath, data, 'audio/mpeg'))) throw new Error(`Kunde inte spara ${name}`);
      files.push({ name, path: filePath, bytes: data.length, seconds: stats.seconds, rms: stats.rms, peak: stats.peak });
      mastered.push({ file: target, title: chapter.label, seconds: stats.seconds });
      input.onProgress?.(i + 1, total);
    }

    // Omslag
    let cover: ExportFile | undefined;
    let coverFile: string | undefined;
    if (input.coverUrl) {
      const res = await fetch(input.coverUrl, { cache: 'no-store' }).catch(() => null);
      if (res?.ok) {
        const data = await squareCover(Buffer.from(await res.arrayBuffer()));
        coverFile = path.join(dir, 'omslag.jpg');
        await writeFile(coverFile, data);
        const filePath = `${input.folder}/omslag.jpg`;
        if (await input.upload(filePath, data, 'image/jpeg')) cover = { name: 'omslag.jpg', path: filePath, bytes: data.length };
      }
    }

    // M4B: alla kapitel i en fil med kapitelmarkeringar (och omslaget inbäddat)
    const list = path.join(dir, 'list.txt');
    await writeFile(list, mastered.map(m => `file '${m.file.replace(/'/g, "'\\''")}'`).join('\n'));
    let start = 0;
    const esc = (s: string) => s.replace(/([=;#\\\n])/g, '\\$1');
    const meta = [
      ';FFMETADATA1',
      `title=${esc(input.title)}`,
      `album=${esc(input.title)}`,
      `artist=${esc(input.author || input.narrator)}`,
      `composer=${esc(input.narrator)}`,
      'genre=Audiobook',
      ...mastered.flatMap(m => {
        const end = start + Math.round(m.seconds * 1000);
        const block = ['[CHAPTER]', 'TIMEBASE=1/1000', `START=${start}`, `END=${end}`, `title=${esc(m.title)}`];
        start = end;
        return block;
      }),
    ].join('\n');
    const metaFile = path.join(dir, 'meta.txt');
    await writeFile(metaFile, meta);
    const m4bFile = path.join(dir, 'bok.m4b');
    // Molnet tar filer upp till 50 MB: långa böcker får lägre bithastighet i M4B:n
    // (tal låter bra ner till 48 kbit/s i AAC). Ryms den inte alls hoppas den över.
    const totalSeconds = start / 1000;
    const fitKbps = Math.floor((46 * 1024 * 1024 * 8) / Math.max(totalSeconds, 1) / 1000);
    const m4bKbps = Math.min(96, fitKbps);
    if (m4bKbps < 48) {
      input.onProgress?.(total, total);
      const specOkShort = files.every(f => typeof f.rms === 'number' && typeof f.peak === 'number' && f.rms >= SPEC.rmsMin && f.rms <= SPEC.rmsMax && f.peak <= SPEC.peakMax);
      return { files, cover, seconds: totalSeconds, specOk: specOkShort };
    }
    await run([
      '-y', '-f', 'concat', '-safe', '0', '-i', list, '-i', metaFile,
      ...(coverFile ? ['-i', coverFile] : []),
      '-map', '0:a', '-map_metadata', '1', '-map_chapters', '1',
      ...(coverFile ? ['-map', '2', '-c:v', 'mjpeg', '-disposition:v', 'attached_pic'] : []),
      '-c:a', 'aac', '-b:a', `${m4bKbps}k`, '-ac', '1', '-ar', String(SPEC.sampleRate), '-movflags', '+faststart',
      '-f', 'mp4', m4bFile,
    ]);
    const m4bData = await readFile(m4bFile);
    const m4bName = `${safeName(input.title)}.m4b`;
    const m4bPath = `${input.folder}/${storageKey(m4bName)}`;
    const m4b = (await input.upload(m4bPath, m4bData, 'audio/mp4'))
      ? { name: m4bName, path: m4bPath, bytes: m4bData.length, seconds: start / 1000 }
      : undefined;
    input.onProgress?.(total, total);

    const specOk = files.every(f =>
      typeof f.rms === 'number' && typeof f.peak === 'number' &&
      f.rms >= SPEC.rmsMin && f.rms <= SPEC.rmsMax && f.peak <= SPEC.peakMax);
    return { files, m4b, cover, seconds: start / 1000, specOk };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Fingeravtryck av ljudbokens delar - en ny inläsning gör exporten inaktuell. */
export function releaseVersion(urls: string[]): string {
  return createHash('sha1').update(urls.join('|')).digest('hex').slice(0, 10);
}
