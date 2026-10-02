// Vilka figurer ska vara med på en bild?
//
// Bildmotorn och granskaren måste vara överens, annars ritar den ena in figurer
// som den andra sedan underkänner. Reglerna:
// - Det är bildbeskrivningen (inte berättartexten) som avgör vem som syns.
// - Namn matchas som hela ord, aldrig som delar av andra ord.
// - Släktord och titlar ("pappa", "mamma", "fröken") räknas inte ensamma, och
//   inte heller efternamn som flera figurer delar ("Palmgren") - annars kommer
//   hela familjen med på varje bild.
import { Character } from './types';

const GENERIC = new Set([
  'och', 'the', 'and', 'von', 'af', 'de', 'la', 'le', 'van', 'der', 'den', 'det',
  'pappa', 'mamma', 'farfar', 'farmor', 'morfar', 'mormor', 'moster', 'faster', 'morbror', 'farbror',
  'syster', 'bror', 'lillasyster', 'storasyster', 'lillebror', 'storebror', 'kusin',
  'fröken', 'herr', 'fru', 'tant', 'doktor', 'kapten', 'lärare', 'rektor',
  'mr', 'mrs', 'ms', 'miss', 'dad', 'mom', 'mum', 'grandma', 'grandpa', 'uncle', 'aunt', 'teacher', 'mister',
]);

function wordRegExp(term: string): RegExp {
  const escaped = term.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Genitiv-s ("Viljas", "Otis's") räknas som samma namn
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}(s|'s|’s)?($|[^\\p{L}\\p{N}])`, 'iu');
}

function mentions(text: string, term: string): boolean {
  return term.trim().length >= 2 && wordRegExp(term).test(text);
}

// Namndelar som bara pekar ut just den här figuren
function distinctiveParts(char: Character, all: Character[]): string[] {
  const others = all.filter(c => c !== char);
  const parts = char.name.split(/[\s\-–]+/).map(p => p.trim()).filter(p => p.length >= 3);
  const unique = (p: string) => !others.some(o => o.name.split(/[\s\-–]+/).some(q => q.toLowerCase() === p.toLowerCase()));
  const named = parts.filter(p => !GENERIC.has(p.toLowerCase()) && unique(p));
  if (named.length > 0) return named;
  // "Pappa Palmkvist": inget eget förnamn, och efternamnet delas med familjen.
  // Då får släktordet peka ut honom - så länge ingen annan figur bär det.
  return parts.filter(p => GENERIC.has(p.toLowerCase()) && p.toLowerCase() !== 'och' && unique(p));
}

export function mentionsCharacter(text: string, char: Character, all: Character[]): boolean {
  if (!text) return false;
  if (mentions(text, char.name)) return true;
  if (char.heroName && mentions(text, char.heroName)) return true;
  return distinctiveParts(char, all).some(part => mentions(text, part));
}

// Figurer som bara finns i minnen och på foton, t.ex. en förälder som dött. De
// ritas aldrig som levande personer i en scen - bara när bilden uttryckligen är
// ett minne, en dröm eller ett foto. Känns igen på hur planeringen beskrev dem
// ("syns på foto och i minne", "död sedan två år").
const MEMORY_ONLY_RE = /(syns (bara )?(på foto|i minne)|på foton? och i minne|bara (som|i) minne|i minnen och|avliden|är död|död sedan|dog (för|när)|gick bort|only (appears )?(in|as) (a )?(memory|memories|photo)|deceased|passed away)/i;
const MEMORY_SCENE_RE = /(memory|memories|dream|dreamlike|flashback|photo|photograph|framed picture|portrait|minne|dröm|foto|fotografi)/i;

export function isMemoryOnly(char: Character): boolean {
  return MEMORY_ONLY_RE.test(`${char.age || ''} ${char.appearance || ''} ${char.personality || ''}`);
}

/** Är bilden ett minne, en dröm eller ett foto (där en minnesfigur får synas)? */
export function isMemoryScene(imagePrompt: string): boolean {
  return MEMORY_SCENE_RE.test(imagePrompt || '');
}

/** Figurerna som bildbeskrivningen säger ska synas. */
export function picturedCharacters(imagePrompt: string, characters: Character[]): Character[] {
  return characters.filter(c =>
    mentionsCharacter(imagePrompt || '', c, characters) && (!isMemoryOnly(c) || isMemoryScene(imagePrompt)));
}

/** En post som egentligen är två personer ("Tage och Tindra Palmgren"). */
export function isGroupCharacter(char: Character): boolean {
  return /\s(och|&|and)\s/i.test(char.name);
}
