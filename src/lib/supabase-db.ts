import { supabase, IMAGES_BUCKET } from './supabase';
import { BookProject, Character, Spread, TextBlock, SavedCharacter, SavedText } from './types';

// ═══════════════════════════════════════════
//  Book operations (same API as storage.ts)
// ═══════════════════════════════════════════

export async function saveBookToCloud(book: BookProject): Promise<void> {
  const now = new Date().toISOString();

  // 1. Upsert the book record
  const { error: bookError } = await supabase
    .from('barnbok_books')
    .upsert({
      id: book.id,
      title: book.title,
      book_format: book.bookFormat || 'bildbok-text-pa-bild',
      age_min: parseAgeMin(book.targetAge),
      age_max: parseAgeMax(book.targetAge),
      theme: book.styleGuide,
      num_spreads: book.spreads.length,
      style: book.styleGuide,
      status: mapStatus(book.status),
      updated_at: now,
    }, { onConflict: 'id' });

  if (bookError) throw new Error(`Kunde inte spara bok: ${bookError.message}`);

  // 2. Save characters
  if (book.characters.length > 0) {
    // Delete existing characters for this book, then re-insert
    await supabase.from('barnbok_characters').delete().eq('book_id', book.id);

    const charRows = book.characters.map((c, i) => ({
      id: c.id,
      book_id: book.id,
      name: c.name,
      appearance: c.appearance,
      role: c.role === 'villain' ? 'supporting' : c.role,
      approved: c.approved,
      sort_order: i,
    }));

    const { error: charError } = await supabase
      .from('barnbok_characters')
      .insert(charRows);

    if (charError) console.error('Karaktärer:', charError.message);
  }

  // 3. Save spreads + text blocks
  if (book.spreads.length > 0) {
    // Delete existing spreads (cascades to text_blocks)
    await supabase.from('barnbok_spreads').delete().eq('book_id', book.id);

    for (const spread of book.spreads) {
      // Upload image to Supabase Storage if it exists
      let imageUrl: string | null = null;
      if (spread.generatedImage) {
        imageUrl = await uploadSpreadImage(book.id, spread.id, spread.generatedImage);
      }

      const { error: spreadError } = await supabase
        .from('barnbok_spreads')
        .insert({
          id: spread.id,
          book_id: book.id,
          spread_number: spread.spreadNumber,
          pages: spread.pages,
          chapter: spread.chapter || null,
          image_prompt: spread.imagePrompt,
          image_url: imageUrl,
          image_status: spread.status === 'error' ? 'failed' : spread.status,
          sort_order: spread.spreadNumber,
        });

      if (spreadError) {
        console.error(`Uppslag ${spread.pages}:`, spreadError.message);
        continue;
      }

      // Save text blocks
      if (spread.textBlocks.length > 0) {
        const textRows = spread.textBlocks.map((tb, i) => ({
          spread_id: spread.id,
          text_content: tb.text,
          position: i,
        }));

        const { error: tbError } = await supabase
          .from('barnbok_text_blocks')
          .insert(textRows);

        if (tbError) console.error(`Text blocks:`, tbError.message);
      }
    }
  }
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
  const characters: Character[] = (charRows || []).map(c => ({
    id: c.id,
    name: c.name,
    appearance: c.appearance || '',
    role: c.role as 'main' | 'supporting',
    approved: c.approved,
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

async function uploadSpreadImage(
  bookId: string,
  spreadId: string,
  base64Image: string
): Promise<string | null> {
  try {
    // Convert base64 to blob
    const byteCharacters = atob(base64Image);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], { type: 'image/png' });

    const filePath = `books/${bookId}/${spreadId}.png`;

    const { error } = await supabase.storage
      .from(IMAGES_BUCKET)
      .upload(filePath, blob, {
        contentType: 'image/png',
        upsert: true,
      });

    if (error) {
      console.error('Bilduppladdning:', error.message);
      return null;
    }

    const { data: urlData } = supabase.storage
      .from(IMAGES_BUCKET)
      .getPublicUrl(filePath);

    return urlData.publicUrl;
  } catch (err) {
    console.error('uploadSpreadImage:', err);
    return null;
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
