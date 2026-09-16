import { NextResponse } from 'next/server';
import { getJob } from '@/lib/job-queue';

// Jobbstatus får aldrig cachas - den ändras hela tiden
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const job = await getJob(params.id);
  if (!job) return NextResponse.json({ error: 'Jobbet hittades inte' }, { status: 404 });
  return NextResponse.json({ job });
}
