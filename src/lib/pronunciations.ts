// Bokens uttalslista sparas som en liten fil bredvid ljudboken i molnet,
// så att ingen databasändring behövs.
import { serverSupabase, SERVER_IMAGES_BUCKET } from './supabase-server';
import { PronunciationRule } from './tts';

const path = (bookId: string) => `books/${bookId}/audio/uttal.json`;
const MAX_RULES = 200;

export async function loadPronunciations(bookId: string): Promise<PronunciationRule[]> {
  const db = serverSupabase();
  const url = db.storage.from(SERVER_IMAGES_BUCKET).getPublicUrl(path(bookId)).data.publicUrl;
  const res = await fetch(`${url}?t=${Date.now()}`, { cache: 'no-store' }).catch(() => null);
  if (!res?.ok) return [];
  const data = await res.json().catch(() => null) as { rules?: PronunciationRule[] } | null;
  return cleanRules(data?.rules ?? []);
}

export async function savePronunciations(bookId: string, rules: PronunciationRule[]): Promise<PronunciationRule[]> {
  const clean = cleanRules(rules);
  const db = serverSupabase();
  const body = Buffer.from(JSON.stringify({ rules: clean, updatedAt: new Date().toISOString() }));
  const { error } = await db.storage.from(SERVER_IMAGES_BUCKET).upload(path(bookId), body, {
    contentType: 'application/json',
    upsert: true,
    cacheControl: '0',
  });
  if (error) throw new Error(`Uttalslistan kunde inte sparas: ${error.message}`);
  return clean;
}

function cleanRules(rules: unknown[]): PronunciationRule[] {
  const seen = new Set<string>();
  const out: PronunciationRule[] = [];
  for (const raw of rules) {
    const r = raw as Partial<PronunciationRule>;
    const word = String(r?.word ?? '').trim().slice(0, 60);
    const sayAs = String(r?.sayAs ?? '').trim().slice(0, 80);
    if (!word || !sayAs || seen.has(word.toLowerCase())) continue;
    seen.add(word.toLowerCase());
    out.push({ word, sayAs });
    if (out.length >= MAX_RULES) break;
  }
  return out;
}
