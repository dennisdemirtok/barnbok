// Serverside-hämtning av stilprofiler och språkexempel från analyserade referensböcker

function supabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return url && key ? { url, key } : null;
}

export async function fetchStyleProfile(series: string): Promise<{ text_style?: string; image_style?: string } | null> {
  const env = supabaseEnv();
  if (!env) return null;
  try {
    const res = await fetch(
      `${env.url}/rest/v1/barnbok_style_profiles?book_series=eq.${encodeURIComponent(series)}&select=text_style,image_style`,
      { headers: { apikey: env.key, Authorization: `Bearer ${env.key}` } }
    );
    if (!res.ok) return null;
    const rows = await res.json();
    return rows[0] || null;
  } catch {
    return null;
  }
}

export async function fetchLanguageExamples(series: string): Promise<string[]> {
  const env = supabaseEnv();
  if (!env) return [];
  try {
    const res = await fetch(
      `${env.url}/rest/v1/barnbok_reference_texts?book_series=eq.${encodeURIComponent(series)}&select=text_sample&limit=12`,
      { headers: { apikey: env.key, Authorization: `Bearer ${env.key}` } }
    );
    if (!res.ok) return [];
    const rows = await res.json();
    return rows.map((r: { text_sample: string }) => r.text_sample).filter(Boolean);
  } catch {
    return [];
  }
}
