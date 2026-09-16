import { NextResponse } from 'next/server';
import { cancelJob } from '@/lib/job-queue';

export async function POST(_request: Request, { params }: { params: { id: string } }) {
  await cancelJob(params.id);
  return NextResponse.json({ ok: true });
}
