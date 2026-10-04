#!/usr/bin/env node
// Slår ihop flera analyserade referensböcker: mått för mått med varje boks värde,
// medel och spann. Det som ligger stabilt över flera böcker blir målintervall i
// hjärnan - det som bara en bok har är en egenhet, inte en regel.
//
//   node scripts/hjarnan/samla.mjs --bocker yumi-tomu-resan-till-interversum,yumi-tomu-fantasimaskinen --namn yumi-tomu
//   node scripts/hjarnan/samla.mjs --boktyp knyckertz --namn knyckertz      alla böcker med den boktypen i bok.json
//
// Skriver referensbocker/samlat-<namn>.md och .json.
import fs from 'node:fs';
import path from 'node:path';
import { BOCKER, REF, ROOT, loadTs, readJson, writeJson, args } from './lib.mjs';

const { FINGERPRINT_LABELS } = loadTs(path.join(ROOT, 'src/lib/text-fingerprint.ts'));
const opts = args();

const all = fs.readdirSync(BOCKER).filter(d => fs.existsSync(path.join(BOCKER, d, 'fingeravtryck.json')));
const slugs = opts.bocker ? opts.bocker.split(',')
  : opts.boktyp ? all.filter(d => readJson(path.join(BOCKER, d, 'bok.json'))?.boktyp === opts.boktyp)
  : all;
if (slugs.length < 2) { console.error('Behöver minst två analyserade böcker'); process.exit(1); }

const books = slugs.map(slug => ({ slug, bok: readJson(path.join(BOCKER, slug, 'bok.json')), fp: readJson(path.join(BOCKER, slug, 'fingeravtryck.json')) }));
const SHARES = new Set(['dialogueShare', 'shortSentenceShare', 'longSentenceShare', 'presentTenseShare', 'saidShare', 'lexicalVariety', 'sentenceVariation', 'sentenceStartRepeat']);
const fmt = (v, m) => SHARES.has(m) ? `${Math.round(v * 100)} %` : String(Math.round(v * 10) / 10).replace('.', ',');

const rows = Object.entries(FINGERPRINT_LABELS).map(([metric, label]) => {
  const values = books.map(b => Number(b.fp.text[metric]));
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const min = Math.min(...values);
  const max = Math.max(...values);
  // Stabilt = böckerna ligger nära varandra (spannet litet jämfört med medel)
  const stable = mean === 0 ? max === 0 : (max - min) / Math.abs(mean) < 0.5;
  return { metric, label, values, mean, min, max, stable };
});

const struktur = books.map(b => b.fp.struktur);
const name = opts.namn || 'samlat';
const md = [
  `# Samlat fingeravtryck: ${name}`,
  '',
  `Böcker: ${books.map(b => b.bok.titel).join(', ')}.`,
  'Stabil = böckerna ligger nära varandra. De måtten blir målintervall; de andra är egenheter hos en bok.',
  '',
  `| Mått | ${books.map((_, i) => `Bok ${i + 1}`).join(' | ')} | Medel | Stabil |`,
  `|---|${books.map(() => '---|').join('')}---|---|`,
  ...rows.map(r => `| ${r.label} | ${r.values.map(v => fmt(v, r.metric)).join(' | ')} | ${fmt(r.mean, r.metric)} | ${r.stable ? 'ja' : 'nej'} |`),
  '',
  '## Uppbyggnad',
  `| | ${books.map((_, i) => `Bok ${i + 1}`).join(' | ')} |`,
  `|---|${books.map(() => '---|').join('')}`,
  `| Ord totalt | ${struktur.map(s => s.ordTotalt).join(' | ')} |`,
  `| Kapitel | ${struktur.map(s => s.kapitel).join(' | ')} |`,
  `| Ord per kapitel (snitt) | ${struktur.map(s => s.ordPerKapitel.snitt).join(' | ')} |`,
  `| Ord per berättelseuppslag | ${struktur.map(s => s.ordPerBerattelseuppslag.snitt).join(' | ')} |`,
  `| Bilder | ${struktur.map(s => Object.values(s.bildtyper).reduce((a, b) => a + b, 0)).join(' | ')} |`,
  `| Ord per bild | ${struktur.map(s => Math.round(s.ordTotalt / Math.max(1, Object.values(s.bildtyper).reduce((a, b) => a + b, 0)))).join(' | ')} |`,
  `| Bildtyper | ${struktur.map(s => Object.entries(s.bildtyper).map(([k, v]) => `${k} ${v}`).join(', ')).join(' | ')} |`,
  `| Text i bilden | ${struktur.map(s => Object.entries(s.textIBilden).map(([k, v]) => `${k} ${v}`).join(', ')).join(' | ')} |`,
  '',
];
fs.writeFileSync(path.join(REF, `samlat-${name}.md`), md.join('\n'));
writeJson(path.join(REF, `samlat-${name}.json`), { skapad: new Date().toISOString(), bocker: slugs, matt: rows });
console.log(md.join('\n'));
