import { NextResponse } from 'next/server';
import { describeAudiobookCover, COVER_TEXT_CHARS } from '@/lib/audiobook-cover';
import { generateAudiobookCover } from '@/lib/gemini';
import { fetchStyleProfile } from '@/lib/style-profiles';
import { composeStyleGuide, getStylePreset } from '@/lib/styles';

export const maxDuration = 300;

// Omslag till en ljudbok från text. Första gången läser Claude texten och
// beskriver bilden; "Gör ett nytt" skickar med samma beskrivning och får en ny
// bild utan att texten behöver läsas igen.
export async function POST(request: Request) {
  try {
    const { title, text, styleId, scene, wish } = await request.json() as {
      title?: string; text?: string; styleId?: string; scene?: string; wish?: string;
    };
    const cleanTitle = title?.trim();
    if (!cleanTitle) return NextResponse.json({ error: 'Skriv bokens titel först' }, { status: 400 });
    const preset = getStylePreset(styleId);
    if (!preset) return NextResponse.json({ error: 'Välj en stil för omslaget' }, { status: 400 });
    const cleanWish = wish?.trim().slice(0, 600) || undefined;

    let coverScene = scene?.trim().slice(0, 3000);
    if (!coverScene) {
      if (!text?.trim()) return NextResponse.json({ error: 'Texten saknas' }, { status: 400 });
      try {
        coverScene = await describeAudiobookCover(cleanTitle, text.slice(0, COVER_TEXT_CHARS));
      } catch (err) {
        // Har författaren beskrivit omslaget själv räcker det
        if (!cleanWish) throw err;
        coverScene = 'An inviting cover scene for this story, as the author describes it below.';
      }
    }

    const profile = preset.series ? await fetchStyleProfile(preset.series).catch(() => null) : null;
    const styleGuide = composeStyleGuide(preset, profile?.image_style);
    const image = await generateAudiobookCover({ title: cleanTitle, scene: coverScene, styleGuide, wish: cleanWish });
    return NextResponse.json({ image, scene: coverScene });
  } catch (error) {
    console.error('Ljudboksomslag misslyckades:', error);
    const message = error instanceof Error ? error.message : 'Okänt fel';
    return NextResponse.json({ error: `Omslaget kunde inte skapas: ${message}` }, { status: 500 });
  }
}
