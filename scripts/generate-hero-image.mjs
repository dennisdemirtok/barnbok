// Genererar en hero-illustration för startsidan med Gemini och sparar till public/.
// Körs en gång: node scripts/generate-hero-image.mjs

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const env = {};
for (const line of readFileSync(join(ROOT, '.env.local'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.+)$/);
  if (m) env[m[1]] = m[2].trim();
}
const KEY = env.GEMINI_API_KEY;
const MODEL = 'gemini-3.1-flash-image-preview';

const prompt = `A magical, glowing open storybook floating in mid-air, emitting golden sparkles and soft ethereal light. The open pages show vibrant, whimsical illustrations of a friendly green dragon and a small child with a red cape. Dreamy nursery background in soft pastel purple, magenta and blue tones, bokeh light. Modern high-end digital art, warm and inviting, transparent-feeling clean composition centered with empty space around the book. No text anywhere in the image.`;

const res = await fetch(
  `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ['IMAGE'] },
    }),
  }
);

if (!res.ok) {
  console.error('Gemini-fel:', res.status, await res.text());
  process.exit(1);
}

const data = await res.json();
const part = data.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
if (!part) {
  console.error('Ingen bild i svaret');
  process.exit(1);
}

mkdirSync(join(ROOT, 'public'), { recursive: true });
const out = join(ROOT, 'public', 'hero-book.png');
writeFileSync(out, Buffer.from(part.inlineData.data, 'base64'));
console.log('Hero-bild sparad:', out);
