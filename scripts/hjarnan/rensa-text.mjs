#!/usr/bin/env node
// Gör om äldre analyser där läsarna skrev av bokens text till mätdata per stycke
// (samma form som LASARE.md ger nu) och tar bort den avskrivna texten. Förlagorna
// är upphovsrättsskyddade - hjärnan behöver bara måtten och egna beskrivningar.
//
//   node scripts/hjarnan/rensa-text.mjs            alla böcker
//   node scripts/hjarnan/rensa-text.mjs --bok <slug>
import fs from 'node:fs';
import path from 'node:path';
import { BOCKER, ROOT, loadTs, readJson, writeJson, args } from './lib.mjs';

const { featuresOf } = loadTs(path.join(ROOT, 'src/lib/text-fingerprint.ts'));
const opts = args();
const words = (t) => (t.match(/[\p{L}\p{N}]+/gu) ?? []).length;

// Längre citat i läsarnas anteckningar (7 ord eller fler inom citattecken) tas också bort
const QUOTE = /["”“'‘’»«]([^"”“'‘’»«]{20,})["”“'‘’»«]/g;
function redact(value) {
  if (typeof value === 'string') return value.replace(QUOTE, (m, q) => (q.trim().split(/\s+/).length >= 7 ? '[citat borttaget]' : m));
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, k === 'stycken' ? v : redact(v)]));
  return value;
}

const slugs = opts.bok ? [opts.bok] : fs.readdirSync(BOCKER).filter(d => fs.existsSync(path.join(BOCKER, d, 'analys')));
for (const slug of slugs) {
  const dir = path.join(BOCKER, slug, 'analys');
  let converted = 0;
  let redacted = 0;
  for (const f of fs.readdirSync(dir).filter(f => /^\d+\.json$/.test(f))) {
    const file = path.join(dir, f);
    const s = readJson(file);
    if (!s) continue;
    if (!Array.isArray(s.text)) {
      const clean = redact(s);
      if (JSON.stringify(clean) !== JSON.stringify(s)) { writeJson(file, clean); redacted++; }
      continue;
    }
    const stycken = [];
    const textIBild = [...(s.textIBild ?? [])];
    for (const t of s.text) {
      if (t.roll === 'brödtext') {
        for (const drag of featuresOf(t.text ?? '')) stycken.push({ sida: t.sida, placering: t.placering, ...drag });
      } else {
        textIBild.push({ sida: t.sida, roll: t.roll, placering: t.placering, ord: words(t.text ?? ''), beskrivning: '' });
      }
    }
    const presens = stycken.reduce((a, st) => a + (st.presens ?? 0), 0);
    const preteritum = stycken.reduce((a, st) => a + (st.preteritum ?? 0), 0);
    const { text, ...rest } = s;
    void text;
    writeJson(file, redact({
      ...rest,
      tempus: s.tempus ?? (presens + preteritum === 0 ? null : presens >= preteritum * 3 ? 'presens' : preteritum >= presens * 3 ? 'preteritum' : 'blandat'),
      handling: s.handling ?? '',
      stycken,
      textIBild,
    }));
    converted++;
  }
  // Den sammanställda bokstexten och uppslagslistan med text tas bort - sammanstall.mjs skriver om dem utan text
  for (const old of ['text.md', 'uppslag.json']) fs.rmSync(path.join(BOCKER, slug, old), { force: true });
  console.log(`${slug}: ${converted} uppslag omgjorda till mätdata, ${redacted} uppslag rensade från längre citat`);
}
