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
  return char.name
    .split(/[\s\-–]+/)
    .map(p => p.trim())
    .filter(p => p.length >= 3 && !GENERIC.has(p.toLowerCase()))
    .filter(p => !others.some(o => o.name.split(/[\s\-–]+/).some(q => q.toLowerCase() === p.toLowerCase())));
}

export function mentionsCharacter(text: string, char: Character, all: Character[]): boolean {
  if (!text) return false;
  if (mentions(text, char.name)) return true;
  if (char.heroName && mentions(text, char.heroName)) return true;
  return distinctiveParts(char, all).some(part => mentions(text, part));
}

/** Figurerna som bildbeskrivningen säger ska synas. */
export function picturedCharacters(imagePrompt: string, characters: Character[]): Character[] {
  return characters.filter(c => mentionsCharacter(imagePrompt || '', c, characters));
}

/** En post som egentligen är två personer ("Tage och Tindra Palmgren"). */
export function isGroupCharacter(char: Character): boolean {
  return /\s(och|&|and)\s/i.test(char.name);
}
