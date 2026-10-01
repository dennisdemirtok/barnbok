// Bildjobb i bakgrunden.
//
// Webbläsaren startar ett jobb och får ett id. Servern jobbar vidare även om
// användaren stänger sidan: varje uppslag hämtas ur kön, illustreras med samma
// granskningsloop som tidigare, laddas upp till Supabase Storage och bockas av.
// Startar servern om mitt i tas påbörjade uppslag tillbaka efter tio minuter.
import { serverSupabase, SERVER_IMAGES_BUCKET } from './supabase-server';
import { generatePageWithQualityCheck, DEFAULT_QUALITY_BUDGET_MS } from './character-check';
import { imageSizeFor } from './image-size';
import { buildPageImageRequest, extractImage, isMonochromeStyle, ImageQuality, BUDGET_IMAGE_MODEL } from './gemini';
import { cancelImageBatch, checkImageBatch, fileReference, imageMimeType, submitImageBatch, uploadReferenceSheets, UploadedRef } from './image-batch';
import { withReferenceImages } from './character-refs';
import { BookFormat, BookProject, Character, IllustrationShape, Spread, SpreadQualityCheck } from './types';
import { CURRENT_VOICE_SETTINGS, estimateSeconds, isQuality, isVoiceSettingsVersion, narrationSegments, spokenText, textStamp, TtsQuality, TtsQuotaError, VoiceSettingsVersion } from './tts';
import { readChapter } from './audiobook-reader';
import { loadPronunciations } from './pronunciations';
import { DEFAULT_VOICE_ID, voiceById } from './tts-voices';

// Så många uppslag illustreras samtidigt. Servern väntar inte på ett svar till
// webbläsaren längre, så det här handlar bara om Geminis takt.
const WORKERS = 4;
// Ett uppslag får ta så här lång tid (bild + granskning + rättningar)
const ITEM_BUDGET_MS = DEFAULT_QUALITY_BUDGET_MS;
// Ett uppläst avsnitt (kapitel) får ta så här lång tid, med korrekturlyssning
// och omläsning av bitar som hade fel
const AUDIO_BUDGET_MS = 14 * 60 * 1000;
// Kapitlen läses ett i taget och i ordning: varje kapitel lyssnar på slutet av
// det förra, så att rösten håller samma ton genom hela boken
const AUDIO_WORKERS = 1;
// ElevenLabs kan bara lyssna på inläsningar som är högst två timmar gamla
const STITCH_MAX_AGE_MS = 110 * 60 * 1000;
// Sparläget: så ofta tittar jobbet efter levererade bilder hos Google,
// och så många bilder läggs i varje batch (svaren hämtas en batch i taget)
const BATCH_POLL_MS = 60_000;
const BATCH_SIZE = 10;

interface BatchPayload {
  mode?: 'fast' | 'batch';
  quality?: ImageQuality;
  refs?: Record<string, UploadedRef>;
  batches?: { name: string; itemIds: string[]; submittedAt: string; state: string }[];
}
// Jobb vars puls är äldre än så här anses ha dött med en omstart
const STALE_MS = 3 * 60 * 1000;
// Databasanrop som inte svarat på så här länge räknas som tappade
const DB_TIMEOUT_MS = 30_000;
// Händer ingenting alls på så här länge har körningen fastnat
const NO_PROGRESS_MS = 8 * 60 * 1000;

interface JobItemRow { id: string; spread_id: string; label?: string; attempts: number; spread_number?: number }
// Ett uppslag som tagits men inte blivit klart på så här länge är övergivet
const STUCK_ITEM_MS = 6 * 60 * 1000;
// Fler försök än så är lönlöst - då är det något annat som är fel
const MAX_ITEM_ATTEMPTS = 3;

export interface JobItemView {
  spreadId: string;
  spreadNumber: number;
  label: string;
  status: 'queued' | 'running' | 'batched' | 'done' | 'error';
  imageUrl?: string;
  quality?: SpreadQualityCheck;
  error?: string;
}

export interface JobView {
  id: string;
  bookId: string;
  mode?: 'fast' | 'batch';
  quality?: ImageQuality;
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
  title: string;
  author?: string;
  styleGuide: string;
  bookFormat?: BookFormat;
  illustrationShape?: IllustrationShape;
  characters: Character[];
  spreads: SpreadWithUrl[];
}

// Jobb som körs i den här processen just nu, med starttid. En körning som hängt
// sig länge får aldrig blockera en ny - då skulle jobbet stå still för alltid.
const running = new Map<string, number>();
const RUN_MAX_AGE_MS = 20 * 60 * 1000;

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

  let meta: { illustrationShape?: IllustrationShape; author?: string; compositions?: Record<string, Spread['composition']> } = {};
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
    title: bookRow.title || 'Boken',
    author: meta.author || bookRow.author_name || undefined,
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
  // Servern kan ha startat om (ny version) mitt i jobbet - ta upp det igen
  const beat = data.heartbeat_at ? Date.parse(data.heartbeat_at) : 0;
  if (data.status === 'running' && Date.now() - beat > STALE_MS) {
    console.log(`[Jobb] ${jobId} hade stannat - startar om`);
    void runJob(jobId);
  }
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
    mode: ((job.payload as { mode?: 'fast' | 'batch' } | null)?.mode) || 'fast',
    quality: ((job.payload as { quality?: ImageQuality } | null)?.quality) || 'standard',
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

export type IllustrationMode = 'fast' | 'batch';

export async function createIllustrationJob(bookId: string, mode: IllustrationMode = 'fast', quality: ImageQuality = 'standard'): Promise<{ jobId: string; total: number; alreadyRunning?: boolean } | { error: string }> {
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
    .insert({ book_id: bookId, kind: 'illustrate', status: 'running', total: todo.length, payload: { mode, quality } })
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

/** Startar ett ljudboksjobb: ett avsnitt (kapitel) i taget läses upp och sparas. */
export async function createAudiobookJob(
  bookId: string,
  voiceId?: string,
  quality: TtsQuality = 'best',
  // Tomt = hela boken. Annars bara de kapitel som räknas upp.
  segmentIndexes?: number[],
): Promise<{ jobId: string; total: number; alreadyRunning?: boolean } | { error: string }> {
  const db = serverSupabase();
  const voice = voiceById(voiceId).id;

  const { data: existingRows } = await db
    .from('barnbok_jobs')
    .select('*')
    .eq('book_id', bookId)
    .eq('kind', 'audiobook')
    .order('created_at', { ascending: false })
    .limit(1);
  const existing = existingRows?.[0];
  if (existing?.status === 'running') {
    void runJob(existing.id);
    return { jobId: existing.id, total: existing.total, alreadyRunning: true };
  }

  const book = await loadBookForJob(bookId);
  if (!book) return { error: 'Hittade inte boken i molnet - spara boken och försök igen' };
  const all = narrationSegments(bookForNarration(book));
  const wanted = segmentIndexes?.length ? new Set(segmentIndexes) : null;
  const segments = wanted ? all.filter(s => wanted.has(s.index)) : all;
  if (segments.length === 0) return { error: 'Boken har ingen text att läsa upp' };

  // Röstinställningarna följer boken: läses bara vissa kapitel om används samma
  // version som resten, så att de låter likadant. Hela boken får den nyaste.
  const manifest = await readAudioManifest(bookId);
  const wholeBook = segments.length === all.length;
  const settings: VoiceSettingsVersion = wholeBook || !manifest?.parts?.length
    ? CURRENT_VOICE_SETTINGS
    : isVoiceSettingsVersion(manifest.settings) ? manifest.settings : 1;

  const { data: jobRow, error } = await db
    .from('barnbok_jobs')
    .insert({ book_id: bookId, kind: 'audiobook', status: 'running', total: segments.length, payload: { voiceId: voice, quality, settings, segments: segments.map(s => s.index) } })
    .select()
    .single();
  if (error || !jobRow) {
    return { error: missingTables(error?.message) ? MISSING_TABLES : `Kunde inte starta ljudboken: ${error?.message || 'okänt fel'}` };
  }

  const { error: itemError } = await db.from('barnbok_job_items').insert(
    segments.map(seg => ({
      job_id: jobRow.id,
      spread_id: crypto.randomUUID(),
      spread_number: seg.index,
      label: seg.label.slice(0, 120),
    }))
  );
  if (itemError) return { error: `Kunde inte lägga upp ljudkön: ${itemError.message}` };

  void runJob(jobRow.id);
  return { jobId: jobRow.id, total: segments.length };
}

// Bokens text som uppläsningen utgår från
function bookForNarration(book: BookForJob): BookProject {
  return {
    id: book.id,
    title: book.title,
    author: book.author,
    spreads: book.spreads,
    characters: book.characters,
    styleGuide: book.styleGuide,
    bookFormat: book.bookFormat,
    status: 'done',
    createdAt: new Date().toISOString(),
  } as BookProject;
}

export async function cancelJob(jobId: string): Promise<void> {
  const db = serverSupabase();
  // Bilder som ligger i Googles batchkö avbryts också, så att de inte kostar
  const { data: job } = await db.from('barnbok_jobs').select('payload').eq('id', jobId).maybeSingle();
  for (const batch of ((job?.payload as BatchPayload | null)?.batches || [])) {
    if (batch.state !== 'done') await cancelImageBatch(batch.name);
  }
  await db.from('barnbok_job_items').update({ status: 'error', error: 'Avbrutet' }).eq('job_id', jobId).eq('status', 'batched');
  await db.from('barnbok_jobs').update({ status: 'canceled', updated_at: new Date().toISOString() }).eq('id', jobId);
  await db.from('barnbok_job_items').update({ status: 'error', error: 'Avbrutet' }).eq('job_id', jobId).eq('status', 'queued');
}

// Vid serverstart: alla jobb som var igång tas upp direkt, även om ingen har
// appen öppen (en ny version startar om servern mitt i jobben)
export async function resumeRunningJobs(): Promise<number> {
  const { data } = await serverSupabase().from('barnbok_jobs').select('id').eq('status', 'running').limit(20);
  for (const job of data || []) void runJob(job.id);
  if (data?.length) console.log(`[Jobb] serverstart: tar upp ${data.length} pågående jobb`);
  return data?.length ?? 0;
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
  const already = running.get(jobId);
  if (already && Date.now() - already < RUN_MAX_AGE_MS) return;
  const startedAt = Date.now();
  running.set(jobId, startedAt);
  const db = serverSupabase();
  console.log(`[Jobb] ${jobId}: körningen startar`);

  try {
    const job = await withTimeout(
      db.from('barnbok_jobs').select('*').eq('id', jobId).single().then(r => r.data),
      DB_TIMEOUT_MS, 'Databasen svarade inte när jobbet skulle läsas'
    );
    if (!job || job.status !== 'running') { console.log(`[Jobb] ${jobId}: inget att göra (${job?.status ?? 'saknas'})`); return; }

    let lastProgressAt = Date.now();
    // Uppslag som en tidigare körning tog men aldrig blev klar med läggs tillbaka i kön
    const stuckBefore = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    await withTimeout(
      db.from('barnbok_job_items')
        .update({ status: 'queued', updated_at: new Date().toISOString() })
        .eq('job_id', jobId)
        .eq('status', 'running')
        .lt('claimed_at', stuckBefore),
      DB_TIMEOUT_MS, 'Databasen svarade inte när fastnade uppslag skulle läggas tillbaka'
    );
    await giveUpExhausted(jobId);

    const book = await withTimeout(loadBookForJob(job.book_id), DB_TIMEOUT_MS * 2, 'Boken kunde inte läsas i tid');
    console.log(`[Jobb] ${jobId}: startar körning, boken har ${book?.spreads.length ?? 0} uppslag`);
    if (!book) {
      await db.from('barnbok_jobs').update({ status: 'failed', message: 'Boken hittades inte', updated_at: new Date().toISOString() }).eq('id', jobId);
      return;
    }
    const spreadById = new Map(book.spreads.map(s => [s.id, s]));
    const isAudiobook = job.kind === 'audiobook';
    const imageQuality: ImageQuality = (job.payload as { quality?: ImageQuality } | null)?.quality === 'budget' ? 'budget' : 'standard';
    const payload = job.payload as { voiceId?: string; quality?: TtsQuality; settings?: number } | null;
    const voiceId = payload?.voiceId || DEFAULT_VOICE_ID;
    const audioQuality: TtsQuality = isQuality(payload?.quality) ? payload.quality : 'best';
    // Jobb från före versionerna lästes med de gamla inställningarna
    const voiceSettings: VoiceSettingsVersion = isVoiceSettingsVersion(payload?.settings) ? payload.settings : 1;
    const segments = isAudiobook ? narrationSegments(bookForNarration(book)) : [];
    // Bokens uttalslista gäller varje kapitel som läses in
    const pronunciations = isAudiobook ? await loadPronunciations(book.id) : [];
    const pronunciationNotes = pronunciations.map(r => `"${r.word}" sägs som "${r.sayAs}"`);
    // Kapitel som redan är inlästa: deras inläsningar (för att hålla tonen) och brusnivå
    const readParts = isAudiobook ? await knownAudioParts(book.id, jobId) : new Map<number, KnownPart>();

    const finishItem = async (id: string, patch: Record<string, unknown>) => {
      await withTimeout(
        db.from('barnbok_job_items').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id),
        DB_TIMEOUT_MS,
        'Databasen svarade inte när uppslaget skulle bockas av'
      ).catch(err => console.warn('[Jobb] kunde inte spara resultatet:', err instanceof Error ? err.message : err));
    };

    // Sparläget: nya bilder läggs i Googles batchkö, levererade bilder granskas
    if (!isAudiobook && (payload as { mode?: string } | null)?.mode === 'batch') {
      await db.from('barnbok_jobs').update({ heartbeat_at: new Date().toISOString() }).eq('id', jobId);
      await batchTick(jobId, job.payload as BatchPayload, book, spreadById, finishItem);
      lastProgressAt = Date.now();
    }

    const worker = async (n: number) => {
      // Trappa igång arbetarna så att de inte träffar bildmodellen samtidigt
      if (n > 0) await new Promise(r => setTimeout(r, n * 2000));
      console.log(`[Jobb] arbetare ${n} startar`);
      for (;;) {
        // Databasanrop får aldrig hänga - då skulle arbetaren tystna för gott
        let item: JobItemRow | undefined;
        try {
          item = await claimNextItem(jobId);
        } catch (err) {
          console.warn('[Jobb] kunde inte hämta uppslag:', err instanceof Error ? err.message : err);
          return;
        }
        if (!item) { console.log(`[Jobb] arbetare ${n}: inget mer att ta`); return; }
        console.log(`[Jobb] arbetare ${n} tog ${item.label || item.spread_id} (försök ${item.attempts})`);
        lastProgressAt = Date.now();

        const check = await withTimeout(
          db.from('barnbok_jobs').select('status').eq('id', jobId).single().then(r => r.data as { status: string } | null),
          DB_TIMEOUT_MS,
          'Databasen svarade inte'
        ).catch(() => null);
        if (check?.status !== 'running') return;

        if (isAudiobook) {
          const segment = segments[item.spread_number ?? -1];
          if (!segment) {
            await finishItem(item.id, { status: 'error', error: 'Avsnittet finns inte längre' });
            continue;
          }
          try {
            const spoken = spokenText(segment.text, pronunciations);
            // Bara inläsningar med samma modell: en annan modell låter annorlunda
            // och ska varken följas eller jämföras med
            const sameModel = (part?: KnownPart) => (part && part.mode === audioQuality ? part : undefined);
            const fresh = (part?: KnownPart) => (part && Date.now() - part.at < STITCH_MAX_AGE_MS ? sameModel(part) : undefined);
            const previous = fresh(readParts.get(segment.index - 1));
            const next = fresh(readParts.get(segment.index + 1));
            const otherFloors = Array.from(readParts.entries())
              .filter(([index, part]) => index !== segment.index && typeof part.floor === 'number' && sameModel(part))
              .map(([, part]) => part.floor as number);
            const reading = await withTimeout(readChapter({
              spoken,
              original: segment.text,
              notes: pronunciationNotes,
              voiceId,
              quality: audioQuality,
              settings: voiceSettings,
              previousRequestIds: previous?.lastRequestId ? [previous.lastRequestId] : undefined,
              nextRequestIds: next?.firstRequestId ? [next.firstRequestId] : undefined,
              otherFloors,
            }), AUDIO_BUDGET_MS, 'Uppläsningen tog för lång tid');
            const { take, quality: proof } = reading;
            const url = await uploadFile(`books/${book.id}/audio/${String(segment.index).padStart(3, '0')}-${textStamp(spoken)}.mp3`, take.audio, 'audio/mpeg');
            if (!url) throw new Error('Ljudet kunde inte sparas i molnet');
            const known: KnownPart = {
              at: Date.now(),
              firstRequestId: take.requestIds[0],
              lastRequestId: take.requestIds[take.requestIds.length - 1],
              floor: proof.floor,
              mode: audioQuality,
            };
            readParts.set(segment.index, known);
            await finishItem(item.id, {
              status: 'done',
              image_url: url,
              quality: {
                seconds: estimateSeconds(segment.text),
                label: segment.label,
                stamp: textStamp(spoken),
                credits: take.credits,
                settings: voiceSettings,
                mode: audioQuality,
                firstRequestId: known.firstRequestId,
                lastRequestId: known.lastRequestId,
                at: new Date(known.at).toISOString(),
                proof,
              },
            });
            console.log(`[Jobb] arbetare ${n} läste upp ${segment.label} (${take.credits} krediter, ${proof.issues.length} saker att lyssna på, ${proof.fixed} bitar omlästa)`);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.warn(`[Jobb] ${item.label || segment.label} misslyckades:`, message);
            if (err instanceof TtsQuotaError) {
              // Kvoten är slut: resten av kapitlen får samma besked i stället för att försöka i onödan
              await finishItem(item.id, { status: 'error', error: message });
              await db.from('barnbok_job_items').update({ status: 'error', error: message, updated_at: new Date().toISOString() })
                .eq('job_id', jobId).eq('status', 'queued');
              await withTimeout(db.rpc('barnbok_job_progress', { p_job: jobId }), DB_TIMEOUT_MS, 'Databasen svarade inte').catch(() => null);
              return;
            }
            await finishItem(item.id, item.attempts >= MAX_ITEM_ATTEMPTS
              ? { status: 'error', error: message }
              : { status: 'queued', error: message });
          }
          lastProgressAt = Date.now();
          await withTimeout(db.rpc('barnbok_job_progress', { p_job: jobId }), DB_TIMEOUT_MS, 'Databasen svarade inte').catch(() => null);
          continue;
        }

        const spread = spreadById.get(item.spread_id);
        if (!spread) {
          await finishItem(item.id, { status: 'error', error: 'Uppslaget finns inte längre' });
          continue;
        }

        try {
          // Vakthund: ett uppslag får aldrig äga en arbetare för evigt
          const result = await withTimeout(generatePageWithQualityCheck(
            spread,
            book.characters,
            book.styleGuide,
            book.bookFormat,
            { shape: book.illustrationShape, imageSize: imageSizeFor(spread), quality: imageQuality },
            { deadline: Date.now() + ITEM_BUDGET_MS }
          ), ITEM_BUDGET_MS + 60_000, 'Uppslaget tog för lång tid');
          // Ny adress för varje ny bild, så att ingen cache visar en gammal version
          const path = `books/${book.id}/${spread.id}-${Date.now().toString(36)}.png`;
          const url = await uploadPng(path, result.image);
          if (!url) throw new Error('Bilden kunde inte sparas i molnet');
          // Bilden hör till boken, inte bara till jobbet
          await db.from('barnbok_spreads').update({ image_url: url, image_status: 'done' }).eq('id', spread.id);
          await finishItem(item.id, { status: 'done', image_url: url, quality: result.qualityCheck });
          console.log(`[Jobb] arbetare ${n} klar med ${item.label || item.spread_id}`);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.warn(`[Jobb] ${item.label || item.spread_id} misslyckades:`, message);
          // Ett uppslag som fastnat får försöka igen senare, annars markeras det
          await finishItem(item.id, item.attempts >= MAX_ITEM_ATTEMPTS
            ? { status: 'error', error: message }
            : { status: 'queued', error: message });
        }
        lastProgressAt = Date.now();
        await withTimeout(db.rpc('barnbok_job_progress', { p_job: jobId }), DB_TIMEOUT_MS, 'Databasen svarade inte').catch(() => null);
      }
    };

    // Puls medan jobbet lever, så att en omstart kan upptäckas. Händer inget
    // alls på länge slutar pulsen - då räknas jobbet som stannat och tas upp igen.
    await db.from('barnbok_jobs').update({ heartbeat_at: new Date().toISOString() }).eq('id', jobId);
    const beat = setInterval(() => {
      if (Date.now() - lastProgressAt > NO_PROGRESS_MS) return;
      void db.from('barnbok_jobs').update({ heartbeat_at: new Date().toISOString() }).eq('id', jobId);
    }, 30_000);

    try {
      await Promise.all(Array.from({ length: isAudiobook ? AUDIO_WORKERS : WORKERS }, (_, n) => worker(n)));
    } finally {
      clearInterval(beat);
    }

    // Rader som använt alla försök kan aldrig tas igen - annars väntar jobbet på dem för alltid
    await giveUpExhausted(jobId);
    await db.rpc('barnbok_job_progress', { p_job: jobId });
    const { data: after } = await db.from('barnbok_jobs').select('*').eq('id', jobId).single();
    if (after?.status === 'running') {
      const left = await queuedCount(jobId);
      const waitingOnGoogle = left > 0 ? await batchedCount(jobId) : 0;
      if (waitingOnGoogle > 0) {
        // Sparläget: bilderna ligger hos Google - titta till dem om en minut
        console.log(`[Jobb] ${jobId}: ${waitingOnGoogle} bilder väntar i Googles batchkö`);
        setTimeout(() => { void runJob(jobId); }, BATCH_POLL_MS);
      } else if (left > 0) {
        // Något tog slut i förtid (t.ex. ett uppslag som fastnade) - fortsätt snart
        console.log(`[Jobb] ${jobId}: ${left} uppslag kvar, tar nytt tag om en stund`);
        setTimeout(() => { void runJob(jobId); }, 15_000);
      }
      if (left === 0) {
        const failed = after.failed ?? 0;
        if (isAudiobook) await writeAudioManifest(book, jobId, voiceId);
        await db.from('barnbok_jobs').update({
          status: failed > 0 && failed === after.total ? 'failed' : 'done',
          message: failed > 0 ? (isAudiobook ? `${failed} kapitel kunde inte läsas in` : `${failed} uppslag behöver göras om`) : null,
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
    if (running.get(jobId) === startedAt) running.delete(jobId);
    console.log(`[Jobb] ${jobId}: körningen avslutad efter ${Math.round((Date.now() - startedAt) / 1000)} s`);
  }
}

/**
 * Tar nästa uppslag ur kön. Villkoret "status = queued" i samma uppdatering gör
 * att bara en arbetare kan vinna raden, även om flera frågar samtidigt.
 * Uppslag som en tidigare körning tog men aldrig blev klar med tas tillbaka här.
 */
async function claimNextItem(jobId: string): Promise<JobItemRow | undefined> {
  const db = serverSupabase();
  const stuckBefore = new Date(Date.now() - STUCK_ITEM_MS).toISOString();

  for (let round = 0; round < 2; round++) {
    const query = db
      .from('barnbok_job_items')
      .select('id, spread_id, label, attempts, status, spread_number')
      .eq('job_id', jobId)
      .lt('attempts', MAX_ITEM_ATTEMPTS)
      .order('spread_number')
      .limit(6);
    const { data: candidates, error } = await withTimeout(
      round === 0
        ? query.eq('status', 'queued')
        : query.eq('status', 'running').lt('claimed_at', stuckBefore),
      DB_TIMEOUT_MS,
      'Databasen svarade inte när kön skulle läsas'
    );
    if (error) throw new Error(missingTables(error.message) ? MISSING_TABLES : error.message);

    for (const candidate of candidates || []) {
      const now = new Date().toISOString();
      const { data: won } = await withTimeout(
        db.from('barnbok_job_items')
          .update({ status: 'running', claimed_at: now, attempts: (candidate.attempts ?? 0) + 1, updated_at: now })
          .eq('id', candidate.id)
          .eq('status', candidate.status) // villkoret: någon annan får inte ha hunnit före
          .select('id, spread_id, label, attempts, spread_number'),
        DB_TIMEOUT_MS,
        'Databasen svarade inte när uppslaget skulle tas'
      );
      const row = won?.[0];
      if (row) return row as JobItemRow;
    }
  }
  return undefined;
}

function withTimeout<T>(promise: PromiseLike<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(v => { clearTimeout(timer); resolve(v); }, e => { clearTimeout(timer); reject(e); });
  });
}

// Köade rader som redan använt alla försök (t.ex. tagna strax före en omstart)
// markeras som misslyckade, så att jobbet kan bli klart och startas om
async function giveUpExhausted(jobId: string): Promise<void> {
  await withTimeout(
    serverSupabase().from('barnbok_job_items')
      .update({ status: 'error', updated_at: new Date().toISOString() })
      .eq('job_id', jobId)
      .eq('status', 'queued')
      .gte('attempts', MAX_ITEM_ATTEMPTS),
    DB_TIMEOUT_MS, 'Databasen svarade inte när uttjänta rader skulle avslutas'
  ).catch(err => console.warn('[Jobb] kunde inte avsluta uttjänta rader:', err instanceof Error ? err.message : err));
}

async function queuedCount(jobId: string): Promise<number> {
  const db = serverSupabase();
  const { count } = await db
    .from('barnbok_job_items')
    .select('id', { count: 'exact', head: true })
    .eq('job_id', jobId)
    .in('status', ['queued', 'running', 'batched']);
  return count ?? 0;
}

async function batchedCount(jobId: string): Promise<number> {
  const { count } = await serverSupabase()
    .from('barnbok_job_items')
    .select('id', { count: 'exact', head: true })
    .eq('job_id', jobId)
    .eq('status', 'batched');
  return count ?? 0;
}

async function uploadPng(path: string, base64: string): Promise<string | null> {
  const mime = imageMimeType(base64);
  const fixedPath = mime === 'image/jpeg' ? path.replace(/\.png$/, '.jpg') : path;
  return uploadFile(fixedPath, Buffer.from(base64, 'base64'), mime);
}

// ── Sparläget ──

async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]);
  }));
}

/**
 * Ett varv i sparläget:
 * 1. Uppslag som aldrig provats skickas till Googles batchkö (halva priset).
 * 2. Batcher som Google levererat plockas upp. Varje bild granskas direkt och
 *    rättas vid behov med ett vanligt anrop, så att boken blir klar så fort
 *    batchen är levererad. Misslyckas en batch görs bilderna på vanligt sätt.
 */
async function batchTick(
  jobId: string,
  payload: BatchPayload | null,
  book: BookForJob,
  spreadById: Map<string, SpreadWithUrl>,
  finishItem: (id: string, patch: Record<string, unknown>) => Promise<void>,
): Promise<void> {
  const db = serverSupabase();
  const state: BatchPayload = { mode: 'batch', ...(payload || {}), batches: [...(payload?.batches || [])] };
  const save = () => db.from('barnbok_jobs').update({ payload: state, updated_at: new Date().toISOString() }).eq('id', jobId);
  const characters = await withReferenceImages(book.characters);
  const monochrome = isMonochromeStyle(book.styleGuide);

  // 1. Skicka nya uppslag
  const { data: fresh } = await db
    .from('barnbok_job_items')
    .select('id, spread_id, label')
    .eq('job_id', jobId)
    .eq('status', 'queued')
    .eq('attempts', 0)
    .order('spread_number');
  if (fresh && fresh.length > 0) {
    try {
      state.refs = await uploadReferenceSheets(characters, state.refs);
    } catch (err) {
      console.warn('[Sparläge] referensbladen kunde inte laddas upp - bladen skickas med i stället:', err instanceof Error ? err.message : err);
    }
    for (let i = 0; i < fresh.length; i += BATCH_SIZE) {
      const chunk = fresh.slice(i, i + BATCH_SIZE);
      const requests = [];
      const ids: string[] = [];
      for (const item of chunk) {
        const spread = spreadById.get(item.spread_id);
        if (!spread) { await finishItem(item.id, { status: 'error', error: 'Uppslaget finns inte längre' }); continue; }
        requests.push(await buildPageImageRequest(
          spread, characters, book.styleGuide, book.bookFormat,
          { shape: book.illustrationShape, imageSize: imageSizeFor(spread), quality: state.quality },
          fileReference(state.refs || {}),
        ));
        ids.push(item.id);
      }
      if (ids.length === 0) continue;
      try {
        const name = await submitImageBatch(
          requests,
          `${book.title} ${jobId.slice(0, 8)} ${i / BATCH_SIZE + 1}`,
          state.quality === 'budget' ? BUDGET_IMAGE_MODEL : undefined,
        );
        await db.from('barnbok_job_items')
          .update({ status: 'batched', attempts: 1, claimed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .in('id', ids);
        state.batches!.push({ name, itemIds: ids, submittedAt: new Date().toISOString(), state: 'pending' });
        await save(); // namnet får aldrig tappas bort, annars hittas bilderna inte
        console.log(`[Sparläge] ${ids.length} bilder skickade till Google (${name})`);
      } catch (err) {
        // Kunde inte skicka: bilderna görs på vanligt sätt i stället
        console.warn('[Sparläge] batchen kunde inte skickas - bilderna görs direkt:', err instanceof Error ? err.message : err);
        await db.from('barnbok_job_items').update({ attempts: 1, updated_at: new Date().toISOString() }).in('id', ids);
      }
    }
  }

  // 2. Hämta levererade batcher
  for (const batch of state.batches!) {
    if (batch.state === 'done') continue;
    let result;
    try {
      result = await checkImageBatch(batch.name);
    } catch (err) {
      console.warn(`[Sparläge] kunde inte läsa ${batch.name}:`, err instanceof Error ? err.message : err);
      continue;
    }
    batch.state = result.state;
    if (result.state === 'pending' || result.state === 'running') continue;

    if (result.state === 'failed') {
      console.warn(`[Sparläge] ${batch.name} misslyckades (${result.message}) - bilderna görs direkt`);
      await db.from('barnbok_job_items').update({ status: 'queued', updated_at: new Date().toISOString() })
        .in('id', batch.itemIds).eq('status', 'batched');
      batch.state = 'done';
      await save();
      continue;
    }

    const { data: waiting } = await db
      .from('barnbok_job_items')
      .select('id, spread_id, label')
      .in('id', batch.itemIds)
      .eq('status', 'batched');
    console.log(`[Sparläge] ${batch.name} levererad - granskar ${waiting?.length ?? 0} bilder`);

    await mapLimit(waiting || [], 3, async item => {
      const spread = spreadById.get(item.spread_id);
      const response = result.responses?.[batch.itemIds.indexOf(item.id)];
      if (!spread) { await finishItem(item.id, { status: 'error', error: 'Uppslaget finns inte längre' }); return; }
      let initialImage: string | undefined;
      try {
        initialImage = await extractImage(response?.response as Parameters<typeof extractImage>[0], monochrome);
      } catch {
        // Ingen bild i svaret - görs på vanligt sätt
      }
      if (!initialImage) {
        await finishItem(item.id, { status: 'queued', error: response?.error || 'Ingen bild från batchen' });
        return;
      }
      try {
        const quality = await withTimeout(generatePageWithQualityCheck(
          spread, book.characters, book.styleGuide, book.bookFormat,
          { shape: book.illustrationShape, imageSize: imageSizeFor(spread), quality: state.quality },
          { deadline: Date.now() + ITEM_BUDGET_MS, initialImage },
        ), ITEM_BUDGET_MS + 60_000, 'Granskningen tog för lång tid');
        const url = await uploadPng(`books/${book.id}/${spread.id}-${Date.now().toString(36)}.png`, quality.image);
        if (!url) throw new Error('Bilden kunde inte sparas i molnet');
        await db.from('barnbok_spreads').update({ image_url: url, image_status: 'done' }).eq('id', spread.id);
        await finishItem(item.id, { status: 'done', image_url: url, quality: quality.qualityCheck });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`[Sparläge] ${item.label || item.spread_id} kunde inte slutföras:`, message);
        await finishItem(item.id, { status: 'queued', error: message });
      }
      await withTimeout(db.rpc('barnbok_job_progress', { p_job: jobId }), DB_TIMEOUT_MS, 'Databasen svarade inte').catch(() => null);
    });
    batch.state = 'done';
    await save();
  }
  await save();
}

export async function uploadFile(path: string, bytes: Buffer, contentType: string, cacheControl?: string): Promise<string | null> {
  const db = serverSupabase();
  const { error } = await db.storage.from(SERVER_IMAGES_BUCKET).upload(path, bytes, { contentType, upsert: true, ...(cacheControl ? { cacheControl } : {}) });
  if (error) { console.warn('[Jobb] uppladdning misslyckades:', error.message); return null; }
  return db.storage.from(SERVER_IMAGES_BUCKET).getPublicUrl(path).data.publicUrl;
}

interface ManifestPart {
  index: number;
  label: string;
  url: string;
  seconds: number;
  stamp?: string;
  // Kvalitetskontrollen och det som behövs för att nästa kapitel ska låta likadant
  credits?: number;
  settings?: number;
  mode?: string;
  firstRequestId?: string;
  lastRequestId?: string;
  at?: string;
  proof?: { floor?: number; issues: unknown[]; checked: boolean; fixed: number; overall?: string };
}

interface AudioManifest {
  bookId: string;
  title?: string;
  voice?: string;
  voiceId?: string;
  mode?: string;
  settings?: number;
  createdAt?: string;
  seconds?: number;
  parts: ManifestPart[];
}

// Ett inläst kapitel som andra kapitel kan hålla tonen mot
interface KnownPart { at: number; firstRequestId?: string; lastRequestId?: string; floor?: number; mode?: string }

export async function readAudioManifest(bookId: string): Promise<AudioManifest | null> {
  const url = serverSupabase().storage.from(SERVER_IMAGES_BUCKET).getPublicUrl(audioManifestPath(bookId)).data.publicUrl;
  return fetch(`${url}?t=${Date.now()}`, { cache: 'no-store' })
    .then(r => (r.ok ? r.json() : null))
    .catch(() => null) as Promise<AudioManifest | null>;
}

/** Ändrar ett kapitel i innehållsförteckningen (t.ex. korrekturlyssningens resultat). */
export async function patchAudioManifestPart(bookId: string, index: number, patch: Partial<ManifestPart>): Promise<boolean> {
  const manifest = await readAudioManifest(bookId);
  const part = manifest?.parts.find(p => p.index === index);
  if (!manifest || !part) return false;
  Object.assign(part, patch);
  const url = await uploadFile(audioManifestPath(bookId), Buffer.from(JSON.stringify(manifest)), 'application/json', '0');
  return !!url;
}

// Inlästa kapitel ur innehållsförteckningen och ur det här jobbet (om servern
// startade om mitt i jobbet finns de klara kapitlen bara i jobbets rader)
async function knownAudioParts(bookId: string, jobId: string): Promise<Map<number, KnownPart>> {
  const known = new Map<number, KnownPart>();
  const manifest = await readAudioManifest(bookId);
  for (const part of manifest?.parts || []) {
    known.set(part.index, {
      at: part.at ? Date.parse(part.at) : 0,
      firstRequestId: part.firstRequestId,
      lastRequestId: part.lastRequestId,
      floor: part.proof?.floor,
      // Äldre inläsningar saknar läge - de gjordes med Naturlig
      mode: part.mode ?? 'best',
    });
  }
  const { data: items } = await serverSupabase()
    .from('barnbok_job_items')
    .select('spread_number, quality, status')
    .eq('job_id', jobId)
    .eq('status', 'done');
  for (const item of items || []) {
    const q = (item.quality || {}) as { at?: string; firstRequestId?: string; lastRequestId?: string; mode?: string; proof?: { floor?: number } };
    known.set(item.spread_number as number, {
      at: q.at ? Date.parse(q.at) : 0,
      firstRequestId: q.firstRequestId,
      lastRequestId: q.lastRequestId,
      floor: q.proof?.floor,
      mode: q.mode,
    });
  }
  return known;
}

// Innehållsförteckning för ljudboken, så att appen hittar spåren utan databasändring
export const audioManifestPath = (bookId: string) => `books/${bookId}/audio/manifest.json`;

async function writeAudioManifest(book: BookForJob, jobId: string, voiceId: string) {
  const db = serverSupabase();
  const { data: items } = await db
    .from('barnbok_job_items')
    .select('label, spread_number, image_url, quality, status')
    .eq('job_id', jobId)
    .order('spread_number');
  const fresh: ManifestPart[] = (items || [])
    .filter(i => i.status === 'done' && i.image_url)
    .map(i => {
      const q = (i.quality || {}) as Partial<ManifestPart> & { seconds?: number };
      return {
        index: i.spread_number as number,
        label: i.label || `Del ${(i.spread_number as number) + 1}`,
        url: i.image_url as string,
        seconds: q.seconds ?? 0,
        stamp: q.stamp,
        credits: q.credits,
        settings: q.settings,
        mode: q.mode,
        firstRequestId: q.firstRequestId,
        lastRequestId: q.lastRequestId,
        at: q.at,
        proof: q.proof,
      };
    });

  // Tidigare inlästa kapitel ligger kvar - listan växer när man gör ett i taget
  const existing = await readAudioManifest(book.id);

  const byIndex = new Map<number, ManifestPart>();
  for (const part of existing?.parts || []) {
    if (typeof part.index === 'number') byIndex.set(part.index, part);
  }
  for (const part of fresh) byIndex.set(part.index, part);
  const parts = Array.from(byIndex.values()).sort((a, b) => a.index - b.index);
  if (parts.length === 0) return;
  const latest = fresh[fresh.length - 1];
  const manifest: AudioManifest = {
    bookId: book.id,
    title: book.title,
    voice: voiceById(voiceId).name,
    voiceId,
    // Läge och röstinställningar som boken läses med - omläsningar använder samma
    mode: latest?.mode ?? existing?.mode,
    settings: latest?.settings ?? existing?.settings,
    createdAt: new Date().toISOString(),
    seconds: parts.reduce((n, p) => n + p.seconds, 0),
    parts,
  };
  // Innehållsförteckningen skrivs om när kapitel läggs till - den får aldrig cachas
  await uploadFile(audioManifestPath(book.id), Buffer.from(JSON.stringify(manifest)), 'application/json', '0');

  const segments = narrationSegments(bookForNarration(book));
  await syncAudioMeta(book.id, {
    seconds: manifest.seconds ?? 0,
    parts: parts.length,
    complete: segments.length > 0 && segments.every(seg => byIndex.has(seg.index)),
  }).catch(err => console.warn('[Jobb] kunde inte notera ljudboken på boken:', err instanceof Error ? err.message : err));
}

/**
 * Noterar ljudboken på bokens rad (theme-JSON, ingen databasändring), så att
 * bokhandeln kan visa ljudböckerna utan att läsa varje boks innehållsförteckning.
 * En ljudbok från text publiceras här när hela den är inläst - en gång, och
 * aldrig om författaren valt att den ska vara privat eller avpublicerat den.
 */
export async function syncAudioMeta(bookId: string, audio: { seconds: number; parts: number; complete: boolean }): Promise<void> {
  const db = serverSupabase();
  const { data: row, error } = await db.from('barnbok_books').select('theme, published_at').eq('id', bookId).maybeSingle();
  if (error || !row) return;
  let meta: Record<string, unknown> = {};
  if (typeof row.theme === 'string' && row.theme.startsWith('{')) {
    try { meta = JSON.parse(row.theme); } catch { meta = {}; }
  }
  const before = meta.audio as { seconds?: number; parts?: number; complete?: boolean } | undefined;
  const same = !!before && before.seconds === audio.seconds && before.parts === audio.parts && before.complete === audio.complete;
  const publish = meta.kind === 'audiobook' && audio.complete && meta.keepPrivate !== true && !row.published_at;
  if (same && !publish) return;

  const now = new Date().toISOString();
  const update: Record<string, unknown> = { theme: JSON.stringify({ ...meta, audio }) };
  if (publish) {
    update.is_public = true;
    update.published_at = now;
  }
  const { error: updateError } = await db.from('barnbok_books').update(update).eq('id', bookId);
  if (updateError) throw new Error(updateError.message);
  if (publish) console.log(`[Ljudbok] ${bookId} är färdig och publicerad i bokhandeln`);
}
