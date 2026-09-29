// Karaktär från foto: läser av hur barnet på fotona ser ut, så att fälten kan
// fyllas i åt föräldern. Claude gör avläsningen - Googles filter stoppar ofta
// beskrivningar av barn på foton, även helt vanliga porträtt.
import Anthropic from '@anthropic-ai/sdk';
import { getClient, resolveLatestModel } from './claude';

export interface PhotoInput { data: string; mimeType: string }

export interface PhotoDescription {
  age: string;
  appearance: string;
  normalClothes: string;
}

const SCHEMA = {
  type: 'object',
  properties: {
    age: { type: 'string' },
    appearance: { type: 'string' },
    normal_clothes: { type: 'string' },
  },
  required: ['age', 'appearance', 'normal_clothes'],
  additionalProperties: false,
} as const;

type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';

export async function describeChildFromPhotos(photos: PhotoInput[]): Promise<PhotoDescription> {
  const client = getClient();
  const model = await resolveLatestModel(client);

  const content: Anthropic.ContentBlockParam[] = [
    ...photos.map(p => ({
      type: 'image' as const,
      source: { type: 'base64' as const, media_type: p.mimeType as ImageMediaType, data: p.data },
    })),
    {
      type: 'text',
      text: `En förälder vill göra sitt barn till en tecknad figur i en egen barnbok och har laddat upp de här fotona. Beskriv bara det som syns, så att en illustratör kan rita figuren lik barnet. Gissa aldrig vem det är.

- age: ungefärlig ålder, t.ex. "7 år"
- appearance: 1-2 meningar: hår (färg, längd, frisyr), ögon, ansiktsform, hudton och det som gör barnet igenkännbart (fräknar, tandlucka, gropar, glasögon). Konkret, inga känslor, inga kläder.
- normal_clothes: en kort fras om kläderna barnet brukar ha på fotona, utan märken, siffror eller text.`,
    },
  ];

  const response = await client.messages.create({
    model,
    max_tokens: 2000,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
    messages: [{ role: 'user', content }],
  });

  if (response.stop_reason === 'refusal') {
    throw new Error('Fotona kunde inte läsas av automatiskt - fyll i utseendet själv');
  }
  const text = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text')?.text || '';
  const raw = JSON.parse(text) as { age?: string; appearance?: string; normal_clothes?: string };
  return {
    age: (raw.age || '').trim(),
    appearance: (raw.appearance || '').trim(),
    normalClothes: (raw.normal_clothes || '').trim(),
  };
}
