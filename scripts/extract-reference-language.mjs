// Extraherar det FAKTISKA svenska språket från fotade referensböcker och
// sparar korta representativa exempelmeningar i barnbok_reference_texts.
// Dessa används som few-shot-förebilder så att genererade böcker får samma
// naturliga rytm och ton istället för att bli stolpiga.
//
// VIKTIGT: endast korta exempelpassager sparas som STILREFERENS - aldrig hela
// boken. Genereringsprompten instruerar Claude att lära sig tonen, inte kopiera.
//
// Körs med: node scripts/extract-reference-language.mjs

import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const BOOKS_DIR = join(ROOT, 'referensbocker');

const env = {};
for (const line of readFileSync(join(ROOT, '.env.local'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.+)$/);
  if (m) env[m[1]] = m[2].trim();
}
const GEMINI_KEY = env.GEMINI_API_KEY;
const SUPA_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SUPA_KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!GEMINI_KEY || !SUPA_URL || !SUPA_KEY) {
  console.error('Saknar nycklar i .env.local');
  process.exit(1);
}
const MODEL = 'gemini-flash-latest';

function findHeicFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...findHeicFiles(full));
    else if (/\.heic$/i.test(entry)) out.push(full);
  }
  return out.sort();
}

async function gemini(parts, retries = 3) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_KEY}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts }] }) }
    );
    if (res.ok) {
      const data = await res.json();
      return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    }
    if (attempt < retries) {
      await new Promise(r => setTimeout(r, 5000 * Math.pow(2, attempt)));
    } else {
      throw new Error(`Gemini ${res.status}: ${await res.text()}`);
    }
  }
}

function parseJson(text) {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('Inget JSON');
  return JSON.parse(m[0]);
}

const TRANSCRIBE_PROMPT = `This is a photo of a page from a Swedish children's book. Transcribe ONLY the actual story text (narration and dialogue) exactly as printed in Swedish. Ignore page numbers, chapter labels, author names and titles. If the page has no story text (pure illustration or cover), return an empty string.

Respond in this exact JSON format:
{ "text": "the verbatim Swedish story text on this page, or empty string" }
RESPOND WITH ONLY THE JSON.`;

async function extractBook(bookDir) {
  const bookName = basename(bookDir);
  const files = findHeicFiles(bookDir);
  console.log(`\n=== ${bookName}: ${files.length} bilder ===`);

  const passages = [];
  for (let i = 0; i < files.length; i++) {
    try {
      const imageData = readFileSync(files[i]).toString('base64');
      const text = await gemini([
        { text: TRANSCRIBE_PROMPT },
        { inlineData: { mimeType: 'image/heic', data: imageData } },
      ]);
      const { text: passage } = parseJson(text);
      const clean = (passage || '').trim();
      if (clean.length > 15) {
        passages.push(clean);
        console.log(`  [${i + 1}/${files.length}] ${clean.length} tecken`);
      } else {
        console.log(`  [${i + 1}/${files.length}] (ingen text)`);
      }
    } catch (err) {
      console.warn(`  [${i + 1}/${files.length}] MISSLYCKADES: ${err.message}`);
    }
    await new Promise(r => setTimeout(r, 1100));
  }

  if (passages.length === 0) {
    console.warn(`  Ingen text hittad i ${bookName}`);
    return;
  }

  // Låt Gemini välja de mest representativa korta passagerna som stilförebilder
  console.log(`  Väljer representativa exempel av ${passages.length} passager...`);
  const selection = await gemini([{
    text: `Here are story-text passages transcribed from the Swedish children's book "${bookName}". Select the 12 SHORT passages that best represent the book's writing VOICE - its sentence rhythm, dialogue style, vocabulary and tone. Prefer varied examples: an opening, dialogue exchanges, narration, an emotional beat, an ending. Each selected passage should be 1-3 sentences (max ~40 words). Keep them VERBATIM in Swedish.

Respond in this exact JSON format:
{
  "examples": [
    { "text": "the short verbatim passage", "type": "opening|dialogue|narration|emotional|ending|description" }
  ]
}

PASSAGES:
${JSON.stringify(passages.slice(0, 60), null, 1)}

RESPOND WITH ONLY THE JSON.`,
  }]);
  const { examples } = parseJson(selection);
  console.log(`  Valde ${examples.length} exempelpassager`);

  // Lokal kopia för granskning
  writeFileSync(join(BOOKS_DIR, `${bookName}-sprakexempel.json`),
    JSON.stringify({ book: bookName, examples }, null, 2));

  // Rensa gamla exempel för serien, spara nya
  await fetch(`${SUPA_URL}/rest/v1/barnbok_reference_texts?book_series=eq.${encodeURIComponent(bookName)}`, {
    method: 'DELETE', headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` },
  });

  for (const ex of examples) {
    const res = await fetch(`${SUPA_URL}/rest/v1/barnbok_reference_texts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` },
      body: JSON.stringify({
        book_series: bookName,
        text_sample: ex.text,
        text_type: ['narrative', 'dialogue', 'description', 'opening', 'ending'].includes(ex.type) ? ex.type : 'narrative',
        style_notes: `Stilförebild (${ex.type}) - lär dig tonen, kopiera aldrig`,
      }),
    });
    if (!res.ok) console.error(`  Spara-fel: ${res.status} ${await res.text()}`);
  }
  console.log(`  Sparade ${examples.length} språkexempel i Supabase`);
}

const targetBook = process.argv[2];
const bookDirs = readdirSync(BOOKS_DIR).map(n => join(BOOKS_DIR, n)).filter(p => statSync(p).isDirectory())
  .filter(p => !targetBook || basename(p).toLowerCase() === targetBook.toLowerCase());
console.log(`Böcker: ${bookDirs.map(d => basename(d)).join(', ')}`);
for (const dir of bookDirs) await extractBook(dir);
console.log('\nKLART!');
