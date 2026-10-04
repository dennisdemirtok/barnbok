// Svensk text inför uppläsning. Rösterna läser det som står, och vissa skrivsätt
// låter fel uppläst: "tv:n" blir "te-ve, än", "t.ex." stavas ut och "3:e" blir
// "tre e". Här skrivs de om till det en svensk inläsare faktiskt säger. Bokens
// egen uttalslista läggs på efteråt och vinner alltid.
import { stripEmphasis } from './emphasis';

// Förkortningar som sägs som ord eller bokstäver. Ändelsen efter kolon läggs
// till som den är: "tv:n" -> "teven", "tv:ns" -> "tevens", "cd:n" -> "cedén".
const SPOKEN_ACRONYMS: Record<string, string> = {
  tv: 'teve',
  cd: 'cede',
  dvd: 'devede',
  pc: 'pece',
  sms: 'esemes',
  mms: 'emmemes',
  usa: 'u-ess-a',
  eu: 'e-u',
  fn: 'eff-enn',
  vm: 've-emm',
  em: 'e-emm',
  os: 'o-ess',
  dna: 'de-enn-a',
  gps: 'ge-pe-ess',
  wc: 've-ce',
  ok: 'okej',
};

// Ordningstal ("1:a", "3:e") och siffror som namn ("1:an" = ettan)
const ORDINALS = ['', 'första', 'andra', 'tredje', 'fjärde', 'femte', 'sjätte', 'sjunde', 'åttonde', 'nionde', 'tionde',
  'elfte', 'tolfte', 'trettonde', 'fjortonde', 'femtonde', 'sextonde', 'sjuttonde', 'artonde', 'nittonde', 'tjugonde'];
const NUMBER_NAMES = ['nollan', 'ettan', 'tvåan', 'trean', 'fyran', 'femman', 'sexan', 'sjuan', 'åttan', 'nian', 'tian',
  'elvan', 'tolvan'];

function ordinal(n: number): string | null {
  if (n >= 1 && n <= 20) return ORDINALS[n];
  if (n > 20 && n < 40) {
    const tens = n < 30 ? 'tjugo' : 'trettio';
    const unit = n % 10;
    return unit === 0 ? `${tens}nde` : `${tens}${ORDINALS[unit]}`;
  }
  return null;
}

// Vanliga förkortningar med punkt. Ordningen spelar roll: längre först.
const ABBREVIATIONS: [RegExp, string][] = [
  [/\bfr\.\s?o\.\s?m\./gi, 'från och med'],
  [/\bt\.\s?o\.\s?m\./gi, 'till och med'],
  [/\bo\.\s?s\.\s?v\./gi, 'och så vidare'],
  [/\bd\.\s?v\.\s?s\./gi, 'det vill säga'],
  [/\bt\.\s?ex\./gi, 'till exempel'],
  [/\bbl\.\s?a\./gi, 'bland annat'],
  [/\bm\.\s?m\./gi, 'med mera'],
  [/\bs\.\s?k\./gi, 'så kallad'],
  [/\bf\.\s?d\./gi, 'före detta'],
  [/\bosv\./gi, 'och så vidare'],
  [/\bdvs\./gi, 'det vill säga'],
  [/\bkl\.\s?(?=\d)/gi, 'klockan '],
  [/\bca\.?\s(?=\d)/gi, 'cirka '],
  [/\bnr\.?\s?(?=\d)/gi, 'nummer '],
  [/(\d)\s?st\.?(?=\s|$|[,.!?])/g, '$1 stycken'],
  [/(\d)\s?kr\.?(?=\s|$|[,.!?])/g, '$1 kronor'],
  [/(\d)\s?km(?=\s|$|[,.!?])/g, '$1 kilometer'],
];

// Stor bokstav först om originalet hade det som ord ("T.ex.", "Tv:n" i början av
// en mening) - inte för förkortningar som alltid skrivs med versaler (TV, USA)
function keepCase(original: string, replacement: string): string {
  return /^[A-ZÅÄÖ][a-zåäö.]/.test(original) ? replacement.charAt(0).toUpperCase() + replacement.slice(1) : replacement;
}

// Ordgränser som räknar å, ä och ö som bokstäver (JavaScripts \b gör inte det)
const L = 'A-Za-zÅÄÖåäöÉéÜü';

/** Skriver om text så att den låter rätt uppläst på svenska. */
export function prepareForSpeech(text: string): string {
  // Kursivmarkeringen (_ord_) ska inte läsas upp
  let out = stripEmphasis(text);

  // "tv:n", "USA:s", "cd:ns" - kolon mellan förkortning och ändelse
  out = out.replace(new RegExp(`(^|[^${L}])([${L}]{2,5}):([a-zåäö]{1,4})(?=$|[^${L}])`, 'g'), (match, before: string, word: string, ending: string) => {
    const spoken = SPOKEN_ACRONYMS[word.toLowerCase()];
    return before + (spoken ? keepCase(word, `${spoken}${ending}`) : `${word}${ending}`);
  });

  // En bokstav med ändelse: "sina O:n" -> "sina o-n"
  out = out.replace(new RegExp(`(^|[^${L}])([${L}]):([a-zåäö]{1,3})(?=$|[^${L}])`, 'g'), (match, before: string, letter: string, ending: string) =>
    `${before}${letter.toLowerCase()}-${ending}`);

  // Hyschande: "Sch!" läses annars med ett k på slutet
  out = out.replace(new RegExp(`(^|[^${L}])(S)ch(?=$|[^${L}])`, 'gi'), (match, before: string, s: string) => `${before}${s}chhh`);

  // "1:a", "3:e", "21:a" och "1:an", "3:an"
  out = out.replace(/\b(\d{1,2}):(a|e)\b/g, (match, num: string) => ordinal(parseInt(num, 10)) ?? match);
  out = out.replace(/\b(\d{1,2}):an\b/g, (match, num: string) => NUMBER_NAMES[parseInt(num, 10)] ?? match);

  for (const [pattern, spoken] of ABBREVIATIONS) {
    out = out.replace(pattern, (match: string, ...args: unknown[]) => {
      const value = spoken.includes('$1') ? spoken.replace('$1', String(args[0])) : spoken;
      // Förkortningens punkt avslutade ofta också meningen: behåll den då
      const offset = args[args.length - 2] as number;
      const whole = args[args.length - 1] as string;
      const endsSentence = match.endsWith('.') && /^\s+[A-ZÅÄÖ]/.test(whole.slice(offset + match.length));
      return keepCase(match, value) + (endsSentence ? '.' : '');
    });
  }

  // Ensamt "tv" och liknande utan ändelse (men inte "tv" i "tvåan")
  out = out.replace(new RegExp(`(^|[^${L}])(tv|dvd|cd|sms|pc)(?=$|[^${L}])`, 'gi'), (match, before: string, word: string) =>
    before + keepCase(word, SPOKEN_ACRONYMS[word.toLowerCase()]));

  return out;
}
