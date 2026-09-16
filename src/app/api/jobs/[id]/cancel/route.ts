import { NextResponse } from 'next/server';
import { cancelJob } from '@/lib/job-queue';

// Jobbstatus får aldrig cachas - den ändras hela tiden
export const dynamic = 'force-dynamic';

export async function POST(_request: Request, { params }: { params: { id: string } }) {
  await cancelJob(params.id);
  return NextResponse.json({ ok: true });
}
