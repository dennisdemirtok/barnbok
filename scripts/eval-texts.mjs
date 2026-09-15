#!/usr/bin/env node
// Mäter AI-texternas kvalitet och variation mot en körande app.
//
//   node scripts/eval-texts.mjs --tag före --base https://barnbok-production.up.railway.app
//
// Genererar slumpade handlingar och bokbörjan via appens API, mäter dem med
// src/lib/text-eval.ts och skriver en rapport (JSON + Markdown) till eval-reports/.
// Kör samma kommando före och efter en promptändring och jämför siffrorna.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

// ── Argument ──
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? 'true' : all[i + 1]]);
  return acc;
}, []));
const BASE = args.base || 'http://localhost:3000';
const TAG = args.tag || new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
const STYLES = (args.styles || 'luna,knyckertz,handbok,mammamu,disney,minimalistisk').split(',');
const PLOTS_PER_STYLE = Number(args.plots || 6);
const BEGINNINGS_PER_STYLE = Number(args.beginnings || 1);
const SAME_PLOT = Number(args.same || 3);
const OUT = path.resolve(args.out || path.join(ROOT, 'eval-reports'));
const REUSE = args.reuse; // sökväg till en tidigare rå-JSON: mät om utan att generera

const AGES = { luna: '6-9 år', knyckertz: '6-9 år', handbok: '8-12 år', mammamu: '3-6 år', disney: '3-6 år', minimalistisk: '2-5 år' };
const SAME_PLOT_TEXT = 'Tvillingarna ska sova över hos farmor på en ö. På natten hör de någon gå på vinden fast farmor sover.';

// ── Ladda TypeScript-moduler utan byggsteg ──
function loadTs(file) {
  const ts = require(path.join(ROOT, 'node_modules/typescript'));
  const source = fs.readFileSync(file, 'utf8');
  const out = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const mod = { exports: {} };
  const localRequire = (id) => id.startsWith('./') ? loadTs(path.join(path.dirname(file), `${id.slice(2)}.ts`)) : require(id);
  new Function('module', 'exports', 'require', out)(mod, mod.exports, localRequire);
  return mod.exports;
}
const { evaluateBatch } = loadTs(path.join(ROOT, 'src/lib/text-eval.ts'));

async function post(url, body) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(BASE + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => null);
    if (res.ok && data) return data;
    console.warn(`  ${url} misslyckades (${res.status}) ${data?.error ?? ''}`);
    if (res.status < 500) return null;
  }
  return null;
}

async function pool(jobs, concurrency) {
  const results = [];
  let next = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (next < jobs.length) {
      const i = next++;
      results[i] = await jobs[i]();
    }
  }));
  return results;
}

// ── Generera ──
async function generate() {
  console.log(`Genererar mot ${BASE}: ${PLOTS_PER_STYLE} handlingar och ${BEGINNINGS_PER_STYLE} början per stil, ${SAME_PLOT} på samma handling`);
  const plotJobs = STYLES.flatMap(style => Array.from({ length: PLOTS_PER_STYLE }, () => async () => {
    const r = await post('/api/random-plot', { stylePresetId: style, targetAge: AGES[style] });
    process.stdout.write('.');
    return r && { style, ...r };
  }));
  const plots = (await pool(plotJobs, 4)).filter(Boolean);
  console.log(`\n${plots.length} handlingar`);

  const beginningJobs = [
    ...STYLES.flatMap(style => plots.filter(p => p.style === style).slice(0, BEGINNINGS_PER_STYLE).map(p => ({
      style, plot: p.plot, setting: p.setting, lineage: `plot:${plots.indexOf(p)}`,
    }))),
    ...Array.from({ length: SAME_PLOT }, (_, i) => ({ style: 'luna', plot: SAME_PLOT_TEXT, lineage: `same:${i}`, same: true })),
  ].map(job => async () => {
    const r = await post('/api/write-beginning', { stylePresetId: job.style, targetAge: AGES[job.style], plot: job.plot, setting: job.setting });
    process.stdout.write('+');
    return r && { ...job, title: r.title, rawText: r.rawText };
  });
  const beginnings = (await pool(beginningJobs, 3)).filter(Boolean);
  console.log(`\n${beginnings.length} början`);
  return { base: BASE, tag: TAG, createdAt: new Date().toISOString(), plots, beginnings };
}

// ── Mät ──
function pct(n) { return `${Math.round(n * 100)} %`; }

function report(raw) {
  const randomItems = [
    ...raw.plots.map((p, i) => ({ id: `plot:${i}`, group: p.style, kind: 'plot', text: p.plot || '', lineage: `plot:${i}` })),
    ...raw.beginnings.filter(b => !b.same).map((b, i) => ({ id: `beg:${i}`, group: b.style, kind: 'beginning', text: b.rawText || '', lineage: b.lineage })),
  ];
  const batch = evaluateBatch(randomItems);
  const same = evaluateBatch(raw.beginnings.filter(b => b.same).map((b, i) => ({ id: `same:${i}`, group: 'samma handling', kind: 'beginning', text: b.rawText || '' })));
  const titles = raw.plots.map(p => p.title);
  const duplicateTitles = titles.filter((t, i) => titles.indexOf(t) !== i);

  const md = [
    `# Textmätning: ${raw.tag}`,
    `${raw.createdAt} · ${raw.base} · ${raw.plots.length} handlingar · ${raw.beginnings.length} början`,
    '',
    '## Poäng',
    `| | Poäng |`,
    `|---|---|`,
    `| Kvalitet (AI-tecken, rytm, ordvariation) | **${batch.quality.score}** |`,
    `| Variation mellan böcker | **${batch.variation.score}** |`,
    `| Variation vid samma handling | **${same.variation.score}** |`,
    '',
    '## Kvalitet',
    `- AI-tecken per 1000 ord: ${batch.quality.aiTellsPer1000Words}`,
    `- Rytmvariation (meningslängd): ${batch.quality.avgSentenceVariation}`,
    `- Ordvariation: ${batch.quality.avgLexicalVariety}`,
    '',
    '## Variation',
    `- Huvudnamn som återkommer i andra böcker: ${pct(batch.variation.nameRepeatRate)}`,
    `- Återkommande namn: ${batch.variation.repeatedNames.slice(0, 10).map(n => `${n.name} (${n.count})`).join(', ') || 'inga'}`,
    `- Återkommande miljöer/figurer: ${batch.variation.repeatedSettings.map(s => `${s.word} (${s.count})`).join(', ') || 'inga'}`,
    `- Innehållslikhet mellan texter: ${batch.variation.avgContentOverlap}`,
    `- Likhet i öppningar: ${batch.variation.avgOpeningOverlap}`,
    `- Dubblerade titlar: ${duplicateTitles.join(', ') || 'inga'}`,
    '',
    '## Samma handling tre gånger',
    `- Återkommande namn: ${same.variation.repeatedNames.map(n => `${n.name} (${n.count})`).join(', ') || 'inga'}`,
    `- Likhet i öppningar: ${same.variation.avgOpeningOverlap} · innehållslikhet: ${same.variation.avgContentOverlap}`,
    ...raw.beginnings.filter(b => b.same).map(b => `  - «${b.title}»: ${(b.rawText || '').split('\n').filter(Boolean).slice(0, 2).join(' / ').slice(0, 140)}`),
    '',
    '## Handlingar',
    ...raw.plots.map(p => `- **${p.style}** «${p.title}»: ${p.plot}`),
    '',
    '## Början (AI-tecken)',
    ...batch.items.filter(m => m.kind === 'beginning').map(m => `- ${m.group}: ${m.words} ord, rytm ${m.sentenceVariation}, namn ${m.names.slice(0, 3).join('/')}, ${m.aiTellLabels.join('; ') || 'inga AI-tecken'} · ”${m.opening.slice(0, 90)}”`),
  ].join('\n');
  return { md, summary: { quality: batch.quality, variation: batch.variation, samePlot: same.variation } };
}

const raw = REUSE ? JSON.parse(fs.readFileSync(REUSE, 'utf8')) : await generate();
fs.mkdirSync(OUT, { recursive: true });
if (!REUSE) fs.writeFileSync(path.join(OUT, `${TAG}.raw.json`), JSON.stringify(raw, null, 1));
const { md, summary } = report(raw);
fs.writeFileSync(path.join(OUT, `${raw.tag}.md`), md);
fs.writeFileSync(path.join(OUT, `${raw.tag}.summary.json`), JSON.stringify(summary, null, 1));
console.log(`\nKvalitet ${summary.quality.score} · Variation ${summary.variation.score} · Samma handling ${summary.samePlot.score}`);
console.log(`Rapport: ${path.join(OUT, `${raw.tag}.md`)}`);
