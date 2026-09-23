import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverSupabase, hasServiceRole } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

// Admin rättar text i någon annans bok. Behörigheten avgörs här på servern:
// den inloggades e-post måste finnas i ADMIN_EMAILS. Flaggan /?admin=1 i
// webbläsaren räcker inte - den kan vem som helst sätta.
export async function POST(request: Request) {
  try {
    const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
    if (!token) return NextResponse.json({ error: 'Logga in som admin för att rätta andras böcker' }, { status: 401 });

    const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
    const { data: userData, error: userError } = await anon.auth.getUser(token);
    const email = userData.user?.email?.toLowerCase();
    const admins = (process.env.ADMIN_EMAILS || process.env.NEXT_PUBLIC_ADMIN_EMAILS || '')
      .split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
    if (userError || !email || !admins.includes(email)) {
      return NextResponse.json({ error: 'Du har inte behörighet att rätta den här boken' }, { status: 403 });
    }
    if (!hasServiceRole()) {
      return NextResponse.json({ error: 'Servern saknar sin servernyckel (SUPABASE_SERVICE_ROLE_KEY)' }, { status: 503 });
    }

    const { bookId, spreadId, texts } = await request.json() as { bookId?: string; spreadId?: string; texts?: string[] };
    if (!bookId || !spreadId || !Array.isArray(texts)) {
      return NextResponse.json({ error: 'bookId, spreadId och texts behövs' }, { status: 400 });
    }

    const db = serverSupabase();
    // Uppslaget måste höra till boken
    const { data: spread } = await db.from('barnbok_spreads').select('id').eq('id', spreadId).eq('book_id', bookId).maybeSingle();
    if (!spread) return NextResponse.json({ error: 'Uppslaget finns inte i boken' }, { status: 404 });

    let updated = 0;
    for (let position = 0; position < texts.length; position++) {
      const { data, error } = await db
        .from('barnbok_text_blocks')
        .update({ text_content: String(texts[position]).slice(0, 20000) })
        .eq('spread_id', spreadId)
        .eq('position', position)
        .select('spread_id');
      if (error) throw new Error(error.message);
      updated += data?.length ?? 0;
    }
    await db.from('barnbok_books').update({ updated_at: new Date().toISOString() }).eq('id', bookId);
    console.log(`[admin] ${email} rättade text på uppslag ${spreadId} i ${bookId}`);
    return NextResponse.json({ ok: true, updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okänt fel';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
