import { NextResponse } from 'next/server';
import { suggestCharacter, CharacterFields } from '@/lib/claude';

export const maxDuration = 60;

// Slumpar en karaktär eller fyller i det som saknas i en påbörjad
export async function POST(request: Request) {
  try {
    const { fields, hint, hero } = await request.json() as {
      fields?: Partial<CharacterFields>;
      hint?: string;
      hero?: boolean;
    };
    // Bara kända textfält, och korta - det är en ifyllnadshjälp
    const allowed: (keyof CharacterFields)[] = ['name', 'age', 'role', 'appearance', 'normalClothes', 'personality', 'heroName', 'heroCostume', 'power'];
    const partial: Partial<CharacterFields> = {};
    for (const key of allowed) {
      const value = fields?.[key];
      if (typeof value === 'string' && value.trim()) {
        (partial as Record<string, string>)[key] = value.trim().slice(0, 600);
      }
    }
    const character = await suggestCharacter(partial, { hint: hint?.trim().slice(0, 300) || undefined, hero: !!hero });
    return NextResponse.json({ character });
  } catch (error) {
    console.error('Slumpa karaktär misslyckades:', error);
    const message = error instanceof Error ? error.message : 'Okänt fel';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
