import { NextRequest, NextResponse } from 'next/server';
import { parseBookData } from '@/lib/parser';

export async function POST(request: NextRequest) {
  try {
    const { rawText } = await request.json();

    if (!rawText || typeof rawText !== 'string') {
      return NextResponse.json(
        { error: 'Boktext saknas' },
        { status: 400 }
      );
    }

    const bookProject = parseBookData(rawText);

    return NextResponse.json(bookProject);
  } catch (error) {
    console.error('Parse error:', error);
    return NextResponse.json(
      { error: 'Kunde inte parsa bokdatan' },
      { status: 500 }
    );
  }
}
