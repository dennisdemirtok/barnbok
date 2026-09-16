/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverSupabase, hasServiceRole } from '@/lib/supabase-server';
import { claimNextItem } from '@/lib/job-queue';

export const dynamic = 'force-dynamic';

// Felsökning: ser serverns nyckel samma rader som webbläsarens?
export async function GET(request: Request) {
  const jobId = new URL(request.url).searchParams.get('jobId');
  if (!jobId) return NextResponse.json({ error: 'jobId saknas' }, { status: 400 });

  const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  const read = async (db: { from: (t: string) => any }) => {
    const { data, error } = await db
      .from('barnbok_job_items')
      .select('label, status, attempts')
      .eq('job_id', jobId)
      .eq('status', 'queued')
      .order('spread_number')
      .limit(3);
    return { antal: data?.length ?? 0, forsta: (data?.[0] as { label?: string })?.label ?? null, fel: error?.message ?? null };
  };

  // Provskrivning: sätter samma värde tillbaka, men visar om skrivningen biter
  const write = async (db: { from: (t: string) => any }) => {
    const { data: row } = await db.from('barnbok_job_items').select('id, status').eq('job_id', jobId).limit(1);
    const first = row?.[0] as { id: string; status: string } | undefined;
    if (!first) return { rader: 0, fel: 'ingen rad att prova på' };
    const { data, error } = await db
      .from('barnbok_job_items')
      .update({ status: first.status, updated_at: new Date().toISOString() })
      .eq('id', first.id)
      .select('id');
    return { rader: data?.length ?? 0, fel: error?.message ?? null };
  };

  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  return NextResponse.json({
    servernyckelFinns: hasServiceRole(),
    nyckelBorjar: key ? `${key.slice(0, 8)}...${key.slice(-4)}` : null,
    nyckelLangd: key.length,
    medServernyckel: await read(serverSupabase()),
    medAnonNyckel: await read(anon),
    skrivningServernyckel: await write(serverSupabase()),
    skrivningAnonNyckel: await write(anon),
    // Exakt samma funktion som arbetarna använder
    koTest: await claimNextItem(jobId).then(
      r => ({ fick: r?.label ?? null, forsok: r?.attempts ?? null }),
      e => ({ fel: e instanceof Error ? e.message : String(e) })
    ),
  });
}
