import { NextResponse } from 'next/server';
import { generateBookBlurb } from '@/lib/claude';

export const maxDuration = 60;

const MAX_TITLE = 200;
const MAX_TEXT = 4000;
const MAX_CHARACTERS = 8;
const MAX_DESCRIPTION = 600;

// Kort baksidestext (2-3 meningar, inga spoilers) för bokhandeln.
// Klienten skickar titel, början av texten och huvudpersoner; allt avkortas här
// så att routen inte kan användas för stora godtyckliga genereringar.
export async function POST(request: Request) {
  try {
    const body = await request.json() as {
      title?: unknown;
      text?: unknown;
      mainCharacters?: unknown;
      targetAge?: unknown;
      bookFormat?: unknown;
    };

    const title = typeof body.title === 'string' ? body.title.trim().slice(0, MAX_TITLE) : '';
    const text = typeof body.text === 'string' ? body.text.trim().slice(0, MAX_TEXT) : '';
    const mainCharacters = Array.isArray(body.mainCharacters)
      ? body.mainCharacters
          .filter((n): n is string => typeof n === 'string' && n.trim().length > 0)
          .map(n => n.trim().slice(0, 60))
          .slice(0, MAX_CHARACTERS)
      : [];
    const targetAge = typeof body.targetAge === 'string' ? body.targetAge.slice(0, 20) : undefined;
    const bookFormat = typeof body.bookFormat === 'string' ? body.bookFormat.slice(0, 40) : undefined;

    if (!title || text.length < 20) {
      return NextResponse.json({ error: 'Titel och text krävs för en baksidestext' }, { status: 400 });
    }

    const description = await generateBookBlurb({ title, text, mainCharacters, targetAge, bookFormat });
    return NextResponse.json({ description: description.slice(0, MAX_DESCRIPTION) });
  } catch (error) {
    console.error('Book blurb error:', error);
    const message = error instanceof Error ? error.message : 'Okänt fel';
    return NextResponse.json({ error: `Kunde inte skriva baksidestext: ${message}` }, { status: 500 });
  }
}
