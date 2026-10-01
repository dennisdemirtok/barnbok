// Omslag till en ljudbok från text: Claude läser texten och beskriver en
// omslagsbild som bildmodellen sedan ritar i vald stil.
import Anthropic from '@anthropic-ai/sdk';
import { getClient, resolveLatestModel } from './claude';

// Början av texten räcker för att fånga figurer, miljö och stämning
export const COVER_TEXT_CHARS = 14_000;

const SCHEMA = {
  type: 'object',
  properties: { scene: { type: 'string' } },
  required: ['scene'],
  additionalProperties: false,
} as const;

export async function describeAudiobookCover(title: string, text: string): Promise<string> {
  const client = getClient();
  const model = await resolveLatestModel(client);
  const excerpt = text.slice(0, COVER_TEXT_CHARS);

  const response = await client.messages.create({
    model,
    max_tokens: 2000,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
    messages: [{
      role: 'user',
      content: `Du gör omslaget till en ljudbok för barn. Läs texten och beskriv omslagsbilden för en illustratör.

TITEL: "${title}"

TEXTEN (${excerpt.length < text.length ? 'början' : 'hela'}):
"""
${excerpt}
"""

Skriv fältet scene på ENGELSKA, 3-5 meningar:
- Huvudpersonen, eller högst två-tre viktiga figurer, med konkret utseende: ungefärlig ålder, hår, kläder. Använd det som står i texten och hitta på resten så att det passar berättelsen.
- En miljö och ett föremål eller ögonblick som är typiskt för berättelsen, utan att avslöja slutet.
- Stämningen: ljus, tid på dygnet, väder.
- Ett enkelt, tydligt motiv som syns även när omslaget visas litet, med en lugn yta upptill där titeln ska stå.
Beskriv ingen ritstil (den läggs på separat). Inga ord, bokstäver eller skyltar i bilden - titeln läggs till separat.`,
    }],
  });

  if (response.stop_reason === 'refusal') {
    throw new Error('Texten kunde inte användas för ett omslag automatiskt - beskriv omslaget själv under Önskemål');
  }
  const raw = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text')?.text || '';
  const scene = (JSON.parse(raw) as { scene?: string }).scene?.trim();
  if (!scene) throw new Error('Fick ingen omslagsbeskrivning - försök igen');
  return scene;
}
