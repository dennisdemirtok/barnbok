import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';
import { Character } from '@/lib/types';

export const maxDuration = 30;

function getClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY saknas');
  return new GoogleGenAI({ apiKey });
}

export async function POST(request: NextRequest) {
  try {
    const { generatedImage, characters } = await request.json() as {
      generatedImage: string;
      characters: Character[];
    };

    if (!generatedImage || !characters || characters.length === 0) {
      return NextResponse.json(
        { error: 'Bild och karaktarer kravs' },
        { status: 400 }
      );
    }

    const ai = getClient();

    // Build character description for analysis
    const charDescriptions = characters.map(c =>
      `- ${c.name}: ${c.appearance}${c.heroCostume ? `. Kostym: ${c.heroCostume}` : ''}`
    ).join('\n');

    const prompt = `You are a quality control system for children's book illustrations. Analyze this illustration and check if the characters match their descriptions.

CHARACTERS THAT SHOULD APPEAR:
${charDescriptions}

ANALYZE THE IMAGE AND RESPOND IN THIS EXACT JSON FORMAT:
{
  "passed": true/false,
  "characters_found": number,
  "characters_expected": ${characters.length},
  "issues": [
    {
      "character": "character name",
      "issue": "brief description of mismatch",
      "severity": "minor" or "major"
    }
  ],
  "summary": "Brief overall assessment in Swedish"
}

CHECK FOR:
1. Is each character present in the image?
2. Do hair color, clothing, and key features match the descriptions?
3. Are any characters duplicated (appearing more than once)?
4. Are proportions and style consistent?

Mark as "passed": true if characters are reasonably recognizable (minor style variations are OK).
Mark as "passed": false if characters are wrong (wrong hair color, missing characters, duplicated, etc).

RESPOND WITH ONLY THE JSON, no other text.`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: [
        { text: prompt },
        {
          inlineData: {
            mimeType: 'image/png',
            data: generatedImage,
          },
        },
      ],
    });

    const responseText = response.candidates?.[0]?.content?.parts?.[0];
    if (!responseText || !('text' in responseText)) {
      throw new Error('Inget svar fran Gemini');
    }

    // Parse JSON from response
    const jsonMatch = (responseText.text || '').match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Kunde inte tolka svaret');
    }

    const analysis = JSON.parse(jsonMatch[0]);

    return NextResponse.json(analysis);
  } catch (error) {
    console.error('Character check error:', error);
    const message = error instanceof Error ? error.message : 'Okant fel';
    return NextResponse.json(
      { error: `Karaktarskontroll misslyckades: ${message}` },
      { status: 500 }
    );
  }
}
