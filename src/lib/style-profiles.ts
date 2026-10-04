// Serverside-hämtning av stilprofiler och språkexempel från analyserade referensböcker.
// Läses med serverns nyckel så att tabellerna kan låsas för webbläsaren
// (scripts/reference-rls-migration.sql) - utan servernyckel används anon-nyckeln som förut.
import { serverSupabase } from './supabase-server';

export async function fetchStyleProfile(series: string): Promise<{ text_style?: string; image_style?: string } | null> {
  try {
    const { data, error } = await serverSupabase()
      .from('barnbok_style_profiles')
      .select('text_style,image_style')
      .eq('book_series', series)
      .maybeSingle();
    return error ? null : data;
  } catch {
    return null;
  }
}

export async function fetchLanguageExamples(series: string): Promise<string[]> {
  try {
    const { data, error } = await serverSupabase()
      .from('barnbok_reference_texts')
      .select('text_sample')
      .eq('book_series', series)
      .limit(12);
    if (error || !data) return [];
    return data.map((r: { text_sample: string }) => r.text_sample).filter(Boolean);
  } catch {
    return [];
  }
}
