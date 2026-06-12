// Analyserar fotade referensböcker med Gemini Vision och bygger stilprofiler
// i Supabase (barnbok_style_profiles). Fotona lämnar aldrig datorn förutom
// till Gemini för analys - endast beskrivande stilanalyser sparas, aldrig
// bokens text eller bilder.
//
// Körs med: node scripts/analyze-reference-books.mjs

import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const BOOKS_DIR = join(ROOT, 'referensbocker');

// Läs .env.local manuellt (skriptet körs utanför Next.js)
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
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts }] }),
      }
    );
    if (res.ok) {
      const data = await res.json();
      return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    }
    if (attempt < retries) {
      const wait = 5000 * Math.pow(2, attempt);
      console.log(`  Gemini ${res.status} - väntar ${wait / 1000}s...`);
      await new Promise(r => setTimeout(r, wait));
    } else {
      throw new Error(`Gemini ${res.status}: ${await res.text()}`);
    }
  }
}

function parseJson(text) {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('Inget JSON i svaret');
  return JSON.parse(m[0]);
}

const PAGE_PROMPT = `You are analyzing a photograph of a spread from a published Swedish children's book, for the purpose of building a DESCRIPTIVE style profile. Do NOT transcribe the book's text - describe the style only.

Respond in this exact JSON format:
{
  "page_type": "cover | story spread | character intro | title page | back cover | other",
  "layout": "describe panel/illustration layout, how text and image share the page",
  "text_placement": "where and how text appears (boxes, bubbles, under image, integrated...)",
  "estimated_words_per_page": number,
  "text_style": "narration style, sentence length, tone, dialogue usage - DESCRIPTIVE only, no quotes",
  "illustration_style": "art technique, linework, level of detail, character design style",
  "color_palette": "dominant colors and overall color mood",
  "notable_techniques": "anything distinctive worth replicating (humor devices, repetition, page-turn hooks...)"
}
RESPOND WITH ONLY THE JSON.`;

async function analyzeBook(bookDir) {
  const bookName = basename(bookDir);
  const files = findHeicFiles(bookDir);
  console.log(`\n=== ${bookName}: ${files.length} bilder ===`);

  const pageAnalyses = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    try {
      const imageData = readFileSync(file).toString('base64');
      const text = await gemini([
        { text: PAGE_PROMPT },
        { inlineData: { mimeType: 'image/heic', data: imageData } },
      ]);
      pageAnalyses.push(parseJson(text));
      console.log(`  [${i + 1}/${files.length}] ${basename(file)} OK`);
    } catch (err) {
      console.warn(`  [${i + 1}/${files.length}] ${basename(file)} MISSLYCKADES: ${err.message}`);
    }
    await new Promise(r => setTimeout(r, 1200)); // rate limit-marginal
  }

  if (pageAnalyses.length === 0) {
    console.error(`  Inga analyser lyckades för ${bookName}`);
    return null;
  }

  console.log(`  Syntetiserar stilprofil av ${pageAnalyses.length} sidanalyser...`);
  const synthesis = await gemini([
    {
      text: `Below are ${pageAnalyses.length} page-by-page style analyses of the Swedish children's book series "${bookName}". Synthesize them into ONE style profile that an AI book generator will use to create NEW, original books with the same look and feel (never copying the original).

Respond in this exact JSON format (values in SWEDISH):
{
  "text_style": "2-4 meningar som instruerar en text-AI: berättarröst, meningslängd, ton, dialoganvändning, ord per sida",
  "image_style": "2-4 meningar som instruerar en bild-AI pa engelska: art technique, linework, color palette, layout, text placement",
  "typical_age_min": number,
  "typical_age_max": number,
  "typical_format": "bildbok-text-pa-bild | bildbok-separat-text | kapitelbok | larobok",
  "example_prompts": ["2-3 exempel pa bildprompt-fraser pa engelska som fangar stilen"],
  "notes": "ovriga observationer: humor, sidvandningar, aterkommande grepp"
}

PAGE ANALYSES:
${JSON.stringify(pageAnalyses, null, 1)}

RESPOND WITH ONLY THE JSON.`,
    },
  ]);
  const profile = parseJson(synthesis);

  // Spara lokal kopia för inspektion
  const localPath = join(BOOKS_DIR, `${bookName}-stilprofil.json`);
  writeFileSync(localPath, JSON.stringify({ book: bookName, pages_analyzed: pageAnalyses.length, profile, pageAnalyses }, null, 2));
  console.log(`  Lokal kopia: ${localPath}`);

  // Spara till Supabase
  const res = await fetch(`${SUPA_URL}/rest/v1/barnbok_style_profiles?on_conflict=book_series`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPA_KEY,
      Authorization: `Bearer ${SUPA_KEY}`,
      Prefer: 'resolution=merge-duplicates',
    },
    body: JSON.stringify({
      book_series: bookName,
      text_style: profile.text_style,
      image_style: profile.image_style,
      typical_age_min: profile.typical_age_min,
      typical_age_max: profile.typical_age_max,
      typical_format: profile.typical_format,
      example_prompts: profile.example_prompts,
      notes: profile.notes,
    }),
  });
  if (!res.ok) {
    console.error(`  Supabase-fel: ${res.status} ${await res.text()}`);
  } else {
    console.log(`  Stilprofil sparad i Supabase som "${bookName}"`);
  }
  return profile;
}

// Valfritt argument: kör bara en specifik bok (mappnamn). Annars alla.
const targetBook = process.argv[2];
const bookDirs = readdirSync(BOOKS_DIR)
  .map(n => join(BOOKS_DIR, n))
  .filter(p => statSync(p).isDirectory())
  .filter(p => !targetBook || basename(p).toLowerCase() === targetBook.toLowerCase());

console.log(`Hittade ${bookDirs.length} böcker: ${bookDirs.map(d => basename(d)).join(', ')}`);
for (const dir of bookDirs) {
  await analyzeBook(dir);
}
console.log('\nKLART!');
