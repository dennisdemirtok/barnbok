import { supabase, IMAGES_BUCKET } from './supabase';
import { BookProject, Character, Spread, TextBlock, SavedCharacter, SavedText } from './types';

// ═══════════════════════════════════════════
//  Book operations (same API as storage.ts)
// ═══════════════════════════════════════════

export interface CloudSaveOptions {
  // true = publicera, false = avpublicera, utelämnat = rör inte publiceringen
  // (nya böcker publiceras ändå automatiskt i testläget, se nedan)
  publish?: boolean;
}

export interface CloudSaveReport {
  // Delar av boken som inte kunde sparas (karaktärer, uppslag, bilder, text)
  problems: string[];
}

export async function saveBookToCloud(book: BookProject, options: CloudSaveOptions = {}): Promise<CloudSaveReport> {
  const now = new Date().toISOString();
  const problems: string[] = [];

  // Knyt boken till inloggad användare om det finns en. Ej inloggade sparar
  // med user_id = null (testläge - kräver anon-policies i
  // scripts/anon-save-migration.sql så RLS släpper igenom skrivningen).
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id ?? null;

  // 1. Upsert the book record. is_public skickas INTE med här - en uppdatering
  // ska aldrig skriva över ett uttryckligt avpublicerat läge.
  const { error: bookError } = await supabase
    .from('barnbok_books')
    .upsert({
      id: book.id,
      user_id: userId,
      title: book.title,
      // Publikt författarnamn kommer bara från bokens eget författarfält
      author_name: book.author?.trim() || null,
      book_format: book.bookFormat || 'bildbok-text-pa-bild',
      age_min: parseAgeMin(book.targetAge),
      age_max: parseAgeMax(book.targetAge),
      // Stilval och bildform (styr sättningen) - JSON i theme-kolumnen, ingen migrering krävs
      theme: buildTheme(book),
      num_spreads: book.spreads.length,
      style: book.styleGuide,
      status: mapStatus(book.status),
      updated_at: now,
    }, { onConflict: 'id' });

  if (bookError) throw new Error(`Kunde inte spara bok: ${bookError.message}`);

  // Publicering: uttryckligt val vinner. Annars (testläge) publiceras böcker som
  // aldrig publicerats förut - published_at är null bara för helt nya böcker,
  // eftersom avpublicering behåller datumet.
  if (options.publish !== undefined) {
    try {
      await setBookPublished(book.id, options.publish);
    } catch (err) {
      problems.push(err instanceof Error ? err.message : String(err));
    }
  } else {
    const { error: autoError } = await supabase
      .from('barnbok_books')
      .update({ is_public: true, published_at: now })
      .eq('id', book.id)
      .is('published_at', null);
    if (autoError) problems.push(`Automatisk publicering: ${autoError.message}`);
  }

  // 2. Save characters
  if (book.characters.length > 0) {
    // Delete existing characters for this book, then re-insert
    const { error: delCharError } = await supabase.from('barnbok_characters').delete().eq('book_id', book.id);
    if (delCharError) problems.push(`Karaktärer (rensning): ${delCharError.message}`);

    // Referensbilden är karaktärens ansikte - den måste ligga i molnet, annars
    // kan servern inte rita samma person när den illustrerar i bakgrunden
    const charRows = await Promise.all(book.characters.map(async (c, i) => {
      let referenceUrl = c.referenceImageUrl ?? null;
      if (c.referenceImage) {
        const upload = await uploadCharacterImage(book.id, c.id, c.referenceImage);
        if (upload.url) referenceUrl = upload.url;
        else problems.push(`Karaktärsbild ${c.name}: ${upload.error}`);
      }
      return {
        id: c.id,
        book_id: book.id,
        user_id: userId,
        name: c.name,
        appearance: c.appearance,
        role: c.role === 'villain' ? 'supporting' : c.role,
        approved: c.approved,
        sort_order: i,
        age: c.age || null,
        normal_clothes: c.normalClothes || null,
        personality: c.personality || null,
        hero_name: c.heroName || null,
        hero_costume: c.heroCostume || null,
        power: c.power || null,
        reference_image_url: referenceUrl,
        face_notes: c.faceNotes || null,
      };
    }));

    let { error: charError } = await supabase
      .from('barnbok_characters')
      .insert(charRows);

    // Saknas bara den nyaste kolumnen: spara resten (bilderna är det viktiga)
    if (charError && /face_notes/i.test(charError.message)) {
      const withoutNotes = charRows.map(({ face_notes, ...rest }) => rest);
      ({ error: charError } = await supabase.from('barnbok_characters').insert(withoutNotes));
      if (!charError) problems.push('Ansiktsbeskrivningarna sparades inte - kör scripts/character-face-notes.sql i Supabase');
    }
    // Äldre databaser saknar de nya kolumnerna - spara det som går hellre än inget
    if (charError && /column .* does not exist/i.test(charError.message)) {
      const basicRows = charRows.map(r => ({
        id: r.id, book_id: r.book_id, user_id: r.user_id, name: r.name,
        appearance: r.appearance, role: r.role, approved: r.approved, sort_order: r.sort_order,
      }));
      ({ error: charError } = await supabase.from('barnbok_characters').insert(basicRows));
      if (!charError) problems.push('Karaktärernas bilder sparades inte - kör scripts/illustration-jobs.sql i Supabase');
    }
    if (charError) problems.push(`Karaktärer: ${charError.message}`);
  }

  // 3. Save spreads + text blocks
  if (book.spreads.length > 0) {
    // Delete existing spreads (cascades to text_blocks)
    const { error: delSpreadError } = await supabase.from('barnbok_spreads').delete().eq('book_id', book.id);
    if (delSpreadError) problems.push(`Uppslag (rensning): ${delSpreadError.message}`);

    for (const spread of book.spreads) {
      // Upload image to Supabase Storage if it exists. Uppslag som laddats från
      // molnet saknar base64 men har redan en bild-URL - behåll den.
      let imageUrl: string | null = (spread as Spread & { imageUrl?: string }).imageUrl ?? null;
      if (spread.generatedImage) {
        const upload = await uploadSpreadImage(book.id, spread.id, spread.generatedImage);
        if (upload.url) {
          imageUrl = upload.url;
        } else {
          problems.push(`Bild ${spreadLabel(spread)}: ${upload.error}`);
        }
      }

      const { error: spreadError } = await supabase
        .from('barnbok_spreads')
        .insert({
          id: spread.id,
          book_id: book.id,
          user_id: userId,
          spread_number: spread.spreadNumber,
          pages: spread.pages,
          chapter: spread.chapter || null,
          image_prompt: spread.imagePrompt,
          image_url: imageUrl,
          image_status: spread.status === 'error' ? 'failed' : spread.status,
          sort_order: spread.spreadNumber,
        });

      if (spreadError) {
        problems.push(`Uppslag ${spreadLabel(spread)}: ${spreadError.message}`);
        continue;
      }

      // Save text blocks
      if (spread.textBlocks.length > 0) {
        const textRows = spread.textBlocks.map((tb, i) => ({
          spread_id: spread.id,
          user_id: userId,
          text_content: tb.text,
          position: i,
        }));

        const { error: tbError } = await supabase
          .from('barnbok_text_blocks')
          .insert(textRows);

        if (tbError) problems.push(`Text ${spreadLabel(spread)}: ${tbError.message}`);
      }
    }
  }

  if (problems.length > 0) console.error('Molnsparning ofullständig:', problems);

  // Baksidestext till bokhandeln om den saknas - körs i bakgrunden och påverkar
  // varken sparningen eller publiceringen (tyst om migreringen inte körts)
  if (options.publish !== false && typeof window !== 'undefined') {
    void ensureBookDescription(book.id, book).catch(() => {});
  }

  return { problems };
}

// Lätt uppdatering av titel och författare (utan att ladda upp bilder igen).
// Returnerar false om boken inte finns i molnet än.
export async function updateBookInfoInCloud(book: BookProject): Promise<boolean> {
  const { data, error } = await supabase
    .from('barnbok_books')
    .update({
      title: book.title,
      author_name: book.author?.trim() || null,
      theme: buildTheme(book),
      updated_at: new Date().toISOString(),
    })
    .eq('id', book.id)
    .select('id');
  if (error) throw new Error(`Kunde inte uppdatera bokinfo: ${error.message}`);
  return !!data && data.length > 0;
}

export async function loadBookFromCloud(id: string): Promise<BookProject | null> {
  // 1. Load book
  const { data: bookRow, error } = await supabase
    .from('barnbok_books')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !bookRow) return null;

  // 2. Load characters
  const { data: charRows } = await supabase
    .from('barnbok_characters')
    .select('*')
    .eq('book_id', id)
    .order('sort_order');

  // 3. Load spreads
  const { data: spreadRows } = await supabase
    .from('barnbok_spreads')
    .select('*')
    .eq('book_id', id)
    .order('sort_order');

  // 4. Load text blocks for all spreads
  const spreadIds = (spreadRows || []).map(s => s.id);
  let textBlockRows: any[] = [];
  if (spreadIds.length > 0) {
    const { data } = await supabase
      .from('barnbok_text_blocks')
      .select('*')
      .in('spread_id', spreadIds)
      .order('position');
    textBlockRows = data || [];
  }

  // 5. Build BookProject
  const meta = parseBookMeta(bookRow.theme);
  const characters: Character[] = (charRows || []).map(c => ({
    id: c.id,
    name: c.name,
    appearance: c.appearance || '',
    role: c.role as 'main' | 'supporting',
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

  const spreads: Spread[] = (spreadRows || []).map(s => {
    const tbs = textBlockRows
      .filter(tb => tb.spread_id === s.id)
      .map(tb => ({
        position: `position-${tb.position}`,
        text: tb.text_content,
      }));

    return {
      id: s.id,
      spreadNumber: s.spread_number,
      pages: s.pages,
      chapter: s.chapter || undefined,
      composition: meta.compositions?.[String(s.spread_number)],
      textBlocks: tbs,
      imagePrompt: s.image_prompt || '',
      generatedImage: undefined, // Loaded on demand via image_url
      status: s.image_status === 'failed' ? 'error' : s.image_status,
      imageUrl: s.image_url, // Cloud URL
    } as Spread & { imageUrl?: string };
  });

  return {
    id: bookRow.id,
    title: bookRow.title,
    subtitle: '',
    // Författare läses bara från bokens eget fält (theme) - äldre author_name
    // kunde vara härlett från e-postadressen och ska inte visas
    author: meta.author || undefined,
    stylePresetId: meta.stylePresetId,
    illustrationShape: meta.illustrationShape,
    targetAge: `${bookRow.age_min}-${bookRow.age_max}`,
    bookFormat: bookRow.book_format,
    characters,
    spreads,
    styleGuide: bookRow.style || '',
    status: reverseMapStatus(bookRow.status),
    createdAt: bookRow.created_at,
    updatedAt: bookRow.updated_at,
  };
}

// ═══════════════════════════════════════════
//  Publicering / Bokhandel
// ═══════════════════════════════════════════

export interface PublicBookSummary {
  id: string;
  title: string;
  authorName?: string;
  bookFormat?: string;
  numSpreads: number;
  publishedAt?: string;
  coverUrl?: string;
  // Baksidestext (kräver scripts/bookstore-social.sql)
  description?: string;
  // Skaparens konto - saknas för anonyma böcker
  userId?: string;
  targetAge?: string;
}

// Publicera/avpublicera en bok. Publicerade böcker blir läsbara för alla via RLS.
// Vid avpublicering behålls published_at - det markerar att boken har ett
// uttryckligt publiceringsval och därför inte ska autopubliceras igen.
export async function setBookPublished(bookId: string, isPublic: boolean): Promise<void> {
  const update: Record<string, unknown> = { is_public: isPublic };
  if (isPublic) update.published_at = new Date().toISOString();
  const { error } = await supabase.from('barnbok_books').update(update).eq('id', bookId);
  if (error) throw new Error(`Kunde inte ${isPublic ? 'publicera' : 'avpublicera'} boken: ${error.message}`);
}

// Hämta nuvarande publiceringsstatus för en bok (ägaren).
// null = boken finns inte (synligt) i molnet än.
export async function getBookPublishState(bookId: string): Promise<boolean | null> {
  const { data, error } = await supabase.from('barnbok_books').select('is_public').eq('id', bookId).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? !!data.is_public : null;
}

// Lista alla publicerade böcker (för bokhandeln) - fungerar utan inloggning via RLS
export async function listPublicBooks(): Promise<PublicBookSummary[]> {
  return queryPublicBooks();
}

// Alla publicerade böcker av en skapare (konto-id)
export async function listPublicBooksByAuthor(authorUserId: string): Promise<PublicBookSummary[]> {
  return queryPublicBooks(authorUserId);
}

const PUBLIC_BOOK_COLUMNS = 'id, title, theme, book_format, num_spreads, published_at, user_id, age_min, age_max';

async function queryPublicBooks(authorUserId?: string): Promise<PublicBookSummary[]> {
  const run = (columns: string) => {
    let q = supabase
      .from('barnbok_books')
      .select(columns)
      .eq('is_public', true)
      .order('published_at', { ascending: false });
    if (authorUserId) q = q.eq('user_id', authorUserId);
    return q;
  };

  // description finns bara efter scripts/bookstore-social.sql - fall tillbaka utan
  let rows: any[] | null = null;
  if (socialSupport.description !== false) {
    const { data, error } = await run(`${PUBLIC_BOOK_COLUMNS}, description`);
    if (!error) {
      socialSupport.description = true;
      rows = data as any[];
    } else if (isMissingSchema(error)) {
      socialSupport.description = false;
    } else {
      return [];
    }
  }
  if (!rows) {
    const { data, error } = await run(PUBLIC_BOOK_COLUMNS);
    if (error || !data) return [];
    rows = data as any[];
  }

  // Omslagsbilder i några få anrop i stället för ett per bok
  const covers = new Map<string, string>();
  const ids = rows.map(b => b.id as string);
  for (let i = 0; i < ids.length; i += 80) {
    const { data: coverRows } = await supabase
      .from('barnbok_spreads')
      .select('book_id, image_url')
      .in('book_id', ids.slice(i, i + 80))
      .eq('pages', 'omslag');
    for (const c of coverRows || []) {
      if (c.image_url) covers.set(c.book_id, c.image_url);
    }
  }

  return rows.map(b => toPublicSummary(b, covers.get(b.id)));
}

function toPublicSummary(b: any, coverUrl?: string): PublicBookSummary {
  return {
    id: b.id,
    title: b.title,
    // Samma källa som läsaren: bokens eget författarfält, aldrig e-post
    authorName: parseBookMeta(b.theme).author || undefined,
    bookFormat: b.book_format,
    numSpreads: b.num_spreads,
    publishedAt: b.published_at || undefined,
    coverUrl: coverUrl || undefined,
    description: typeof b.description === 'string' && b.description.trim() ? b.description.trim() : undefined,
    userId: b.user_id || undefined,
    targetAge: b.age_min != null && b.age_max != null ? `${b.age_min}-${b.age_max}` : undefined,
  };
}

// Läs en publicerad bok (återanvänder molnladdningen - RLS tillåter publik läsning)
export async function loadPublicBook(id: string): Promise<BookProject | null> {
  return loadBookFromCloud(id);
}

// ═══════════════════════════════════════════
//  Bokhandeln: detaljer, baksidestext, hjärtan, följ, tryck
//  Allt nedan kräver scripts/bookstore-social.sql. Saknas tabeller/kolumner
//  markeras funktionen som ej tillgänglig (en gång per sidladdning) och UI:t
//  döljer den - inga kast, inga upprepade anrop.
// ═══════════════════════════════════════════

type SocialFeature = 'description' | 'likes' | 'follows' | 'printInterest';

// undefined = okänt än, true/false = upptäckt
const socialSupport: Partial<Record<SocialFeature, boolean>> = {};

function isMissingSchema(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  const code = error.code || '';
  if (['42P01', '42703', '42883', 'PGRST200', 'PGRST202', 'PGRST204', 'PGRST205'].includes(code)) return true;
  return /does not exist|schema cache|could not find/i.test(error.message || '');
}

export interface PublicCharacter {
  id: string;
  name: string;
  role: 'main' | 'supporting';
  imageUrl?: string;
  age?: string;
  appearance?: string;
  personality?: string;
  normalClothes?: string;
  heroName?: string;
  // Teknisk notering för bildmodellen - visas aldrig, men följer med när
  // karaktären sparas till användarens eget bibliotek
  faceNotes?: string;
}

export interface PublicBookDetails {
  book: BookProject;
  summary: PublicBookSummary;
  // Huvudpersoner först; tom om boken saknar karaktärer
  characters: PublicCharacter[];
}

// Bok + metadata för bokhandelns bokssida. null = finns inte / ej läsbar.
export async function loadPublicBookDetails(id: string): Promise<PublicBookDetails | null> {
  const [book, rowRes, charRes] = await Promise.all([
    loadBookFromCloud(id),
    // select('*') ger description om kolumnen finns, utan att fallera annars
    supabase.from('barnbok_books').select('*').eq('id', id).maybeSingle(),
    supabase.from('barnbok_characters').select('*').eq('book_id', id).order('sort_order'),
  ]);
  if (!book || !rowRes.data) return null;

  const row = rowRes.data;
  if ('description' in row) socialSupport.description = true;
  const cover = book.spreads.find(s => s.pages === 'omslag') as (Spread & { imageUrl?: string }) | undefined;
  const summary = toPublicSummary(row, cover?.imageUrl);

  const characters: PublicCharacter[] = (charRes.data || []).map((c: any) => ({
    id: c.id,
    name: c.name,
    role: c.role === 'main' ? 'main' : 'supporting',
    // Referensbilder sparas inte i molnet idag - visas om en sådan kolumn finns
    imageUrl: c.reference_image_url || c.image_url || undefined,
    age: c.age || undefined,
    appearance: c.appearance || undefined,
    personality: c.personality || undefined,
    normalClothes: c.normal_clothes || undefined,
    heroName: c.hero_name || undefined,
    faceNotes: c.face_notes || undefined,
  }));
  characters.sort((a, b) => (a.role === b.role ? 0 : a.role === 'main' ? -1 : 1));

  return { book, summary, characters };
}

// ── Karaktärer på tvärs av böcker ──

export interface CharacterAppearance {
  bookId: string;
  title: string;
  coverUrl?: string;
  authorName?: string;
}

// Andra publicerade böcker där en karaktär med samma namn finns med.
// Namnet jämförs skiftlägesokänsligt (ilike utan jokertecken = exakt match).
// Tom lista = karaktären finns bara i den här boken (eller inget kunde läsas).
export async function findCharacterAppearances(name: string, exceptBookId: string): Promise<CharacterAppearance[]> {
  const trimmed = name.trim();
  if (!trimmed) return [];

  // Undvik att % och _ i ett namn tolkas som jokertecken
  const pattern = trimmed.replace(/[%_]/g, m => `\\${m}`);
  const { data: charRows, error: charError } = await supabase
    .from('barnbok_characters')
    .select('book_id')
    .ilike('name', pattern)
    .limit(200);
  if (charError || !charRows) return [];

  const bookIds = Array.from(new Set(charRows.map(c => c.book_id as string).filter(id => id && id !== exceptBookId)));
  if (bookIds.length === 0) return [];

  const { data: bookRows, error: bookError } = await supabase
    .from('barnbok_books')
    .select('id, title, theme, published_at')
    .in('id', bookIds)
    .eq('is_public', true)
    .order('published_at', { ascending: false });
  if (bookError || !bookRows) return [];

  // Omslagen i ett anrop
  const covers = new Map<string, string>();
  const { data: coverRows } = await supabase
    .from('barnbok_spreads')
    .select('book_id, image_url')
    .in('book_id', bookRows.map(b => b.id))
    .eq('pages', 'omslag');
  for (const c of coverRows || []) {
    if (c.image_url) covers.set(c.book_id, c.image_url);
  }

  return bookRows.map(b => ({
    bookId: b.id,
    title: b.title,
    coverUrl: covers.get(b.id) || undefined,
    authorName: parseBookMeta(b.theme).author || undefined,
  }));
}

// ── Baksidestext ──

const descriptionJobs = new Map<string, Promise<string | null>>();

export function isDescriptionSupported(): boolean | undefined {
  return socialSupport.description;
}

// Ser till att boken har en baksidestext: returnerar befintlig, eller genererar
// en via /api/book-blurb och sparar den. null = ingen text (saknad migrering,
// ingen text i boken eller fel). Samma bok genereras högst en gång per sidladdning.
export function ensureBookDescription(bookId: string, book?: BookProject): Promise<string | null> {
  if (socialSupport.description === false) return Promise.resolve(null);
  const existing = descriptionJobs.get(bookId);
  if (existing) return existing;
  const job = runEnsureDescription(bookId, book).catch(() => null);
  descriptionJobs.set(bookId, job);
  return job;
}

async function runEnsureDescription(bookId: string, book?: BookProject): Promise<string | null> {
  const { data, error } = await supabase.from('barnbok_books').select('description').eq('id', bookId).maybeSingle();
  if (error) {
    if (isMissingSchema(error)) socialSupport.description = false;
    return null;
  }
  if (!data) return null;
  socialSupport.description = true;
  if (typeof data.description === 'string' && data.description.trim()) return data.description.trim();

  const source = book ?? await loadBookFromCloud(bookId);
  if (!source) return null;

  const text = source.spreads
    .filter(s => s.pages !== 'omslag')
    .flatMap(s => s.textBlocks.map(tb => tb.text.trim()))
    .filter(Boolean)
    .join('\n')
    .slice(0, 3500);
  if (text.length < 20) return null;

  const mainCharacters = source.characters.filter(c => c.role === 'main').map(c => c.name);
  const res = await fetch('/api/book-blurb', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: source.title,
      text,
      mainCharacters: mainCharacters.length > 0 ? mainCharacters : source.characters.slice(0, 3).map(c => c.name),
      targetAge: source.targetAge,
      bookFormat: source.bookFormat,
    }),
  });
  if (!res.ok) return null;
  const { description } = await res.json() as { description?: string };
  const blurb = description?.trim();
  if (!blurb) return null;

  // Publicerad bok: funktionen fyller bara i saknad text. Annars (ägarens egen
  // eller anonym bok i testläget) går en vanlig uppdatering igenom RLS.
  const { data: stored, error: rpcError } = await supabase.rpc('barnbok_set_book_description', {
    p_book_id: bookId,
    p_description: blurb,
  });
  if (rpcError || stored !== true) {
    await supabase.from('barnbok_books').update({ description: blurb }).eq('id', bookId).is('description', null);
  }
  return blurb;
}

// ── Hjärtan ──

const LIKER_KEY = 'barnbok-liker-id';

// Slumpat enhets-id för hjärtan utan inloggning (inloggade använder kontot på servern)
export function getDeviceLikerId(): string {
  try {
    const existing = window.localStorage.getItem(LIKER_KEY);
    if (existing) return existing;
    const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
    window.localStorage.setItem(LIKER_KEY, id);
    return id;
  } catch {
    return 'no-storage-device';
  }
}

// Antal hjärtan per bok-id. null = hjärtan är inte tillgängliga (migrering saknas).
export async function getLikeCounts(): Promise<Record<string, number> | null> {
  if (socialSupport.likes === false) return null;
  const { data, error } = await supabase.from('barnbok_book_like_counts').select('book_id, like_count');
  if (error) {
    if (isMissingSchema(error)) socialSupport.likes = false;
    return null;
  }
  socialSupport.likes = true;
  const counts: Record<string, number> = {};
  for (const r of data || []) counts[r.book_id] = r.like_count;
  return counts;
}

// Vilka av böckerna har den här besökaren (konto eller enhet) gillat?
export async function getMyLikedBookIds(bookIds: string[]): Promise<Set<string>> {
  if (socialSupport.likes === false || bookIds.length === 0) return new Set();
  const { data, error } = await supabase.rpc('barnbok_my_likes', {
    p_liker_id: getDeviceLikerId(),
    p_book_ids: bookIds,
  });
  if (error) {
    if (isMissingSchema(error)) socialSupport.likes = false;
    return new Set();
  }
  return new Set(((data || []) as unknown[]).map(v => (typeof v === 'string' ? v : (v as { barnbok_my_likes?: string }).barnbok_my_likes || '')).filter(Boolean));
}

// Sätt/ta bort hjärta. Returnerar nytt antal hjärtan för boken.
export async function setBookLiked(bookId: string, liked: boolean): Promise<number> {
  const { data, error } = await supabase.rpc('barnbok_set_like', {
    p_book_id: bookId,
    p_liker_id: getDeviceLikerId(),
    p_liked: liked,
  });
  if (error) {
    if (isMissingSchema(error)) socialSupport.likes = false;
    throw new Error(`Kunde inte ${liked ? 'gilla' : 'ta bort gillningen'}: ${error.message}`);
  }
  return typeof data === 'number' ? data : Number(data) || 0;
}

// ── Följ skapare ──

export interface AuthorFollowState {
  supported: boolean;
  following: boolean;
  followers: number;
}

// Följarantal och om inloggad användare (om någon) följer skaparen
export async function getAuthorFollowState(authorUserId: string): Promise<AuthorFollowState> {
  if (socialSupport.follows === false) return { supported: false, following: false, followers: 0 };

  const { data: countRow, error } = await supabase
    .from('barnbok_author_follower_counts')
    .select('follower_count')
    .eq('author_user_id', authorUserId)
    .maybeSingle();
  if (error) {
    if (isMissingSchema(error)) socialSupport.follows = false;
    return { supported: false, following: false, followers: 0 };
  }
  socialSupport.follows = true;

  let following = false;
  const { data: userData } = await supabase.auth.getUser();
  const me = userData.user?.id;
  if (me) {
    const { data: own } = await supabase
      .from('barnbok_author_follows')
      .select('author_user_id')
      .eq('follower_user_id', me)
      .eq('author_user_id', authorUserId)
      .maybeSingle();
    following = !!own;
  }
  return { supported: true, following, followers: countRow?.follower_count ?? 0 };
}

// Följ/sluta följa. Kräver inloggning.
export async function setFollowAuthor(authorUserId: string, follow: boolean): Promise<void> {
  const { data: userData } = await supabase.auth.getUser();
  const me = userData.user?.id;
  if (!me) throw new Error('Logga in för att följa skapare');
  if (me === authorUserId) throw new Error('Du kan inte följa dig själv');

  const { error } = follow
    ? await supabase
        .from('barnbok_author_follows')
        .upsert({ follower_user_id: me, author_user_id: authorUserId }, { onConflict: 'follower_user_id,author_user_id', ignoreDuplicates: true })
    : await supabase
        .from('barnbok_author_follows')
        .delete()
        .eq('follower_user_id', me)
        .eq('author_user_id', authorUserId);
  if (error) {
    if (isMissingSchema(error)) socialSupport.follows = false;
    throw new Error(`Kunde inte ${follow ? 'följa' : 'sluta följa'}: ${error.message}`);
  }
}

// ── Intresseanmälan: tryckt bok ──

// Finns tabellen för intresseanmälningar? (Besökare kan inte läsa rader - bara se att tabellen finns.)
export async function isPrintInterestSupported(): Promise<boolean> {
  if (socialSupport.printInterest !== undefined) return socialSupport.printInterest;
  // OBS: ingen head-förfrågan - postgrest-js tolkar tom 404 som "inga rader"
  const { error } = await supabase.from('barnbok_print_interest').select('id').limit(0);
  socialSupport.printInterest = !error;
  return !error;
}

// Spara "meddela mig när tryckta böcker går att beställa". Ingen beställning läggs.
export async function registerPrintInterest(bookId: string, email: string, kind: 'print' | 'audio' = 'print'): Promise<void> {
  const clean = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean) || clean.length > 254) {
    throw new Error('Ange en giltig e-postadress.');
  }
  const { data: userData } = await supabase.auth.getUser();
  const { error } = await supabase.from('barnbok_print_interest').insert({
    book_id: bookId,
    email: clean,
    user_id: userData.user?.id ?? null,
    kind,
  });
  if (error) {
    if (isMissingSchema(error)) socialSupport.printInterest = false;
    throw new Error(`Kunde inte spara intresseanmälan: ${error.message}`);
  }
}

export async function listBooksFromCloud(): Promise<BookProject[]> {
  const { data, error } = await supabase
    .from('barnbok_books')
    .select('id, title, book_format, status, created_at, updated_at, num_spreads')
    .order('updated_at', { ascending: false });

  if (error || !data) return [];

  return data.map(row => ({
    id: row.id,
    title: row.title,
    bookFormat: row.book_format,
    characters: [],
    spreads: [],
    styleGuide: '',
    status: reverseMapStatus(row.status),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function deleteBookFromCloud(id: string): Promise<void> {
  // Delete images from storage
  const { data: files } = await supabase.storage
    .from(IMAGES_BUCKET)
    .list(`books/${id}`);

  if (files && files.length > 0) {
    const paths = files.map(f => `books/${id}/${f.name}`);
    await supabase.storage.from(IMAGES_BUCKET).remove(paths);
  }

  // Delete book (cascades to characters, spreads, text_blocks)
  const { error } = await supabase
    .from('barnbok_books')
    .delete()
    .eq('id', id);

  if (error) throw new Error(`Kunde inte ta bort bok: ${error.message}`);
}

// ═══════════════════════════════════════════
//  Image storage
// ═══════════════════════════════════════════

async function uploadCharacterImage(
  bookId: string,
  characterId: string,
  base64Image: string
): Promise<{ url: string | null; error?: string }> {
  return uploadImage(`books/${bookId}/characters/${characterId}.png`, base64Image);
}

async function uploadSpreadImage(
  bookId: string,
  spreadId: string,
  base64Image: string
): Promise<{ url: string | null; error?: string }> {
  return uploadImage(`books/${bookId}/${spreadId}.png`, base64Image);
}

// Laddar upp en base64-bild till bokbilderna och ger tillbaka den publika adressen
export async function uploadImage(filePath: string, base64Image: string): Promise<{ url: string | null; error?: string }> {
  try {
    // Convert base64 to blob
    const byteCharacters = atob(base64Image);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], { type: 'image/png' });

    const { error } = await supabase.storage
      .from(IMAGES_BUCKET)
      .upload(filePath, blob, {
        contentType: 'image/png',
        upsert: true,
      });

    if (error) return { url: null, error: error.message };

    const { data: urlData } = supabase.storage
      .from(IMAGES_BUCKET)
      .getPublicUrl(filePath);

    return { url: urlData.publicUrl };
  } catch (err) {
    return { url: null, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function downloadSpreadImage(imageUrl: string): Promise<string | null> {
  try {
    const response = await fetch(imageUrl);
    const blob = await response.blob();

    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        // Remove data:image/png;base64, prefix
        const base64 = result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (err) {
    console.error('downloadSpreadImage:', err);
    return null;
  }
}

// Samma hämtning, men namnet passar även karaktärsbilder (base64 utan data:-prefix)
export const downloadImageAsBase64 = downloadSpreadImage;

// ═══════════════════════════════════════════
//  Reference/Training database
// ═══════════════════════════════════════════

export async function saveReferenceText(data: {
  bookSeries: string;
  bookTitle?: string;
  textSample: string;
  styleNotes?: string;
  targetAgeMin?: number;
  targetAgeMax?: number;
  genre?: string;
  textType?: 'narrative' | 'dialogue' | 'description' | 'opening' | 'ending';
  tags?: string[];
}): Promise<void> {
  const { error } = await supabase
    .from('barnbok_reference_texts')
    .insert({
      book_series: data.bookSeries,
      book_title: data.bookTitle,
      text_sample: data.textSample,
      style_notes: data.styleNotes,
      target_age_min: data.targetAgeMin,
      target_age_max: data.targetAgeMax,
      genre: data.genre,
      text_type: data.textType,
      tags: data.tags,
    });

  if (error) throw new Error(`Kunde inte spara referenstext: ${error.message}`);
}

export async function getReferenceTexts(
  bookSeries?: string,
  limit: number = 10
): Promise<any[]> {
  let query = supabase
    .from('barnbok_reference_texts')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (bookSeries) {
    query = query.eq('book_series', bookSeries);
  }

  const { data, error } = await query;
  if (error) return [];
  return data || [];
}

export async function saveReferenceImage(data: {
  bookSeries: string;
  description?: string;
  imageBase64: string;
  styleNotes?: string;
  layoutType?: string;
  colorPalette?: string;
  illustrationStyle?: string;
  tags?: string[];
}): Promise<void> {
  // Upload image to storage
  const fileName = `references/${data.bookSeries}/${Date.now()}.png`;

  const byteCharacters = atob(data.imageBase64);
  const byteNumbers = new Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
  const blob = new Blob([byteArray], { type: 'image/png' });

  const { error: uploadError } = await supabase.storage
    .from(IMAGES_BUCKET)
    .upload(fileName, blob, { contentType: 'image/png', upsert: true });

  if (uploadError) throw new Error(`Upload: ${uploadError.message}`);

  const { data: urlData } = supabase.storage
    .from(IMAGES_BUCKET)
    .getPublicUrl(fileName);

  const { error } = await supabase
    .from('barnbok_reference_images')
    .insert({
      book_series: data.bookSeries,
      description: data.description,
      image_url: urlData.publicUrl,
      style_notes: data.styleNotes,
      layout_type: data.layoutType,
      color_palette: data.colorPalette,
      illustration_style: data.illustrationStyle,
      tags: data.tags,
    });

  if (error) throw new Error(`Kunde inte spara referensbild: ${error.message}`);
}

export async function getReferenceImages(
  bookSeries?: string,
  limit: number = 10
): Promise<any[]> {
  let query = supabase
    .from('barnbok_reference_images')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (bookSeries) {
    query = query.eq('book_series', bookSeries);
  }

  const { data, error } = await query;
  if (error) return [];
  return data || [];
}

export async function saveStyleProfile(data: {
  bookSeries: string;
  textStyle?: string;
  imageStyle?: string;
  typicalAgeMin?: number;
  typicalAgeMax?: number;
  typicalFormat?: string;
  examplePrompts?: string[];
  notes?: string;
}): Promise<void> {
  const { error } = await supabase
    .from('barnbok_style_profiles')
    .upsert({
      book_series: data.bookSeries,
      text_style: data.textStyle,
      image_style: data.imageStyle,
      typical_age_min: data.typicalAgeMin,
      typical_age_max: data.typicalAgeMax,
      typical_format: data.typicalFormat,
      example_prompts: data.examplePrompts,
      notes: data.notes,
    }, { onConflict: 'book_series' });

  if (error) throw new Error(`Stilprofil: ${error.message}`);
}

export async function getStyleProfile(bookSeries: string): Promise<any | null> {
  const { data, error } = await supabase
    .from('barnbok_style_profiles')
    .select('*')
    .eq('book_series', bookSeries)
    .single();

  if (error) return null;
  return data;
}

// ═══════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════

function buildTheme(book: BookProject): string {
  // Bildtyper per uppslag sparas här så att ingen tabelländring behövs
  const compositions = Object.fromEntries(book.spreads.filter(sp => sp.composition).map(sp => [sp.spreadNumber, sp.composition]));
  return JSON.stringify({
    v: 1, stylePresetId: book.stylePresetId, illustrationShape: book.illustrationShape, author: book.author?.trim() || undefined,
    ...(Object.keys(compositions).length > 0 ? { compositions } : {}),
  });
}

function spreadLabel(spread: Spread): string {
  return spread.pages === 'omslag' ? 'omslag' : spread.pages === 'slutsida' ? 'slutsida' : `sida ${spread.pages}`;
}

function parseBookMeta(theme: unknown): Pick<BookProject, 'stylePresetId' | 'illustrationShape' | 'author'> & { compositions?: Record<string, Spread['composition']> } {
  if (typeof theme !== 'string' || !theme.startsWith('{')) return {};
  try {
    const meta = JSON.parse(theme);
    return { stylePresetId: meta.stylePresetId, illustrationShape: meta.illustrationShape, author: meta.author, compositions: meta.compositions };
  } catch {
    return {};
  }
}

function parseAgeMin(targetAge?: string): number {
  if (!targetAge) return 3;
  const m = targetAge.match(/(\d+)/);
  return m ? parseInt(m[1], 10) : 3;
}

function parseAgeMax(targetAge?: string): number {
  if (!targetAge) return 6;
  const m = targetAge.match(/\d+\s*-\s*(\d+)/);
  return m ? parseInt(m[1], 10) : parseAgeMin(targetAge) + 3;
}

function mapStatus(status: string): string {
  switch (status) {
    case 'importing':
    case 'characters':
      return 'draft';
    case 'generating':
      return 'generating';
    case 'reviewing':
    case 'done':
      return 'complete';
    default:
      return 'draft';
  }
}

function reverseMapStatus(status: string): BookProject['status'] {
  switch (status) {
    case 'draft': return 'importing';
    case 'generating': return 'generating';
    case 'complete': return 'reviewing';
    default: return 'importing';
  }
}
