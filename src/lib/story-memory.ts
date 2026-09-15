// Berättelseminne (server): kom ihåg namn, titlar, miljöer och idéer från nyligen
// genererade böcker så att nästa bok inte upprepar dem. Sparas i Supabase
// (scripts/story-memory.sql) med serverns arbetsminne som reserv.

export interface StoryFingerprint {
  kind: 'plot' | 'beginning';
  style?: string;
  title?: string;
  names: string[];
  setting?: string;
  premise?: string;
  opening?: string;
}

const LOCAL: StoryFingerprint[] = [];
let tableMissing = false;

function supabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return url && key ? { url, key } : null;
}

async function rpc<T>(fn: string, body: unknown): Promise<T | null> {
  const env = supabaseEnv();
  if (!env || tableMissing) return null;
  try {
    const res = await fetch(`${env.url}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: env.key, Authorization: `Bearer ${env.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(4000),
    });
    // Funktionen finns inte än: använd bara arbetsminnet tills migrationen körts
    if (res.status === 404) { tableMissing = true; return null; }
    if (!res.ok) return null;
    const text = await res.text();
    return (text ? JSON.parse(text) : null) as T;
  } catch {
    return null;
  }
}

export async function recentStories(limit = 40): Promise<StoryFingerprint[]> {
  const rows = await rpc<StoryFingerprint[]>('barnbok_recent_stories', { p_limit: limit });
  if (rows && rows.length > 0) return rows;
  return LOCAL.slice(-limit).reverse();
}

export async function rememberStory(fp: StoryFingerprint): Promise<void> {
  LOCAL.push(fp);
  if (LOCAL.length > 200) LOCAL.splice(0, LOCAL.length - 200);
  await rpc('barnbok_remember_story', {
    p_kind: fp.kind,
    p_style: fp.style ?? null,
    p_title: fp.title ?? null,
    p_names: fp.names.slice(0, 8),
    p_setting: fp.setting ?? null,
    p_premise: fp.premise ?? null,
    p_opening: fp.opening ?? null,
  });
}

// Kompakt "undvik detta"-block till prompten
export function memoryBlock(recent: StoryFingerprint[]): string {
  if (recent.length === 0) return '';
  const names = Array.from(new Set(recent.flatMap(r => r.names))).slice(0, 40);
  const titles = recent.map(r => r.title).filter(Boolean).slice(0, 15);
  const settings = recent.map(r => r.setting).filter(Boolean).slice(0, 15);
  const premises = recent.map(r => r.premise).filter(Boolean).slice(0, 10);
  const openings = recent.map(r => r.opening).filter(Boolean).slice(0, 8);
  const lines = ['NYLIGEN ANVÄNT I ANDRA BÖCKER - upprepa inte, hitta på något eget:'];
  if (names.length) lines.push(`- Namn: ${names.join(', ')}`);
  if (titles.length) lines.push(`- Titlar: ${titles.map(t => `«${t}»`).join(', ')}`);
  if (settings.length) lines.push(`- Miljöer: ${settings.join('; ')}`);
  if (premises.length) lines.push(`- Idéer: ${premises.join(' | ')}`);
  if (openings.length) lines.push(`- Öppningsmeningar: ${openings.join(' | ')}`);
  return lines.join('\n');
}

export function avoidTextOf(recent: StoryFingerprint[]): string {
  return recent.map(r => [r.setting, r.premise].filter(Boolean).join(' ')).join(' ');
}
