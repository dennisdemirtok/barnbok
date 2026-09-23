import { supabase } from './supabase';
import { Spread } from './types';

// saved   = all text på uppslaget är uppdaterad i molnet
// denied  = inget ändrades (ingen behörighet, eller uppslaget finns inte i molnet)
// partial = bara en del av textblocken hittades i molnet
export type TextSyncResult = 'saved' | 'denied' | 'partial';

// Rättar texten på ett uppslag i molnet utan att röra bilder, ägare eller
// andra uppslag. Raderna uppdateras på plats, så radernas ägare (user_id)
// ligger kvar och radernas behörighetsregler gäller som vanligt.
export async function updateSpreadTextInCloud(bookId: string, spread: Spread): Promise<TextSyncResult> {
  if (spread.textBlocks.length === 0) return 'saved';

  const results = await Promise.all(spread.textBlocks.map((block, position) =>
    supabase
      .from('barnbok_text_blocks')
      .update({ text_content: block.text })
      .eq('spread_id', spread.id)
      .eq('position', position)
      .select('spread_id')
  ));

  const failed = results.find(r => r.error);
  if (failed?.error) throw new Error(`Kunde inte spara texten i molnet: ${failed.error.message}`);

  const updated = results.filter(r => (r.data?.length ?? 0) > 0).length;
  if (updated === 0) return adminFallback(bookId, spread);

  // Bokens ändringsdatum följer med (tyst om det inte går)
  await supabase
    .from('barnbok_books')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', bookId)
    .then(() => undefined, () => undefined);

  return updated < spread.textBlocks.length ? 'partial' : 'saved';
}

// Boken ägs av någon annan: en inloggad admin får rätta via servern, som själv
// kontrollerar behörigheten mot sin adminlista
async function adminFallback(bookId: string, spread: Spread): Promise<TextSyncResult> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return 'denied';
  const res = await fetch('/api/admin/spread-text', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ bookId, spreadId: spread.id, texts: spread.textBlocks.map(b => b.text) }),
  }).catch(() => null);
  if (!res?.ok) return 'denied';
  const body = await res.json().catch(() => null) as { updated?: number } | null;
  return (body?.updated ?? 0) >= spread.textBlocks.length ? 'saved' : 'partial';
}
