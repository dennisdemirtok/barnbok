#!/usr/bin/env node
// Steg 4 i hjärnans inläsning: jämför en referensbok med appens egna böcker
// (de publicerade i bokhandeln) mått för mått, och skriver jamforelse.md.
//
//   node scripts/hjarnan/jamfor.mjs --bok yumi-tomu-resan-till-interversum
//   node scripts/hjarnan/jamfor.mjs --bok <slug> --stilar knyckertz,luna    bara vissa boktyper
//
// Det är den här skillnaden hjärnan ska krympa: där appen ligger långt från
// riktiga böcker finns nästa regel eller nästa kontrastpar.
import fs from 'node:fs';
import path from 'node:path';
import { BOCKER, ROOT, loadTs, readJson, readEnv, writeJson, args } from './lib.mjs';

const { fingerprint, compareFingerprints, averageFingerprint } = loadTs(path.join(ROOT, 'src/lib/text-fingerprint.ts'));
const opts = args();
const env = readEnv();
const H = { apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY, Authorization: `Bearer ${env.NEXT_PUBLIC_SUPABASE_ANON_KEY}` };

async function rest(query) {
  const res = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${query}`, { headers: H });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  return res.json();
}

// Appens publicerade böcker med text i läsordning
async function appBooks(styles) {
  const books = await rest('barnbok_books?select=id,title,book_format,theme,age_min,age_max&is_public=eq.true&order=published_at.desc&limit=200');
  const out = [];
  for (const b of books) {
    let theme = {};
    try { theme = b.theme?.startsWith('{') ? JSON.parse(b.theme) : {}; } catch { /* gammalt format */ }
    const preset = theme.stylePresetId ?? '?';
    if (styles && !styles.includes(preset)) continue;
    const spreads = await rest(`barnbok_spreads?select=id,sort_order&book_id=eq.${b.id}&order=sort_order`);
    if (spreads.length === 0) continue;
    const blocks = await rest(`barnbok_text_blocks?select=spread_id,position,text_content&spread_id=in.(${spreads.map(s => s.id).join(',')})&order=position`);
    const order = new Map(spreads.map(s => [s.id, s.sort_order]));
    const text = blocks.sort((x, y) => (order.get(x.spread_id) - order.get(y.spread_id)) || (x.position - y.position))
      .map(t => t.text_content).filter(Boolean).join('\n\n');
    if (text.split(/\s+/).length < 300) continue;
    const fp = fingerprint(text);
    // Många anföringar men nästan inga markerade repliker = talstrecken har tappats bort
    const tags = fp.speechTags.reduce((a, t) => a + t.count, 0);
    const fel = tags >= 10 && fp.repliesPer1000 < 3 ? 'repliker saknar talstreck' : null;
    out.push({ id: b.id, titel: b.title, stil: preset, alder: `${b.age_min}-${b.age_max}`, fel, fp });
  }
  // Samma bok publicerad flera gånger: den senaste felfria räknas
  const chosen = new Map();
  for (const a of out) {
    const prev = chosen.get(a.titel);
    if (!prev || (prev.fel && !a.fel)) chosen.set(a.titel, a);
  }
  return { valda: [...chosen.values()].filter(a => !a.fel), medFel: out.filter(a => a.fel) };
}

// Andelar visas i procent, övriga mått som tal
const SHARES = new Set(['dialogueShare', 'shortSentenceShare', 'longSentenceShare', 'presentTenseShare', 'saidShare', 'lexicalVariety', 'sentenceVariation', 'sentenceStartRepeat']);
const fmt = (v, metric) => typeof v !== 'number' ? String(v)
  : SHARES.has(metric) ? `${Math.round(v * 100)} %` : String(v).replace('.', ',');
const times = (log2) => {
  const r = 2 ** log2;
  if (Math.abs(log2) < 0.26) return '≈ lika';
  return r > 1 ? `${r.toFixed(1).replace('.', ',')} × mer` : `${(1 / r).toFixed(1).replace('.', ',')} × mindre`;
};

const slug = opts.bok;
if (!slug) { console.error('Ange --bok <mapp i referensbocker/bocker>'); process.exit(1); }
const dir = path.join(BOCKER, slug);
const ref = readJson(path.join(dir, 'fingeravtryck.json'));
if (!ref) { console.error('Kör sammanstall.mjs först'); process.exit(1); }

const styles = opts.stilar ? opts.stilar.split(',') : null;
const { valda: app, medFel } = await appBooks(styles);
if (app.length === 0) { console.error('Hittade inga publicerade böcker från appen att jämföra med'); process.exit(1); }
const appAvg = averageFingerprint(app.map(a => a.fp));
const gaps = compareFingerprints(ref.text, appAvg);

const md = [
  `# Jämförelse: ${ref.bok} mot appens böcker`,
  '',
  `Appens böcker: ${app.length} publicerade (${app.map(a => `${a.titel} [${a.stil}]`).join(', ')}).`,
  'Sorterat efter hur långt ifrån boken appen ligger. "× mer" betyder att appen har mer av det än boken.',
  '',
  '| Mått | Boken | Appen (snitt) | Appens spann | Appen jämfört med boken |',
  '|---|---|---|---|---|',
  ...gaps.map(g => {
    const values = app.map(a => Number(a.fp[g.metric]));
    return `| ${g.label} | ${fmt(g.reference, g.metric)} | ${fmt(g.candidate, g.metric)} | ${fmt(Math.min(...values), g.metric)}–${fmt(Math.max(...values), g.metric)} | ${times(g.log2Ratio)} |`;
  }),
  '',
  `## Anföringsverb`,
  `- Boken: ${ref.text.speechTags.slice(0, 8).map(t => `${t.verb} ${t.count}`).join(', ') || '–'}`,
  `- Appen: ${Object.entries(app.flatMap(a => a.fp.speechTags).reduce((acc, t) => ({ ...acc, [t.verb]: (acc[t.verb] ?? 0) + t.count }), {})).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([v, c]) => `${v} ${c}`).join(', ') || '–'}`,
  '',
  `## Småord`,
  `- Boken: ${ref.text.particles.map(p => `${p.word} ${p.count}`).join(', ') || '–'}`,
  `- Appen: ${Object.entries(app.flatMap(a => a.fp.particles).reduce((acc, p) => ({ ...acc, [p.word]: (acc[p.word] ?? 0) + p.count }), {})).sort((a, b) => b[1] - a[1]).map(([w, c]) => `${w} ${c}`).join(', ') || '–'}`,
  '',
  ...(medFel.length ? ['## Fel i publicerade böcker', ...medFel.map(a => `- ${a.titel} (${a.id.slice(0, 8)}): ${a.fel}. Räknas inte i snittet.`), ''] : []),
  '## Per bok i appen',
  '| Bok | Stil | Ord | Ord/mening | Repliker | Presens | Småord/1000 | Känsloord/1000 |',
  '|---|---|---|---|---|---|---|---|',
  `| **${ref.bok}** (referens) | – | ${ref.text.words} | ${fmt(ref.text.sentenceMean)} | ${fmt(ref.text.dialogueShare, 'dialogueShare')} | ${fmt(ref.text.presentTenseShare, 'presentTenseShare')} | ${fmt(ref.text.particlesPer1000)} | ${fmt(ref.text.namedEmotionsPer1000)} |`,
  ...app.map(a => `| ${a.titel} | ${a.stil} | ${a.fp.words} | ${fmt(a.fp.sentenceMean)} | ${fmt(a.fp.dialogueShare, 'dialogueShare')} | ${fmt(a.fp.presentTenseShare, 'presentTenseShare')} | ${fmt(a.fp.particlesPer1000)} | ${fmt(a.fp.namedEmotionsPer1000)} |`),
  '',
];
fs.writeFileSync(path.join(dir, 'jamforelse.md'), md.join('\n'));
writeJson(path.join(dir, 'jamforelse.json'), { skapad: new Date().toISOString(), app: app.map(({ fp, ...a }) => ({ ...a, fp })), appSnitt: appAvg, skillnader: gaps });
console.log(md.slice(0, 12 + Math.min(gaps.length, 12)).join('\n'));
console.log(`\nskrev ${path.relative(ROOT, path.join(dir, 'jamforelse.md'))}`);
