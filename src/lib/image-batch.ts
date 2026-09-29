// Sparläget: bilderna läggs i Googles batchkö i stället för att beställas en
// och en. Det kostar hälften, men Google levererar när det finns plats -
// oftast inom några minuter, som längst ett dygn. Granskning och ev. rättelser
// görs sedan direkt, så att boken blir klar så fort batchen är levererad.
import { GoogleGenAI } from '@google/genai';
import { Character } from './types';
import { ImagePart, PageImageRequest, currentImageModel } from './gemini';

let client: GoogleGenAI | null = null;
function ai(): GoogleGenAI {
  if (!client) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY saknas');
    client = new GoogleGenAI({ apiKey });
  }
  return client;
}

// Uppladdade referensblad. Google sparar filer i 48 timmar - de laddas upp på
// nytt om de hunnit bli för gamla när en ny batch ska skickas.
export interface UploadedRef { uri: string; mimeType: string; expiresAt: number }
const FILE_LIFETIME_MS = 47 * 60 * 60 * 1000;
const REUPLOAD_MARGIN_MS = 6 * 60 * 60 * 1000;

export async function uploadReferenceSheets(
  characters: Character[],
  existing: Record<string, UploadedRef> = {},
): Promise<Record<string, UploadedRef>> {
  const out: Record<string, UploadedRef> = { ...existing };
  for (const c of characters) {
    if (!c.referenceImage || !c.approved) continue;
    const known = out[c.id];
    if (known && known.expiresAt - Date.now() > REUPLOAD_MARGIN_MS) continue;
    const bytes = Buffer.from(c.referenceImage, 'base64');
    const mimeType = imageMimeType(c.referenceImage);
    const file = await ai().files.upload({
      file: new Blob([bytes], { type: mimeType }),
      config: { mimeType, displayName: `barnbok-ref-${c.id}` },
    });
    if (!file.uri) throw new Error(`Referensbladet för ${c.name} kunde inte laddas upp`);
    out[c.id] = { uri: file.uri, mimeType, expiresAt: Date.now() + FILE_LIFETIME_MS };
  }
  return out;
}

export function fileReference(refs: Record<string, UploadedRef>) {
  return (char: Character): ImagePart => {
    const ref = refs[char.id];
    // Saknas filen (t.ex. en ny figur) skickas bladet med som bild i stället
    return ref
      ? { fileData: { fileUri: ref.uri, mimeType: ref.mimeType } }
      : { inlineData: { mimeType: 'image/png', data: char.referenceImage! } };
  };
}

export async function submitImageBatch(requests: PageImageRequest[], displayName: string, model = currentImageModel()): Promise<string> {
  const job = await ai().batches.create({
    model,
    src: requests.map(r => ({
      contents: [{ role: 'user', parts: r.contents }],
      config: {
        responseModalities: ['TEXT', 'IMAGE'],
        imageConfig: { aspectRatio: r.aspectRatio, imageSize: r.imageSize },
      },
    })),
    config: { displayName: displayName.slice(0, 120) },
  });
  if (!job.name) throw new Error('Google gav inget namn på batchen');
  return job.name;
}

export type BatchState = 'pending' | 'running' | 'succeeded' | 'failed';

export interface BatchResult {
  state: BatchState;
  // Ett svar per beställning, i samma ordning som de skickades
  responses?: ({ response?: unknown; error?: string })[];
  message?: string;
}

export async function checkImageBatch(name: string): Promise<BatchResult> {
  const job = await ai().batches.get({ name });
  switch (job.state) {
    case 'JOB_STATE_PENDING':
    case 'JOB_STATE_QUEUED':
      return { state: 'pending' };
    case 'JOB_STATE_RUNNING':
      return { state: 'running' };
    case 'JOB_STATE_SUCCEEDED':
      return {
        state: 'succeeded',
        responses: (job.dest?.inlinedResponses || []).map(r => ({
          response: r.response,
          error: r.error ? JSON.stringify(r.error).slice(0, 300) : undefined,
        })),
      };
    default:
      return { state: 'failed', message: `${job.state}${job.error ? `: ${JSON.stringify(job.error).slice(0, 200)}` : ''}` };
  }
}

// Bildformat utifrån filens första bytes (batchen levererar JPEG, direktanrop ofta PNG)
export function imageMimeType(base64: string): string {
  if (base64.startsWith('/9j/')) return 'image/jpeg';
  if (base64.startsWith('iVBOR')) return 'image/png';
  if (base64.startsWith('UklGR')) return 'image/webp';
  return 'image/png';
}

export async function cancelImageBatch(name: string): Promise<void> {
  await ai().batches.cancel({ name }).catch(() => undefined);
}
