import { NextResponse } from 'next/server';
import { describeChildFromPhotos, PhotoInput } from '@/lib/photo-character';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Läser av fotona och föreslår ålder, utseende och kläder. Fotona sparas inte.
export async function POST(request: Request) {
  try {
    const { photos } = await request.json() as { photos?: PhotoInput[] };
    const valid = (photos || []).filter(p => p?.data && /^image\/(jpeg|png|webp)$/.test(p.mimeType)).slice(0, 4);
    if (valid.length === 0) return NextResponse.json({ error: 'Lägg till minst ett foto' }, { status: 400 });
    return NextResponse.json(await describeChildFromPhotos(valid));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okänt fel';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
