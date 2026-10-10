#!/usr/bin/env node
// Korrekturläser böckerna i bokhandeln (de publicerade) med appens korrekturläsning
// (/api/proofread) och skriver en rapport. Ändrar ingenting utan --ratta.
//
//   node scripts/korrektur-bokhandeln.mjs                 rapport: eval-reports/korrektur-bokhandeln.md
//   node scripts/korrektur-bokhandeln.mjs --bok <id>      bara en bok
//   node scripts/korrektur-bokhandeln.mjs --ratta         rättar de tydliga felen från rapporten i molnet
//                                                         och sparar korrekturstatusen (inga nya AI-anrop)
// Servern som läser: --base (standard http://localhost:3000). Text som ändrats sedan
// rapporten rörs inte.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, loadTs, readEnv, readJson, writeJson, args } from './hjarnan/lib.mjs';

const { textHash } = loadTs(path.join(ROOT, 'src/lib/proof.ts'));
const { getStylePreset } = loadTs(path.join(ROOT, 'src/lib/styles.ts'));
const opts = args();
const BASE = opts.base || 'http://localhost:3000';
const RAW = path.join(ROOT, 'eval-reports', 'korrektur-bokhandeln.raw.json');
const REPORT = path.join(ROOT, 'eval-reports', 'korrektur-bokhandeln.md');

const env = readEnv();
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!env.NEXT_PUBLIC_SUPABASE_URL || !KEY) throw new Error('Supabase-nycklarna saknas i .env.local');
const rest = (p, init = {}) => fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${p}`, {
  ...init,
  headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
}).then(async r => {
  if (!r.ok) throw new Error(`${p.split('?')[0]}: ${r.status} ${await r.text()}`);
  return r.status === 204 ? null : r.json();
});

const parseTheme = (theme) => {
  try { return typeof theme === 'string' && theme.startsWith('{') ? JSON.parse(theme) : {}; } catch { return {}; }
};

// Bokens text i läsordning: uppslag för uppslag, block för block
async function loadBook(row) {
  const spreads = await rest(`barnbok_spreads?book_id=eq.${row.id}&select=id,spread_number,pages,chapter&order=sort_order`);
  const blocks = [];
  for (let i = 0; i < spreads.length; i += 50) {
    const ids = spreads.slice(i, i + 50).map(s => s.id).join(',');
    blocks.push(...await rest(`barnbok_text_blocks?spread_id=in.(${ids})&select=id,spread_id,position,text_content&order=position`));
  }
  const characters = await rest(`barnbok_characters?book_id=eq.${row.id}&select=name`);
  return {
    spreads: spreads.map(s => ({ ...s, blocks: blocks.filter(b => b.spread_id === s.id).sort((a, b) => a.position - b.position) })),
    names: characters.map(c => c.name).filter(Boolean),
  };
}

async function proofread() {
  const filter = opts.bok ? `&id=eq.${opts.bok}` : '';
  const rows = await rest(`barnbok_books?is_public=eq.true${filter}&select=id,title,book_format,theme,age_min,age_max&order=published_at`);
  const books = [];
  for (const row of rows) {
    const { spreads, names } = await loadBook(row);
    const sections = spreads.flatMap(s => s.blocks.filter(b => (b.text_content || '').trim()).map(b => ({ key: `${s.id}#${b.position}`, text: b.text_content })));
    const words = sections.reduce((n, s) => n + s.text.split(/\s+/).filter(Boolean).length, 0);
    process.stdout.write(`${row.title} (${words} ord)... `);
    const meta = parseTheme(row.theme);
    const res = await fetch(`${BASE}/api/proofread`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sections,
        targetAge: `${row.age_min}-${row.age_max} år`,
        dialogue: row.book_format === 'bildbok-text-pa-bild' ? 'none' : getStylePreset(meta.stylePresetId)?.book.dialogue ?? 'dash',
        names,
        autoFix: false, // allt blir förslag - rättningen görs med --ratta efter att rapporten lästs
      }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.results) throw new Error(`${row.title}: ${data?.error || res.status}`);
    const original = new Map(sections.map(s => [s.key, s.text]));
    const results = data.results.map(r => ({ key: r.key, text: original.get(r.key), issues: r.issues }));
    const certain = results.reduce((n, r) => n + r.issues.filter(i => i.certain).length, 0);
    const other = results.reduce((n, r) => n + r.issues.filter(i => !i.certain).length, 0);
    console.log(`${certain} tydliga fel, ${other} förslag`);
    books.push({ id: row.id, title: row.title, words, spreads: spreads.map(s => ({ id: s.id, number: s.spread_number, pages: s.pages, chapter: s.chapter })), results });
  }
  writeJson(RAW, { createdAt: new Date().toISOString(), base: BASE, books });
  writeReport(books);
}

function writeReport(books) {
  const lines = [
    '# Korrekturläsning av bokhandeln',
    `${new Date().toISOString().slice(0, 16).replace('T', ' ')} · ${books.length} böcker · ${books.reduce((n, b) => n + b.words, 0)} ord`,
    '',
    '"Tydliga fel" rättas med --ratta. Övriga förslag lämnas till författaren (Rätta text i bokens sista steg).',
    '',
    '| Bok | Ord | Tydliga fel | Förslag |',
    '|---|---|---|---|',
    ...books.map(b => {
      const issues = b.results.flatMap(r => r.issues);
      return `| ${b.title} | ${b.words} | ${issues.filter(i => i.certain).length} | ${issues.filter(i => !i.certain).length} |`;
    }),
  ];
  for (const b of books) {
    const where = new Map(b.spreads.map(s => [s.id, s]));
    const rows = b.results.flatMap(r => r.issues.map(i => ({ ...i, spread: where.get(r.key.split('#')[0]) })));
    if (rows.length === 0) continue;
    lines.push('', `## ${b.title}`);
    for (const i of rows.sort((x, y) => Number(y.certain) - Number(x.certain))) {
      const place = i.spread ? `${i.spread.chapter ? `${i.spread.chapter}, ` : ''}sida ${i.spread.pages}` : '';
      lines.push(`- ${i.certain ? '**Tydligt fel**' : 'Förslag'} (${i.kind}, ${place}): «${i.quote}» → «${i.fix}» - ${i.reason}`);
    }
  }
  fs.writeFileSync(REPORT, lines.join('\n') + '\n');
  console.log(`Rapport: ${REPORT}`);
}

// Rättar de tydliga felen från rapporten och sparar korrekturstatusen per uppslag
async function applyFixes() {
  const raw = readJson(RAW);
  if (!raw) throw new Error(`Hittar ingen rapport (${RAW}) - kör utan --ratta först`);
  for (const book of raw.books.filter(b => !opts.bok || b.id === opts.bok)) {
    const [row] = await rest(`barnbok_books?id=eq.${book.id}&select=theme`);
    const { spreads } = await loadBook({ id: book.id });
    const byKey = new Map(book.results.map(r => [r.key, r]));
    const meta = parseTheme(row?.theme);
    const proofs = { ...(meta.proof || {}) };
    let fixed = 0;
    let skipped = 0;
    for (const spread of spreads) {
      if (!spread.blocks.some(b => (b.text_content || '').trim())) continue;
      // Text som ändrats sedan rapporten lämnas orörd och räknas som okontrollerad
      if (spread.blocks.some(b => byKey.has(`${spread.id}#${b.position}`) && byKey.get(`${spread.id}#${b.position}`).text !== b.text_content)) {
        skipped++;
        continue;
      }
      let spreadFixed = 0;
      const open = [];
      const texts = [];
      for (const block of spread.blocks) {
        const result = byKey.get(`${spread.id}#${block.position}`);
        let text = block.text_content || '';
        for (const issue of result?.issues ?? []) {
          if (issue.certain && text.includes(issue.quote)) {
            text = text.replace(issue.quote, issue.fix);
            spreadFixed++;
          } else if (!issue.certain) {
            open.push({ quote: issue.quote, fix: issue.fix, kind: issue.kind, reason: issue.reason, certain: false });
          }
        }
        if (text !== (block.text_content || '')) {
          await rest(`barnbok_text_blocks?id=eq.${block.id}`, { method: 'PATCH', body: JSON.stringify({ text_content: text }), headers: { Prefer: 'return=minimal' } });
        }
        texts.push(text);
      }
      fixed += spreadFixed;
      proofs[String(spread.spread_number)] = { hash: textHash(texts.join('\n')), checkedAt: raw.createdAt, ...(spreadFixed ? { fixed: spreadFixed } : {}), issues: open };
    }
    await rest(`barnbok_books?id=eq.${book.id}`, { method: 'PATCH', body: JSON.stringify({ theme: JSON.stringify({ ...meta, proof: proofs }) }), headers: { Prefer: 'return=minimal' } });
    console.log(`${book.title}: ${fixed} fel rättade${skipped ? `, ${skipped} uppslag hoppades över (ändrade sedan rapporten)` : ''}`);
  }
}

if (opts.ratta) await applyFixes();
else await proofread();
