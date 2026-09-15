// Repliker i manus: talstreck som tappats bort, punktlistor från ordbehandlare och
// AI-text som glömt markeringen. Ingen serverkod - används både i klienten och i API:t.
//
// Vanligaste orsaken till försvunna talstreck: författaren skriver repliker som en
// punktlista i Word, Pages eller Google Docs. Punkterna är formatering, inte tecken,
// så de försvinner när texten klistras in som vanlig text.

export const DEFAULT_MARKER = '– ';

// Anföringsverb som står efter repliken ("... säger mamma", "... Ropar Otis")
const SPEECH_VERBS = [
  'säger', 'sa', 'sade', 'ropar', 'ropade', 'frågar', 'frågade', 'undrar', 'undrade', 'svarar', 'svarade',
  'viskar', 'viskade', 'skriker', 'skrek', 'suckar', 'suckade', 'mumlar', 'mumlade', 'muttrar', 'muttrade',
  'fnissar', 'fnissade', 'väser', 'väste', 'fräser', 'fräste', 'morrar', 'gnäller', 'gnällde', 'tjatar', 'tjatade',
  'utbrister', 'utbrast', 'stönar', 'stönade', 'snyftar', 'snyftade', 'flämtar', 'flämtade', 'protesterar',
  'förklarar', 'förklarade', 'fortsätter', 'fortsatte', 'upprepar', 'upprepade', 'skrattar', 'skrattade',
  'klagar', 'klagade', 'hojtar', 'hojtade', 'vrålar', 'vrålade', 'piper', 'pep', 'gråter', 'grät', 'tröstar',
  'tröstade', 'svär', 'svor', 'lovar', 'lovade', 'påminner', 'påminde', 'avbryter', 'avbröt', 'säjer',
];

// Vem som talar efter verbet: pronomen, namn eller en vanlig roll
const SPEAKER = String.raw`(han|hon|hen|de|dom|vi|jag|du|ni|[A-ZÅÄÖ][a-zåäöé]+|mamma|pappa|mormor|morfar|farmor|farfar|fröken|läraren|polisen|killen|tjejen|flickan|pojken|grannen|[a-zåäö]{3,}(?:en|et))`;

// Verbet får ha stor eller liten bokstav ("Frågar Otis" / "säger mamma") - men talaren
// måste vara ett riktigt subjekt, så att "Otis nickar, säger ingenting." inte räknas
const VERB = SPEECH_VERBS.map(v => `[${v[0].toUpperCase()}${v[0]}]${v.slice(1)}`).join('|');
const TAGGED = new RegExp(String.raw`^.{1,300}?[?!,.…]\s+(?:${VERB})\s+${SPEAKER}(?=[\s,.!?]|$)`);
const NOT_SPEAKERS = /^(ingenting|inget|ingen|något|någon|allt|mer|mycket|lite|bara|också|igen|nu|sedan|sen|ja|nej|tyst|högt|lågt)$/i;

// Tecken som inleder en replik eller en punkt i en inklistrad lista
const LEADING_MARK = /^\s*(?:[*•●◦▪▫·‣⁃-]|[–—―])\s*/;

export function hasDialogueMarker(line: string): boolean {
  return /^\s*(?:[*•●◦▪·‣⁃]|[–—―-])\s+/.test(line) || /^\s*["”»]/.test(line);
}

function looksLikeHeading(line: string): boolean {
  return /^(kapitel\s+\S+|prolog|epilog|inledning|förord|efterord)\b/i.test(line.trim()) && line.length < 120;
}

// Replik utan anföring, t.ex. "Vad blir det för mat?" eller "Nej älskling, du får vänta lite."
function looksLikeUtterance(line: string): boolean {
  const t = line.trim();
  const words = t.split(/\s+/).length;
  if (words > 25) return false;
  // Berättartext börjar ofta med subjekt + verb i tredje person ("Han tittar ...")
  if (/^(han|hon|hen|de|dom|det|den)\s+\w+(ar|er|r)\b/i.test(t)) return false;
  // Kort fråga eller utrop i en enda mening (tankar i flera meningar räknas inte)
  const oneSentence = !/[.…]\s+\S/.test(t);
  if (oneSentence && words <= 18 && /[?!]["”»]?$/.test(t)) return true;
  // Tilltal i andra person ("du", "dig", "ni") hör hemma i repliker, inte i berättartext
  return /\b(du|dig|din|ditt|dina|ni|er)\b/i.test(t) && words <= 25;
}

/**
 * Hittar repliker som saknar talstreck och lägger tillbaka dem.
 * Bara stycken som tydligt är repliker ändras: med anföring ("..., säger mamma")
 * eller korta frågor/utrop direkt intill en annan replik.
 */
export function restoreDialogueMarkers(text: string, marker: string = DEFAULT_MARKER): { text: string; added: number } {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const isDialogue = lines.map(l => {
    const t = l.trim();
    if (!t || looksLikeHeading(t)) return false;
    if (hasDialogueMarker(t)) return true;
    const m = t.match(TAGGED);
    return !!m && !NOT_SPEAKERS.test(m[1]);
  });
  // Korta repliker utan anföring som står direkt efter eller före en replik
  for (let pass = 0; pass < 3; pass++) {
    lines.forEach((l, i) => {
      if (isDialogue[i] || !l.trim() || looksLikeHeading(l)) return;
      const prev = lines.slice(0, i).reverse().findIndex(x => x.trim());
      const prevIndex = prev === -1 ? -1 : i - 1 - prev;
      const nextOffset = lines.slice(i + 1).findIndex(x => x.trim());
      const nextIndex = nextOffset === -1 ? -1 : i + 1 + nextOffset;
      const neighbour = (prevIndex >= 0 && isDialogue[prevIndex]) || (nextIndex >= 0 && isDialogue[nextIndex]);
      if (neighbour && looksLikeUtterance(l)) isDialogue[i] = true;
    });
  }

  let added = 0;
  const out = lines.map((l, i) => {
    if (!isDialogue[i]) return l;
    const t = l.trim();
    if (/^\s*["”»]/.test(t)) return l; // repliker med citattecken lämnas som de är
    const body = t.replace(LEADING_MARK, '');
    const next = `${marker}${body}`;
    if (!hasDialogueMarker(t)) added++;
    return next;
  });
  return { text: out.join('\n'), added };
}

// Hur många repliker saknar talstreck? (för att visa en hjälpsam knapp)
export function countMissingMarkers(text: string): number {
  return restoreDialogueMarkers(text).added;
}

// Vilken markering använder texten redan? Annars svenskt talstreck.
export function preferredMarker(text: string): string {
  const counts = { '* ': 0, '– ': 0, '- ': 0 } as Record<string, number>;
  text.split('\n').forEach(l => {
    const m = l.match(/^\s*(\*|–|-)\s/);
    if (m) counts[`${m[1]} `]++;
  });
  const [best, n] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return n >= 2 ? best : DEFAULT_MARKER;
}

/**
 * Gör om inklistrad HTML (Word, Pages, Google Docs) till manus där listpunkter
 * blir talstreck. Returnerar null om urklippet inte innehåller några listor.
 */
export function manuscriptFromClipboardHtml(html: string, marker: string = DEFAULT_MARKER): string | null {
  if (typeof DOMParser === 'undefined' || !/<li[\s>]|mso-list/i.test(html)) return null;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const lines: string[] = [];
  const textOf = (el: Element) => {
    // Words dolda punkttecken ("·" / "o") ligger i spans med mso-list:Ignore
    el.querySelectorAll('[style*="mso-list:Ignore" i], [style*="mso-list: Ignore" i]').forEach(s => s.remove());
    el.querySelectorAll('br').forEach(br => br.replaceWith('\n'));
    return (el.textContent ?? '').replace(/ /g, ' ').replace(/[ \t]+/g, ' ').trim();
  };
  const walk = (node: Element) => {
    Array.from(node.children).forEach(child => {
      const tag = child.tagName.toLowerCase();
      const style = child.getAttribute('style') ?? '';
      const cls = child.getAttribute('class') ?? '';
      if (tag === 'li') {
        const t = textOf(child);
        if (t) lines.push(`${marker}${t.replace(LEADING_MARK, '')}`);
      } else if (/^(p|h[1-6])$/.test(tag)) {
        const isListItem = /mso-list/i.test(style) || /MsoListParagraph/i.test(cls);
        const t = textOf(child);
        if (t) lines.push(isListItem ? `${marker}${t.replace(LEADING_MARK, '')}` : t);
      } else if (tag !== 'style' && tag !== 'script') {
        walk(child);
      }
    });
  };
  walk(doc.body);
  return lines.length > 0 ? lines.join('\n') : null;
}

// Klistra in i en textruta med listpunkter som talstreck. Returnerar nytt värde,
// eller null om den vanliga inklistringen duger.
export function pasteManuscript(
  e: { clipboardData: DataTransfer | null; preventDefault: () => void; currentTarget: HTMLTextAreaElement },
  currentValue: string,
): string | null {
  const data = e.clipboardData;
  if (!data) return null;
  const marker = preferredMarker(currentValue);
  let converted = manuscriptFromClipboardHtml(data.getData('text/html'), marker);
  if (converted === null) {
    // Vanlig text med punkttecken ("•\tHej!") från vissa appar
    const plain = data.getData('text/plain');
    if (!/^\s*[•●◦▪·‣⁃]\s*/m.test(plain)) return null;
    converted = plain.split(/\r?\n/).map(l => (/^\s*[•●◦▪·‣⁃]\s*/.test(l) ? `${marker}${l.replace(/^\s*[•●◦▪·‣⁃]\s*/, '')}` : l)).join('\n');
  }
  e.preventDefault();
  const el = e.currentTarget;
  const start = el.selectionStart ?? currentValue.length;
  const end = el.selectionEnd ?? currentValue.length;
  return currentValue.slice(0, start) + converted + currentValue.slice(end);
}
