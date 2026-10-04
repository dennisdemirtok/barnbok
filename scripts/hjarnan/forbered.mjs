#!/usr/bin/env node
// Steg 1 i hjärnans inläsning: tar en bok ur referensbocker/inkorg/ och gör den
// redo för analys i referensbocker/bocker/<bok>/.
//
//   node scripts/hjarnan/forbered.mjs                       alla böcker i inkorgen
//   node scripts/hjarnan/forbered.mjs --kalla IMG-mapp --namn "Bokens titel" --rotera 270
//   node scripts/hjarnan/forbered.mjs --kalla ~/Downloads/bok.zip --namn "..." --rotera 270 --rotera-sidor 1=90
//
// En bok kan vara en mapp med mobilfoton (HEIC/JPG/PNG), en zip med foton, en
// PDF eller en EPUB - i inkorgen eller var som helst (--kalla med full sökväg).
// Videor (Live Photos) hoppas över. --rotera-sidor vrider enstaka foton annorlunda
// (t.ex. omslaget), som "1=90,45=180".
// Ut kommer:
//   sidor/001.jpg          hela uppslaget, rättvänt, 1600 px - för bildanalysen
//   sidor/001-a.jpg/-b.jpg vänster/höger halva i högre upplösning - för texten
//   text-pdf.txt           texten direkt ur en PDF/EPUB (om det finns ett textlager)
//   bok.json               metadata och sidlista
// Källan sparas aldrig på datorn: en källa i inkorgen flyttas till klara/ bredvid
// inkorgen (i molnet om inkorgen är en länk dit), en källa utanför lämnas orörd.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { INKORG, BOCKER, ROOT, slugify, writeJson, readJson, args, molnRot, flytta } from './lib.mjs';

const require = createRequire(import.meta.url);
const sharp = require(path.join(ROOT, 'node_modules/sharp'));

const IMAGE = /\.(heic|heif|jpe?g|png|webp|tiff?)$/i;
const opts = args();
// Enstaka foton som ska vridas annorlunda än resten: "1=90,45=180"
const PAGE_ROTATION = Object.fromEntries((opts['rotera-sidor'] || '').split(',').filter(Boolean)
  .map(x => x.split('=').map(Number)));

function listImages(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listImages(full));
    else if (IMAGE.test(entry.name)) out.push(full);
  }
  // Mobilens filnamn (IMG_0999 ...) går i fotoordning
  return out.sort((a, b) => path.basename(a).localeCompare(path.basename(b), 'sv', { numeric: true }));
}

// HEIC läses inte av sharp - macOS sips gör om till JPEG först
function toJpeg(file, tmp) {
  if (!/\.(heic|heif)$/i.test(file)) return file;
  const out = path.join(tmp, path.basename(file).replace(/\.\w+$/, '.jpg'));
  execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '92', file, '--out', out], { stdio: 'ignore' });
  return out;
}

async function writePage(src, dir, nr, rotation) {
  const name = String(nr).padStart(3, '0');
  // Först mobilens egen orientering (EXIF), sedan bokens vridning på bordet
  const oriented = await sharp(src).rotate().toBuffer();
  const buf = rotation ? await sharp(oriented).rotate(rotation).toBuffer() : oriented;
  const meta = await sharp(buf).metadata();
  await sharp(buf).resize({ width: 1600, height: 1600, fit: 'inside' }).jpeg({ quality: 82 }).toFile(path.join(dir, `${name}.jpg`));
  // Halvor med lite överlapp så att inget ord vid fästet försvinner
  const files = [`${name}.jpg`];
  if (meta.width > meta.height * 1.15) {
    const half = Math.round(meta.width * 0.53);
    for (const [suffix, left] of [['a', 0], ['b', meta.width - half]]) {
      await sharp(buf).extract({ left, top: 0, width: half, height: meta.height })
        .resize({ width: 1600, height: 1600, fit: 'inside' }).jpeg({ quality: 85 })
        .toFile(path.join(dir, `${name}-${suffix}.jpg`));
      files.push(`${name}-${suffix}.jpg`);
    }
  }
  return { nr, fil: `${name}.jpg`, halvor: files.slice(1), bredd: meta.width, hojd: meta.height };
}

async function prepareImages(images, bookDir, rotation) {
  const sidor = path.join(bookDir, 'sidor');
  fs.mkdirSync(sidor, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hjarnan-'));
  const pages = [];
  for (let i = 0; i < images.length; i++) {
    const jpg = toJpeg(images[i], tmp);
    const page = await writePage(jpg, sidor, i + 1, PAGE_ROTATION[i + 1] ?? rotation);
    pages.push({ ...page, original: path.basename(images[i]) });
    process.stdout.write(`\r  ${i + 1}/${images.length} sidor`);
  }
  process.stdout.write('\n');
  fs.rmSync(tmp, { recursive: true, force: true });
  return pages;
}

function pdfText(file, bookDir) {
  try {
    const out = path.join(bookDir, 'text-pdf.txt');
    execFileSync('pdftotext', ['-layout', file, out]);
    return fs.readFileSync(out, 'utf8').trim().length > 200;
  } catch { return false; }
}

function pdfImages(file, tmp) {
  execFileSync('pdftoppm', ['-jpeg', '-r', '110', file, path.join(tmp, 'sida')]);
  return listImages(tmp);
}

function epubText(file, bookDir) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'epub-'));
  execFileSync('unzip', ['-q', '-o', file, '-d', tmp]);
  const html = [];
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).forEach(e => {
    const f = path.join(d, e.name);
    if (e.isDirectory()) walk(f); else if (/\.x?html?$/i.test(e.name)) html.push(f);
  });
  walk(tmp);
  const text = html.sort().map(f => fs.readFileSync(f, 'utf8')
    .replace(/<(br|\/p|\/h\d|\/div)[^>]*>/gi, '\n\n').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\n{3,}/g, '\n\n')).join('\n\n');
  fs.writeFileSync(path.join(bookDir, 'text-pdf.txt'), text);
  fs.rmSync(tmp, { recursive: true, force: true });
}

async function prepare(source) {
  const name = opts.namn || path.basename(source).replace(/\.(zip|pdf|epub)$/i, '');
  const slug = slugify(name);
  const bookDir = path.join(BOCKER, slug);
  const rotation = Number(opts.rotera || 0);
  if (fs.existsSync(path.join(bookDir, 'bok.json')) && !opts.om) {
    console.log(`${slug}: finns redan (kör med --om för att göra om)`);
    return;
  }
  console.log(`\n${name} → bocker/${slug}${rotation ? ` (roteras ${rotation}°)` : ''}`);
  fs.mkdirSync(bookDir, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kalla-'));
  let pages = [];
  let textLayer = false;

  if (/\.zip$/i.test(source)) {
    execFileSync('unzip', ['-q', '-o', source, '-x', '*.MP4', '*.mp4', '*.MOV', '*.mov', '__MACOSX/*', '-d', tmp]);
    pages = await prepareImages(listImages(tmp), bookDir, rotation);
  } else if (/\.pdf$/i.test(source)) {
    textLayer = pdfText(source, bookDir);
    pages = await prepareImages(pdfImages(source, tmp), bookDir, rotation);
  } else if (/\.epub$/i.test(source)) {
    epubText(source, bookDir);
    textLayer = true;
  } else {
    pages = await prepareImages(listImages(source), bookDir, rotation);
  }
  fs.rmSync(tmp, { recursive: true, force: true });

  // Källan ur inkorgen flyttas till klara/ så att inkorgen bara visar det som är kvar att göra
  let arkiv = source;
  if (path.dirname(source) === INKORG) {
    arkiv = path.join(molnRot() ?? path.dirname(INKORG), 'klara', path.basename(source));
    flytta(source, arkiv);
  }

  const existing = readJson(path.join(bookDir, 'bok.json'), {});
  writeJson(path.join(bookDir, 'bok.json'), {
    ...existing,
    slug,
    titel: existing.titel || name,
    forfattare: existing.forfattare || null,
    illustrator: existing.illustrator || null,
    forlag: existing.forlag || null,
    boktyp: existing.boktyp || null, // närmaste boktyp i appen (styles.ts), sätts vid analysen
    alder: existing.alder || null,
    kalla: arkiv,
    rotation,
    rotationSidor: Object.keys(PAGE_ROTATION).length ? PAGE_ROTATION : undefined,
    textlager: textLayer,
    sidor: pages,
    status: 'förberedd',
    forberedd: new Date().toISOString(),
  });
  console.log(`  klar: ${pages.length} sidor${textLayer ? ' + textlager' : ''}`);
}

const expandHome = (p) => p.replace(/^~(?=\/)/, os.homedir());
const sources = opts.kalla
  ? [path.isAbsolute(expandHome(opts.kalla)) ? expandHome(opts.kalla) : path.join(INKORG, opts.kalla)]
  : fs.existsSync(INKORG) ? fs.readdirSync(INKORG).filter(f => !f.startsWith('.')).map(f => path.join(INKORG, f)) : [];
if (sources.length === 0) console.log('Inkorgen är tom: lägg en mapp, zip, PDF eller EPUB per bok i referensbocker/inkorg/');
for (const s of sources) {
  if (!fs.existsSync(s)) { console.error(`Hittar inte ${s}`); continue; }
  await prepare(s);
}
