#!/usr/bin/env node
// Steg 3 i hjärnans inläsning: slår ihop läsarnas analys/NNN.json till
//   uppslag.json       alla uppslag i ordning (mätdata och egna beskrivningar - ingen bokstext)
//   fingeravtryck.json textens mått (src/lib/text-fingerprint.ts) och bokens uppbyggnad
//   observationer.md   läsarnas handling, skriv- och bildgrepp per uppslag, underlag för syntesen
//
//   node scripts/hjarnan/sammanstall.mjs --bok familjen-knyckertz-och-guld-diamanten
import fs from 'node:fs';
import path from 'node:path';
import { BOCKER, ROOT, loadTs, readJson, writeJson, args } from './lib.mjs';

const { fingerprintFromFeatures } = loadTs(path.join(ROOT, 'src/lib/text-fingerprint.ts'));
const opts = args();

const count = (list) => list.reduce((acc, x) => { if (x) acc[x] = (acc[x] ?? 0) + 1; return acc; }, {});
const sortCount = (obj) => Object.fromEntries(Object.entries(obj).sort((a, b) => b[1] - a[1]));
const SIDE_ORDER = { vänster: 0, uppslag: 1, båda: 1, höger: 2 };
const wordsIn = (stycken) => stycken.reduce((a, s) => a + (s.meningar ?? []).reduce((b, m) => b + (m.ord ?? 0), 0), 0);
const mean = (l) => l.length ? Math.round(l.reduce((a, b) => a + b, 0) / l.length) : 0;

// Läsarna beskriver placeringen fritt - räkna den i tre grupper
function placement(p = '') {
  const s = p.toLowerCase();
  if (/pratbubbl/.test(s)) return 'i pratbubbla';
  if (/(i bild|bildens|moln|ljuskägla|gradient|platta|direkt på|svart bakgrund|på ljus)/.test(s)) return 'i bilden';
  if (/(vitt papper|vit yta|textsida)/.test(s)) return 'på vitt papper';
  return 'annat';
}

function compile(slug) {
  const dir = path.join(BOCKER, slug);
  const bok = readJson(path.join(dir, 'bok.json'));
  if (!bok) throw new Error(`Hittar inte ${dir}/bok.json - kör forbered.mjs först`);
  const files = fs.readdirSync(path.join(dir, 'analys')).filter(f => /^\d+\.json$/.test(f)).sort();
  const spreads = files.map(f => readJson(path.join(dir, 'analys', f))).filter(Boolean).sort((a, b) => a.uppslag - b.uppslag);
  const legacy = spreads.filter(s => Array.isArray(s.text));
  if (legacy.length) throw new Error(`${legacy.length} uppslag har avskriven text - kör rensa-text.mjs först`);
  const missing = (bok.sidor ?? []).map(s => s.nr).filter(nr => !spreads.some(s => s.uppslag === nr));
  if (missing.length) console.warn(`Saknar analys för uppslag: ${missing.join(', ')}`);

  // ── Stycken i läsordning, kapitel för kapitel ──
  const ordered = (s) => [...(s.stycken ?? [])].sort((a, b) => (SIDE_ORDER[a.sida] ?? 1) - (SIDE_ORDER[b.sida] ?? 1));
  const chapters = [];
  let current = { nummer: null, rubrik: null, uppslag: [], stycken: [] };
  // Ett nytt kapitel börjar bara när kapitlet byts - vissa läsare anger kapitlet på varje uppslag
  const sameChapter = (k) => (k.nummer ?? null) === current.nummer && (k.rubrik ?? null) === current.rubrik;
  for (const s of spreads) {
    if (s.kapitel && (s.kapitel.nummer || s.kapitel.rubrik) && !sameChapter(s.kapitel)) {
      if (current.stycken.length || current.uppslag.length) chapters.push(current);
      current = { nummer: s.kapitel.nummer ?? null, rubrik: s.kapitel.rubrik ?? null, uppslag: [], stycken: [] };
    }
    current.uppslag.push(s.uppslag);
    current.stycken.push(...ordered(s));
  }
  if (current.stycken.length || current.uppslag.length) chapters.push(current);
  const storyChapters = chapters.filter(c => c.stycken.length);
  const allStycken = storyChapters.flatMap(c => c.stycken);

  // ── Bokens uppbyggnad ──
  const story = spreads.filter(s => ['berättelse', 'kapitelstart'].includes(s.typ));
  const bodyWords = story.map(s => wordsIn(s.stycken ?? []));
  const images = spreads.flatMap(s => (s.bilder ?? []).map(b => ({ ...b, uppslag: s.uppslag })));
  const realImages = images.filter(b => !['dekor', 'mönster'].includes(b.komposition));
  const chapterWords = storyChapters.map(c => wordsIn(c.stycken));
  const struktur = {
    uppslag: spreads.length,
    typer: sortCount(count(spreads.map(s => s.typ))),
    kapitel: storyChapters.length,
    ordTotalt: chapterWords.reduce((a, b) => a + b, 0),
    ordPerKapitel: { snitt: mean(chapterWords), min: Math.min(...chapterWords), max: Math.max(...chapterWords) },
    ordPerBerattelseuppslag: { snitt: mean(bodyWords), min: Math.min(...bodyWords), max: Math.max(...bodyWords) },
    uppslagMedBild: Math.round((story.filter(s => (s.bilder ?? []).some(b => !['dekor', 'mönster'].includes(b.komposition))).length / Math.max(1, story.length)) * 100) / 100,
    bildtyper: sortCount(count(realImages.map(b => b.komposition))),
    bildyta: Math.round((realImages.reduce((a, b) => a + (Number(b.yta) || 0), 0) / Math.max(1, realImages.length)) * 100) / 100,
    kamera: sortCount(count(realImages.map(b => b.kamera))),
    bakgrund: sortCount(count(realImages.map(b => b.bakgrund))),
    textplacering: sortCount(count(allStycken.map(st => placement(st.placering)))),
    textIBilden: sortCount(count(spreads.flatMap(s => (s.textIBild ?? []).filter(t => t.roll !== 'baksidestext').map(t => t.roll)))),
    grafiskaGrepp: sortCount(count(realImages.flatMap(b => (b.grafiska_grepp ?? []).map(g => g.toLowerCase().trim())))),
  };

  const textFingerprint = fingerprintFromFeatures(allStycken);
  writeJson(path.join(dir, 'fingeravtryck.json'), {
    bok: bok.titel,
    skapad: new Date().toISOString(),
    text: textFingerprint,
    struktur,
    kapitel: storyChapters.map((c, i) => ({ nummer: c.nummer ?? String(i), rubrik: c.rubrik, ord: wordsIn(c.stycken), uppslag: c.uppslag })),
  });
  writeJson(path.join(dir, 'uppslag.json'), spreads);

  // ── Underlag för syntesen ──
  const obs = [`# Observationer: ${bok.titel}`, ''];
  for (const s of spreads) {
    obs.push(`## Uppslag ${s.uppslag} (${s.typ}${s.kapitel ? `, kapitel ${s.kapitel.nummer ?? ''} ${s.kapitel.rubrik ?? ''}`.trimEnd() : ''}, ca ${wordsIn(s.stycken ?? [])} ord)`);
    if (s.handling) obs.push(`- Handling: ${s.handling}`);
    for (const b of s.bilder ?? []) {
      obs.push(`- Bild (${b.sida}, ${b.komposition}, yta ${b.yta}): ${b.motiv}. Kamera: ${b.kamera}. Bakgrund: ${b.bakgrund}. Samspel: ${b.samspel_med_texten}${(b.grafiska_grepp ?? []).length ? `. Grepp: ${b.grafiska_grepp.join(', ')}` : ''}`);
    }
    for (const t of s.textIBild ?? []) obs.push(`- Text i bild (${t.roll}, ${t.placering})${t.beskrivning ? `: ${t.beskrivning}` : ''}`);
    for (const g of s.skrivgrepp ?? []) obs.push(`- Skriv: ${g}`);
    for (const g of s.bildgrepp ?? []) obs.push(`- Bild: ${g}`);
    if (s.stilnoter) obs.push(`- Stil: ${s.stilnoter}`);
    if (s.osakert) obs.push(`- Osäkert: ${s.osakert}`);
    obs.push('');
  }
  fs.writeFileSync(path.join(dir, 'observationer.md'), obs.join('\n'));
  // Äldre versioner skrev ut bokens text - den sparas inte längre
  fs.rmSync(path.join(dir, 'text.md'), { force: true });

  // En bok som redan analyserats eller förts in i hjärnan behåller sin status
  const status = ['analyserad', 'i hjärnan'].includes(bok.status) ? bok.status : 'sammanställd';
  writeJson(path.join(dir, 'bok.json'), { ...bok, status, sammanstalld: new Date().toISOString() });
  console.log(`${bok.titel}: ${spreads.length} uppslag, ${storyChapters.length} kapitel, ${struktur.ordTotalt} ord`);
  console.log(`  meningslängd ${textFingerprint.sentenceMean} ord, LIX ${textFingerprint.lix}, repliker ${Math.round(textFingerprint.dialogueShare * 100)} %, presens ${Math.round(textFingerprint.presentTenseShare * 100)} %`);
}

const slugs = opts.bok ? [opts.bok] : fs.readdirSync(BOCKER).filter(d => fs.existsSync(path.join(BOCKER, d, 'analys')));
for (const slug of slugs) compile(slug);
