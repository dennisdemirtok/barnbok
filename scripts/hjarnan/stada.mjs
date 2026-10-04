#!/usr/bin/env node
// Sista steget i hjärnans inläsning: flyttar bokens bilder (sidor/ och ev. original/)
// till molnmappen så att datorn bara behåller texten och analysen (någon MB per bok).
// Kräver att referensbocker/inkorg är en länk till molnmappen (t.ex. Google Drive).
//
//   node scripts/hjarnan/stada.mjs --bok yumi-tomu-resan-till-interversum
//   node scripts/hjarnan/stada.mjs --alla
//
// Bilderna går att nå igen i <molnmappen>/bocker/<bok>/ (sökvägen står i bok.json).
import fs from 'node:fs';
import path from 'node:path';
import { BOCKER, molnRot, flytta, readJson, writeJson, args } from './lib.mjs';

const opts = args();
const moln = molnRot();
if (!moln) {
  console.error('Ingen molnmapp kopplad: referensbocker/inkorg är ingen länk till molnet.');
  process.exit(1);
}

const slugs = opts.alla ? fs.readdirSync(BOCKER).filter(d => fs.existsSync(path.join(BOCKER, d, 'bok.json'))) : [opts.bok];
for (const slug of slugs) {
  const dir = path.join(BOCKER, slug);
  const bok = readJson(path.join(dir, 'bok.json'));
  if (!bok) { console.error(`Hittar inte ${slug}`); continue; }
  const target = path.join(moln, 'bocker', slug);
  const moved = [];
  for (const folder of ['sidor', 'original']) {
    const src = path.join(dir, folder);
    if (!fs.existsSync(src)) continue;
    flytta(src, path.join(target, folder));
    moved.push(folder);
  }
  writeJson(path.join(dir, 'bok.json'), { ...bok, moln: target });
  console.log(`${slug}: ${moved.length ? `flyttade ${moved.join(' och ')} till molnet` : 'inget kvar att flytta'} (${target})`);
}
