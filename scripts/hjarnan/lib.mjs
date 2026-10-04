// Gemensamt för hjärnans skript: sökvägar, TypeScript-moduler utan byggsteg och .env.local
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
export const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
// Allt med förlagornas text och bilder ligger här - ignoreras av git
export const REF = path.join(ROOT, 'referensbocker');
export const INKORG = path.join(REF, 'inkorg');
export const BOCKER = path.join(REF, 'bocker');

// Molnmappen: är inkorgen en länk till t.ex. Google Drive hamnar källfiler och
// bilder där efter analysen, och datorn behåller bara texten och analysen.
export function molnRot() {
  try {
    const real = fs.realpathSync(INKORG);
    return real === INKORG ? null : path.dirname(real);
  } catch {
    return null;
  }
}

// Flytt som fungerar mellan disk och molnmapp (rename fungerar bara inom samma volym)
export function flytta(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  try {
    fs.renameSync(src, dest);
  } catch (err) {
    if (err.code !== 'EXDEV') throw err;
    fs.cpSync(src, dest, { recursive: true });
    fs.rmSync(src, { recursive: true, force: true });
  }
}

export function loadTs(file) {
  const ts = require(path.join(ROOT, 'node_modules/typescript'));
  const source = fs.readFileSync(file, 'utf8');
  const out = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const mod = { exports: {} };
  const localRequire = (id) => id.startsWith('./') ? loadTs(path.join(path.dirname(file), `${id.slice(2)}.ts`)) : require(id);
  new Function('module', 'exports', 'require', out)(mod, mod.exports, localRequire);
  return mod.exports;
}

export function readEnv() {
  const env = {};
  const file = path.join(ROOT, '.env.local');
  if (!fs.existsSync(file)) return env;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.+)$/);
    if (m) env[m[1]] = m[2].trim();
  }
  return env;
}

export function slugify(name) {
  return name.toLowerCase()
    .replace(/[åä]/g, 'a').replace(/ö/g, 'o').replace(/é/g, 'e')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'bok';
}

export function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

export function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}

export function args() {
  return Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? 'true' : all[i + 1]]);
    return acc;
  }, []));
}
