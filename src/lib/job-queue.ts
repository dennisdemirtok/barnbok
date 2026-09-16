// Bildjobb i bakgrunden.
//
// Webbläsaren startar ett jobb och får ett id. Servern jobbar vidare även om
// användaren stänger sidan: varje uppslag hämtas ur kön, illustreras med samma
// granskningsloop som tidigare, laddas upp till Supabase Storage och bockas av.
// Startar servern om mitt i tas påbörjade uppslag tillbaka efter tio minuter.
import { serverSupabase, SERVER_IMAGES_BUCKET } from './supabase-server';
import { generatePageWithQualityCheck, DEFAULT_QUALITY_BUDGET_MS } from './character-check';
import { BookFormat, Character, IllustrationShape, Spread, SpreadQualityCheck } from './types';

// Så många uppslag illustreras samtidigt. Servern väntar inte på ett svar till
// webbläsaren längre, så det här handlar bara om Geminis takt.
const WORKERS = 4;
// Ett uppslag får ta så här lång tid (bild + granskning + rättningar)
const ITEM_BUDGET_MS = DEFAULT_QUALITY_BUDGET_MS;
// Jobb vars puls är äldre än så här anses ha dött med en omstart
const STALE_MS = 3 * 60 * 1000;

export interface JobItemView {
  spreadId: string;
  spreadNumber: number;
  label: string;
  status: 'queued' | 'running' | 'done' | 'error';
  imageUrl?: string;
  quality?: SpreadQualityCheck;
  error?: string;
}

export interface JobView {
  id: string;
  bookId: string;
  status: 'running' | 'done' | 'failed' | 'canceled';
  total: number;
  done: number;
  failed: number;
  message?: string;
  updatedAt: string;
  items: JobItemView[];
}

type SpreadWithUrl = Spread & { imageUrl?: string };

interface BookForJob {
  id: string;
  styleGuide: string;
  bookFormat?: BookFormat;
  illustrationShape?: IllustrationShape;
  characters: Character[];
  spreads: SpreadWithUrl[];
}

// Jobb som körs i den här processen just nu
const running = new Set<string>();

const MISSING_TABLES = 'Bakgrundsjobben är inte påslagna i databasen än - kör scripts/illustration-jobs.sql i Supabase';

function missingTables(message?: string): boolean {
  return !!message && /barnbok_jobs|barnbok_job_items|barnbok_claim_job_item|schema cache/i.test(message);
}

// ── Läsa boken som servern ska illustrera ──

export async function loadBookForJob(bookId: string): Promise<BookForJob | null> {
  const db = serverSupabase();
  const { data: bookRow, error } = await db.from('barnbok_books').select('*').eq('id', bookId).single();
  if (error || !bookRow) return null;

  const [{ data: charRows }, { data: spreadRows }] = await Promise.all([
    db.from('barnbok_characters').select('*').eq('book_id', bookId).order('sort_order'),
    db.from('barnbok_spreads').select('*').eq('book_id', bookId).order('sort_order'),
  ]);

  const spreadIds = (spreadRows || []).map(s => s.id);
  let textRows: { spread_id: string; text_content: string; position: number }[] = [];
  if (spreadIds.length > 0) {
    const { data } = await db.from('barnbok_text_blocks').select('*').in('spread_id', spreadIds).order('position');
    textRows = data || [];
  }

  let meta: { illustrationShape?: IllustrationShape; compositions?: Record<string, Spread['composition']> } = {};
  if (typeof bookRow.theme === 'string' && bookRow.theme.startsWith('{')) {
    try { meta = JSON.parse(bookRow.theme); } catch { meta = {}; }
  }

  const characters: Character[] = (charRows || []).map(c => ({
    id: c.id,
    name: c.name,
    appearance: c.appearance || '',
    role: (c.role === 'villain' ? 'supporting' : c.role) as Character['role'],
    approved: c.approved,
    age: c.age || undefined,
    normalClothes: c.normal_clothes || undefined,
    personality: c.personality || undefined,
    heroName: c.hero_name || undefined,
    heroCostume: c.hero_costume || undefined,
    power: c.power || undefined,
    referenceImageUrl: c.reference_image_url || undefined,
    faceNotes: c.face_notes || undefined,
  }));

  const spreads: SpreadWithUrl[] = (spreadRows || []).map(s => ({
    id: s.id,
    spreadNumber: s.spread_number,
    pages: s.pages,
    chapter: s.chapter || undefined,
    composition: meta.compositions?.[String(s.spread_number)],
    textBlocks: textRows
      .filter(tb => tb.spread_id === s.id)
      .map(tb => ({ position: `position-${tb.position}`, text: tb.text_content })),
    imagePrompt: s.image_prompt || '',
    status: (s.image_url ? 'done' : 'pending') as Spread['status'],
    imageUrl: s.image_url || undefined,
  } as SpreadWithUrl));

  return {
    id: bookId,
    styleGuide: bookRow.style || '',
    bookFormat: bookRow.book_format as BookFormat | undefined,
    illustrationShape: meta.illustrationShape,
    characters,
    spreads,
  };
}

// ── Starta, läsa och avbryta jobb ──

export async function findJobForBook(bookId: string): Promise<JobView | null> {
  const db = serverSupabase();
  const { data, error } = await db
    .from('barnbok_jobs')
    .select('*')
    .eq('book_id', bookId)
    .order('created_at', { ascending: false })
    .limit(1);
  if (error && missingTables(error.message)) throw new Error(MISSING_TABLES);
  const job = data?.[0];
  if (!job) return null;
  return buildView(job);
}

export async function getJob(jobId: string): Promise<JobView | null> {
  const db = serverSupabase();
  const { data } = await db.from('barnbok_jobs').select('*').eq('id', jobId).single();
  if (!data) return null;
  return buildView(data);
}

async function buildView(job: Record<string, unknown>): Promise<JobView> {
  const db = serverSupabase();
  const { data: items } = await db
    .from('barnbok_job_items')
    .select('*')
    .eq('job_id', job.id as string)
    .order('spread_number');
  return {
    id: job.id as string,
    bookId: job.book_id as string,
    status: job.status as JobView['status'],
    total: (job.total as number) ?? 0,
    done: (job.done as number) ?? 0,
    failed: (job.failed as number) ?? 0,
    message: (job.message as string) || undefined,
    updatedAt: (job.updated_at as string) || new Date().toISOString(),
    items: (items || []).map(i => ({
      spreadId: i.spread_id,
      spreadNumber: i.spread_number,
      label: i.label || '',
      status: i.status,
      imageUrl: i.image_url || undefined,
      quality: (i.quality as SpreadQualityCheck) || undefined,
      error: i.error || undefined,
    })),
  };
}

export async function createIllustrationJob(bookId: string): Promise<{ jobId: string; total: number; alreadyRunning?: boolean } | { error: string }> {
  const db = serverSupabase();

  // Ett pågående jobb för boken räcker
  let existing: JobView | null = null;
  try {
    existing = await findJobForBook(bookId);
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
  if (existing && existing.status === 'running') {
    void runJob(existing.id);
    return { jobId: existing.id, total: existing.total, alreadyRunning: true };
  }

  const book = await loadBookForJob(bookId);
  if (!book) return { error: 'Hittade inte boken i molnet - spara boken och försök igen' };
  const todo = book.spreads.filter(s => !s.imageUrl);
  if (todo.length === 0) return { error: 'Alla uppslag har redan en bild' };

  const { data: jobRow, error } = await db
    .from('barnbok_jobs')
    .insert({ book_id: bookId, kind: 'illustrate', status: 'running', total: todo.length })
    .select()
    .single();
  if (error || !jobRow) {
    return { error: missingTables(error?.message) ? MISSING_TABLES : `Kunde inte starta jobbet: ${error?.message || 'okänt fel'}` };
  }

  const { error: itemError } = await db.from('barnbok_job_items').insert(
    todo.map(s => ({
      job_id: jobRow.id,
      spread_id: s.id,
      spread_number: s.spreadNumber,
      label: s.pages === 'omslag' ? 'Omslag' : `Uppslag ${s.pages}`,
    }))
  );
  if (itemError) return { error: `Kunde inte lägga upp kön: ${itemError.message}` };

  void runJob(jobRow.id);
  return { jobId: jobRow.id, total: todo.length };
}

export async function cancelJob(jobId: string): Promise<void> {
  const db = serverSupabase();
  await db.from('barnbok_jobs').update({ status: 'canceled', updated_at: new Date().toISOString() }).eq('id', jobId);
  await db.from('barnbok_job_items').update({ status: 'error', error: 'Avbrutet' }).eq('job_id', jobId).eq('status', 'queued');
}

// Jobb som tappades vid en omstart startas om, t.ex. när någon öppnar appen igen
export async function resumeStaleJobs(): Promise<number> {
  const db = serverSupabase();
  const { data } = await db
    .from('barnbok_jobs')
    .select('id, heartbeat_at')
    .eq('status', 'running')
    .lt('heartbeat_at', new Date(Date.now() - STALE_MS).toISOString())
    .limit(5);
  let resumed = 0;
  for (const job of data || []) {
    if (running.has(job.id)) continue;
    console.log(`[Jobb] återupptar ${job.id} efter avbrott`);
    void runJob(job.id);
    resumed++;
  }
  return resumed;
}

// ── Själva arbetet ──

export async function runJob(jobId: string): Promise<void> {
  if (running.has(jobId)) return;
  running.add(jobId);
  const db = serverSupabase();
  const startedAt = Date.now();

  try {
    const { data: job } = await db.from('barnbok_jobs').select('*').eq('id', jobId).single();
    if (!job || job.status !== 'running') return;

    const book = await loadBookForJob(job.book_id);
    if (!book) {
      await db.from('barnbok_jobs').update({ status: 'failed', message: 'Boken hittades inte', updated_at: new Date().toISOString() }).eq('id', jobId);
      return;
    }
    const spreadById = new Map(book.spreads.map(s => [s.id, s]));

    const worker = async (n: number) => {
      // Trappa igång arbetarna så att de inte träffar bildmodellen samtidigt
      if (n > 0) await new Promise(r => setTimeout(r, n * 2000));
      for (;;) {
        const { data: claimed, error } = await db.rpc('barnbok_claim_job_item', { p_job: jobId });
        if (error) { console.warn('[Jobb] kunde inte hämta uppslag:', error.message); throw new Error(missingTables(error.message) ? MISSING_TABLES : error.message); }
        const item = Array.isArray(claimed) ? claimed[0] : claimed;
        if (!item) return;

        const { data: check } = await db.from('barnbok_jobs').select('status').eq('id', jobId).single();
        if (check?.status !== 'running') return;

        const spread = spreadById.get(item.spread_id);
        if (!spread) {
          await finishItem(item.id, { status: 'error', error: 'Uppslaget finns inte längre' });
          continue;
        }

        try {
          const result = await generatePageWithQualityCheck(
            spread,
            book.characters,
            book.styleGuide,
            book.bookFormat,
            { shape: book.illustrationShape, imageSize: '2K' },
            { deadline: Date.now() + ITEM_BUDGET_MS }
          );
          const path = `books/${book.id}/${spread.id}.png`;
          const url = await uploadPng(path, result.image);
          if (!url) throw new Error('Bilden kunde inte sparas i molnet');
          // Bilden hör till boken, inte bara till jobbet
          await db.from('barnbok_spreads').update({ image_url: url, image_status: 'done' }).eq('id', spread.id);
          await finishItem(item.id, { status: 'done', image_url: url, quality: result.qualityCheck });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.warn(`[Jobb] ${item.label || item.spread_id} misslyckades:`, message);
          // Ett uppslag som fastnat får försöka igen senare, annars markeras det
          await finishItem(item.id, item.attempts >= 2
            ? { status: 'error', error: message }
            : { status: 'queued', error: message });
        }
        await db.rpc('barnbok_job_progress', { p_job: jobId });
      }
    };

    const finishItem = async (id: string, patch: Record<string, unknown>) => {
      await db.from('barnbok_job_items').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id);
    };

    // Puls medan jobbet lever, så att en omstart kan upptäckas
    const beat = setInterval(() => {
      void db.from('barnbok_jobs').update({ heartbeat_at: new Date().toISOString() }).eq('id', jobId);
    }, 30_000);

    try {
      await Promise.all(Array.from({ length: WORKERS }, (_, n) => worker(n)));
    } finally {
      clearInterval(beat);
    }

    await db.rpc('barnbok_job_progress', { p_job: jobId });
    const { data: after } = await db.from('barnbok_jobs').select('*').eq('id', jobId).single();
    if (after?.status === 'running') {
      const left = await queuedCount(jobId);
      if (left === 0) {
        const failed = after.failed ?? 0;
        await db.from('barnbok_jobs').update({
          status: failed > 0 && failed === after.total ? 'failed' : 'done',
          message: failed > 0 ? `${failed} uppslag behöver göras om` : null,
          updated_at: new Date().toISOString(),
        }).eq('id', jobId);
        console.log(`[Jobb] ${jobId} klart på ${Math.round((Date.now() - startedAt) / 1000)} s (${after.done}/${after.total})`);
      }
    }
  } catch (err) {
    console.error('[Jobb] kraschade:', err);
    await serverSupabase().from('barnbok_jobs')
      .update({ status: 'failed', message: err instanceof Error ? err.message : String(err) })
      .eq('id', jobId);
  } finally {
    running.delete(jobId);
  }
}

async function queuedCount(jobId: string): Promise<number> {
  const db = serverSupabase();
  const { count } = await db
    .from('barnbok_job_items')
    .select('id', { count: 'exact', head: true })
    .eq('job_id', jobId)
    .in('status', ['queued', 'running']);
  return count ?? 0;
}

async function uploadPng(path: string, base64: string): Promise<string | null> {
  const db = serverSupabase();
  const bytes = Buffer.from(base64, 'base64');
  const { error } = await db.storage.from(SERVER_IMAGES_BUCKET).upload(path, bytes, { contentType: 'image/png', upsert: true });
  if (error) { console.warn('[Jobb] uppladdning misslyckades:', error.message); return null; }
  return db.storage.from(SERVER_IMAGES_BUCKET).getPublicUrl(path).data.publicUrl;
}
