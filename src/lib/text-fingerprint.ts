// Fingeravtryck av svensk barnbokstext: mätbara drag som skiljer levande text
// från stolpig. Måtten räknas på DRAG per stycke (meningslängder, repliker,
// anföringsverb, utrop ...) - aldrig på sparad text. Förlagornas drag skrivs av
// läsarna i scripts/hjarnan utan att texten skrivs av, och appens egna texter
// görs om till samma drag med featuresOf(), så att båda mäts på exakt samma sätt.
// Ingen serverkod - körs i skript och kan köras i webbläsaren.

export interface TextFingerprint {
  words: number;
  sentences: number;
  paragraphs: number;
  // Rytm
  sentenceMean: number; // ord per mening
  sentenceMedian: number;
  sentenceVariation: number; // variationskoefficient - högre = mer levande rytm
  shortSentenceShare: number; // andel meningar med högst 5 ord
  longSentenceShare: number; // andel meningar med minst 20 ord
  paragraphMeanSentences: number;
  lix: number; // läsbarhetsindex: under 30 = mycket lättläst
  sentenceStartRepeat: number; // andel meningar som börjar med samma ord som föregående
  // Dialog
  dialogueShare: number; // andel ord i repliker
  repliesPer1000: number;
  replyMeanWords: number;
  dialogueMarker: 'dash' | 'quotes' | 'mixed' | 'none';
  speechTags: { verb: string; count: number }[]; // anföringsverb efter repliker
  saidShare: number; // andel anföringar som är sa/säger
  adverbTagsPer1000: number; // "sa hon glatt"
  // Röst
  presentTenseShare: number; // presens bland vanliga verb i berättartexten
  firstPersonPer1000: number; // jag/vi i berättartexten
  readerAddressPer1000: number; // du/dig till läsaren i berättartexten
  particlesPer1000: number; // ju, väl, nog, ändå, visst, liksom, faktiskt, alltså
  particles: { word: string; count: number }[];
  colloquialPer1000: number; // nån, nåt, sen, dom, ba, typ ...
  questionsPer100Sentences: number;
  exclamationsPer100Sentences: number;
  ellipsesPer1000: number;
  capsWordsPer1000: number; // ljudord och betoning i VERSALER
  emphasisPer1000: number; // _kursiv_ (markeras så i transkriberingen)
  // Berättande
  namedEmotionsPer1000: number; // glad, ledsen, rädd ... och "kände sig"
  tellPhrasesPer1000: number; // "som om", "plötsligt", "hjärtat bultade" ...
  aiTellsPer1000: number;
}

// Rubriker räknas inte: markdown-rubriker, kapitelrader och dagboksdagar
const HEADING = /^\s*(#+\s|kapitel\s+\S+|prolog\b|epilog\b|(måndag|tisdag|onsdag|torsdag|fredag|lördag|söndag)\b.{0,25}$)/i;
// Bokstäver inklusive å, ä, ö, é. JavaScripts \b och \w räknar inte å/ä/ö som
// bokstäver, så ordgränser skrivs ut med L nedan.
const L = 'A-Za-zÀ-ÖØ-öø-ÿ';
const UPPER = 'A-ZÀ-ÖØ-Þ';
const WORD = new RegExp(`[${L}0-9]+(?:[-'’][${L}0-9]+)*`, 'g');
const wordsRe = (alternatives: string) => new RegExp(`(?<![${L}])(?:${alternatives})(?![${L}])`, 'gi');

const SPEECH_VERBS = [
  'sa', 'sade', 'säger', 'frågade', 'frågar', 'svarade', 'svarar', 'ropade', 'ropar', 'viskade', 'viskar',
  'skrek', 'skriker', 'utbrast', 'utbrister', 'mumlade', 'mumlar', 'muttrade', 'muttrar', 'suckade', 'suckar',
  'fnissade', 'fnissar', 'skrattade', 'skrattar', 'väste', 'väser', 'stönade', 'stönar', 'tjöt', 'tjuter',
  'morrade', 'morrar', 'undrade', 'undrar', 'fortsatte', 'fortsätter', 'förklarade', 'förklarar',
  'konstaterade', 'konstaterar', 'påpekade', 'påpekar', 'flämtade', 'flämtar', 'gnällde', 'gnäller',
  'protesterade', 'protesterar', 'tillade', 'tillägger', 'jublade', 'jublar', 'vrålade', 'vrålar', 'pep', 'piper',
];
const SAID = new Set(['sa', 'sade', 'säger']);
const NOT_ADVERB = new Set(['att', 'det', 'allt', 'inte', 'ut', 'just', 'sist', 'först', 'bort', 'fast', 'mest', 'snart', 'litet', 'helt', 'rätt', 'sent', 'tidigt', 'kort']);

const PARTICLES = ['ju', 'väl', 'nog', 'ändå', 'visst', 'liksom', 'faktiskt', 'alltså'];
const COLLOQUIAL = ['nån', 'nåt', 'nåra', 'nånting', 'nånstans', 'sen', 'dom', 'mej', 'dej', 'sej', 'va', 'ba', 'typ', 'asså', 'okej', 'schysst', 'jättekul', 'supertöntigt'];

const EMOTIONS = wordsRe('glad|glada|gladare|ledsen|ledsna|rädd|rädda|arg|arga|nervös|nervösa|orolig|oroliga|lycklig|lyckliga|besviken|besvikna|förvånad|förvånade|upprörd|upprörda|generad|generade|stolt|stolta|avundsjuk|avundsjuka|ensam|ensamma|skräckslagen|förtvivlad|förtvivlade|sorgsen|lättad|lättade|exalterad|exalterade|frustrerad|frustrerade|irriterad|irriterade|skamsen|kände (?:sig|hur|en)|känner (?:sig|hur|en)|en känsla av|fylldes av');
const TELL_PHRASES = wordsRe('som om|plötsligt|i det ögonblicket|hjärtat (?:bultade|dunkade|slog|bankade)|tog ett djupt andetag|ett leende (?:spred sig|bredde ut sig)|himlade med ögonen|svalde (?:hårt|tungt)|ögonen vidgades|kunde inte låta bli|aldrig skulle glömma|för första gången på länge|magisk[a-zåäö]*');

// Vanliga verb i presens/preteritum för att se berättelsens tempus
const TENSE_PAIRS: [string, string[]][] = [
  ['säger', ['sa', 'sade']], ['är', ['var']], ['har', ['hade']], ['går', ['gick']], ['kommer', ['kom']],
  ['ser', ['såg']], ['tar', ['tog']], ['får', ['fick']], ['vet', ['visste']], ['tittar', ['tittade']],
  ['springer', ['sprang']], ['står', ['stod']], ['sitter', ['satt']], ['ligger', ['låg']], ['gör', ['gjorde']],
  ['blir', ['blev']], ['kan', ['kunde']], ['vill', ['ville']], ['ska', ['skulle']], ['tror', ['trodde']],
  ['tänker', ['tänkte']], ['känner', ['kände']], ['hör', ['hörde']], ['frågar', ['frågade']],
  ['svarar', ['svarade']], ['ropar', ['ropade']], ['skriker', ['skrek']], ['viskar', ['viskade']],
  ['hoppar', ['hoppade']], ['rusar', ['rusade']], ['ler', ['log']], ['nickar', ['nickade']],
];
const PRESENT = new Set(TENSE_PAIRS.map(([p]) => p));
const PAST = new Set(TENSE_PAIRS.flatMap(([, past]) => past));

const round = (n: number, d = 2) => (Number.isFinite(n) ? Math.round(n * 10 ** d) / 10 ** d : 0);
const per1000 = (count: number, words: number) => round((count / Math.max(1, words)) * 1000, 1);

function wordsOf(text: string): string[] {
  return text.match(WORD) ?? [];
}

function countMatches(text: string, re: RegExp): number {
  return Array.from(text.matchAll(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'))).length;
}

// Stycken: varje rad. Appens manus har ett stycke per rad och transkriberade
// böcker skrivs utan radbrytningar inuti stycken, så en repliks talstreck
// hamnar alltid först i sitt stycke.
export function paragraphsOf(text: string): string[] {
  return text.split('\n').map(l => l.trim()).filter(l => l && !HEADING.test(l));
}

export function sentencesOf(paragraph: string): string[] {
  return paragraph
    .split(new RegExp(`(?<=[.!?…])[”"»’]?\\s+(?=[–\\-”"»«“]?\\s*[${UPPER}0-9])`))
    .map(s => s.trim())
    .filter(s => wordsOf(s).length > 0);
}

// Repliker: citattecken (”...”, »...«) och talstreck först i stycket
function dialogueOf(paragraph: string): { replies: string[]; narration: string } {
  const replies: string[] = [];
  let narration = paragraph;
  if (/^[–—-]\s/.test(paragraph)) {
    // Talstreck: varje "– " inleder en replik, anföringen efter kommatecken räknas som berättartext
    const parts = paragraph.split(/(?:^|\s)[–—-]\s/).filter(Boolean);
    const narr: string[] = [];
    for (const part of parts) {
      const m = part.match(new RegExp(`^(.*?[,!?…])\\s+((?:${SPEECH_VERBS.join('|')})(?![${L}]).*)$`, 'i'));
      if (!m) { replies.push(part); continue; }
      replies.push(m[1]);
      // "– Hej, sa hon. Har du sett barnen?" - efter anföringens punkt fortsätter repliken
      const tag = m[2].match(/^(.*?[.!?…])\s+(.+)$/);
      if (tag) { narr.push(tag[1]); replies.push(tag[2]); } else narr.push(m[2]);
    }
    return { replies, narration: narr.join(' ') };
  }
  const quoted = paragraph.match(/[”"“»«][^”"“»«]+[”"“»«]/g) ?? [];
  for (const q of quoted) {
    replies.push(q.slice(1, -1));
    narration = narration.replace(q, ' ');
  }
  return { replies, narration };
}

// ── Drag per stycke ──
export interface Mening {
  ord: number;
  slut: string; // sista skiljetecknet: . ! ? … eller tomt
  langa?: number; // ord med fler än 6 bokstäver (för LIX)
  start?: string; // första ordet, gemener (för upprepade meningsstarter)
}

export interface StyckeDrag {
  meningar: Mening[];
  repliker?: number; // antal repliker i stycket
  replikOrd?: number; // ord inne i repliker (utan anföringen)
  markor?: 'dash' | 'quotes' | null; // hur replikerna markeras
  anforingar?: string[]; // anföringsverb direkt efter repliker, t.ex. ["säger"]
  anforingAdverb?: number; // "sa hon glatt"
  smaord?: string[]; // ju, väl, nog, ändå, visst, liksom, faktiskt, alltså (en post per förekomst)
  talsprak?: string[]; // nån, nåt, sen, dom, ba, typ, okej ... (en post per förekomst)
  kanslo?: number; // utpekade känslor i berättartexten (glad, rädd, arg, "kände sig" ...)
  versaler?: number; // ord i VERSALER
  kursiv?: number; // kursiverade ord eller fraser
  trePunkter?: number;
  klyschor?: number; // "som om", "plötsligt", "hjärtat bultade" ...
  aiTecken?: number; // långa tankstreck, tankstreck mitt i meningar, "Först ... sedan", tre led
  presens?: number; // vanliga verb i presens i berättartexten
  preteritum?: number;
  jagVi?: number; // jag/vi i berättartexten
  du?: number; // du/dig till läsaren i berättartexten
}

const STRUCTURAL_TELLS = [/[—―]/g, /[^\n\s]\s+–\s+[a-zåäö]/g, /(?<![a-zåäö])Först(?![a-zåäö])[^.]{0,80}[.,]\s*(och\s+)?[Ss]edan(?![a-zåäö])/g, /(?<![a-zåäö])den \S+, den \S+,? (och )?den(?![a-zåäö])/gi];

// Gör om en text till drag - för appens egna texter och för att jämföra med förlagorna
export function featuresOf(text: string): StyckeDrag[] {
  return paragraphsOf(text).map(p => {
    const d = dialogueOf(p);
    const narrationWords = wordsOf(d.narration).map(w => w.toLowerCase());
    const words = wordsOf(p).map(w => w.toLowerCase());
    const tagRe = new RegExp(`(?:,|[!?…][”"»]?|[”"»],?)\\s+(${SPEECH_VERBS.join('|')})(?![${L}])(?:\\s+([${L}]+))?(?:\\s+([a-zß-öø-ÿ]+))?`, 'gi');
    const anforingar: string[] = [];
    let anforingAdverb = 0;
    for (const m of Array.from(p.matchAll(tagRe))) {
      anforingar.push(m[1].toLowerCase());
      const adv = (m[3] ?? '').toLowerCase();
      if (adv && !NOT_ADVERB.has(adv) && /(igt|ligt|samt|öst|gt|nt|tt|rt|bt|st|at)$/.test(adv)) anforingAdverb++;
    }
    return {
      meningar: sentencesOf(p).map(sentence => {
        const w = wordsOf(sentence);
        return {
          ord: w.length,
          slut: (sentence.replace(/[”"»’\s]+$/, '').match(/[.!?…]$/) ?? [''])[0],
          langa: w.filter(x => x.replace(/[-'’]/g, '').length > 6).length,
          start: (w[0] ?? '').toLowerCase(),
        };
      }).filter(m => m.ord > 0),
      repliker: d.replies.length,
      replikOrd: d.replies.reduce((a, r) => a + wordsOf(r).length, 0),
      markor: d.replies.length === 0 ? null : /^[–—-]\s/.test(p) ? 'dash' : 'quotes',
      anforingar,
      anforingAdverb,
      smaord: words.filter(w => PARTICLES.includes(w)),
      talsprak: words.filter(w => COLLOQUIAL.includes(w)),
      kanslo: countMatches(d.narration, EMOTIONS),
      versaler: (p.match(new RegExp(`(?<![${L}])[${UPPER}]{2,}(?![${L}])`, 'g')) ?? []).filter(w => !/^[IVXLC]+$/.test(w)).length,
      kursiv: countMatches(p, /_[^_\n]+_/g),
      trePunkter: countMatches(p, /…|\.\.\./g),
      klyschor: countMatches(p, TELL_PHRASES),
      aiTecken: STRUCTURAL_TELLS.reduce((a, re) => a + countMatches(p, re), 0),
      presens: narrationWords.filter(w => PRESENT.has(w)).length,
      preteritum: narrationWords.filter(w => PAST.has(w)).length,
      jagVi: narrationWords.filter(w => /^(jag|mig|mej|vi|oss|min|mitt|mina|vår|vårt|våra)$/.test(w)).length,
      du: narrationWords.filter(w => /^(du|dig|dej|din|ditt|dina)$/.test(w)).length,
    };
  });
}

const sum = (list: number[]) => list.reduce((a, b) => a + b, 0);
function tally(list: string[]): { word: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const w of list) counts.set(w.toLowerCase(), (counts.get(w.toLowerCase()) ?? 0) + 1);
  return Array.from(counts, ([word, count]) => ({ word, count })).sort((a, b) => b.count - a.count);
}

export function fingerprintFromFeatures(drag: StyckeDrag[]): TextFingerprint {
  const sentences = drag.flatMap(d => d.meningar).filter(m => m.ord > 0);
  const lengths = sentences.map(m => m.ord);
  const words = sum(lengths);
  const n = Math.max(1, words);
  const mean = words / Math.max(1, lengths.length);
  const sd = Math.sqrt(lengths.reduce((a, l) => a + (l - mean) ** 2, 0) / Math.max(1, lengths.length));
  const sorted = [...lengths].sort((a, b) => a - b);
  const replies = sum(drag.map(d => d.repliker ?? 0));
  const replyWords = sum(drag.map(d => d.replikOrd ?? 0));
  const narrationWords = Math.max(1, words - replyWords);
  const markers = drag.map(d => d.markor).filter(Boolean);
  const dashes = markers.filter(m => m === 'dash').length;
  const quotes = markers.filter(m => m === 'quotes').length;
  const speechTags = tally(drag.flatMap(d => d.anforingar ?? [])).map(t => ({ verb: t.word, count: t.count }));
  const tagTotal = sum(speechTags.map(t => t.count));
  const present = sum(drag.map(d => d.presens ?? 0));
  const past = sum(drag.map(d => d.preteritum ?? 0));
  const particles = tally(drag.flatMap(d => d.smaord ?? []));
  const starts = sentences.map(m => m.start ?? '');
  const sameStart = starts.filter((w, i) => i > 0 && w && w === starts[i - 1]).length;
  const longWords = sum(sentences.map(m => m.langa ?? 0));

  return {
    words,
    sentences: sentences.length,
    paragraphs: drag.length,
    sentenceMean: round(mean, 1),
    sentenceMedian: sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0,
    sentenceVariation: round(sd / Math.max(1, mean)),
    shortSentenceShare: round(lengths.filter(l => l <= 5).length / Math.max(1, lengths.length)),
    longSentenceShare: round(lengths.filter(l => l >= 20).length / Math.max(1, lengths.length)),
    paragraphMeanSentences: round(sentences.length / Math.max(1, drag.length), 1),
    lix: round(words / Math.max(1, sentences.length) + (longWords * 100) / n, 1),
    sentenceStartRepeat: round(sameStart / Math.max(1, sentences.length)),
    dialogueShare: round(replyWords / n),
    repliesPer1000: per1000(replies, n),
    replyMeanWords: round(replyWords / Math.max(1, replies), 1),
    dialogueMarker: replies === 0 ? 'none' : quotes > dashes * 2 ? 'quotes' : dashes > quotes * 2 ? 'dash' : 'mixed',
    speechTags,
    saidShare: round(speechTags.filter(t => SAID.has(t.verb)).reduce((a, t) => a + t.count, 0) / Math.max(1, tagTotal)),
    adverbTagsPer1000: per1000(sum(drag.map(d => d.anforingAdverb ?? 0)), n),
    presentTenseShare: round(present / Math.max(1, present + past)),
    firstPersonPer1000: per1000(sum(drag.map(d => d.jagVi ?? 0)), narrationWords),
    readerAddressPer1000: per1000(sum(drag.map(d => d.du ?? 0)), narrationWords),
    particlesPer1000: per1000(sum(particles.map(p => p.count)), n),
    particles,
    colloquialPer1000: per1000(drag.flatMap(d => d.talsprak ?? []).length, n),
    questionsPer100Sentences: round((sentences.filter(m => m.slut === '?').length / Math.max(1, sentences.length)) * 100, 1),
    exclamationsPer100Sentences: round((sentences.filter(m => m.slut === '!').length / Math.max(1, sentences.length)) * 100, 1),
    ellipsesPer1000: per1000(sum(drag.map(d => d.trePunkter ?? 0)), n),
    capsWordsPer1000: per1000(sum(drag.map(d => d.versaler ?? 0)), n),
    emphasisPer1000: per1000(sum(drag.map(d => d.kursiv ?? 0)), n),
    namedEmotionsPer1000: per1000(sum(drag.map(d => d.kanslo ?? 0)), narrationWords),
    tellPhrasesPer1000: per1000(sum(drag.map(d => d.klyschor ?? 0)), n),
    aiTellsPer1000: per1000(sum(drag.map(d => d.aiTecken ?? 0)), n),
  };
}

export function fingerprint(text: string): TextFingerprint {
  return fingerprintFromFeatures(featuresOf(text));
}

// ── Jämförelse: vilka mått skiljer mest mellan en referens och en text ──
export const FINGERPRINT_LABELS: Partial<Record<keyof TextFingerprint, string>> = {
  sentenceMean: 'Ord per mening',
  sentenceVariation: 'Variation i meningslängd',
  shortSentenceShare: 'Andel korta meningar (≤5 ord)',
  longSentenceShare: 'Andel långa meningar (≥20 ord)',
  paragraphMeanSentences: 'Meningar per stycke',
  lix: 'LIX (läsbarhet)',
  sentenceStartRepeat: 'Meningar som börjar med samma ord i rad',
  dialogueShare: 'Andel text i repliker',
  repliesPer1000: 'Repliker per 1000 ord',
  replyMeanWords: 'Ord per replik',
  saidShare: 'Andel anföringar med sa/säger',
  adverbTagsPer1000: '"sa hon glatt" per 1000 ord',
  presentTenseShare: 'Andel presens',
  firstPersonPer1000: 'Jag/vi i berättartexten per 1000 ord',
  readerAddressPer1000: 'Tilltal till läsaren per 1000 ord',
  particlesPer1000: 'Småord (ju, väl, nog, ändå ...) per 1000 ord',
  colloquialPer1000: 'Talspråk (nån, sen, typ ...) per 1000 ord',
  questionsPer100Sentences: 'Frågor per 100 meningar',
  exclamationsPer100Sentences: 'Utrop per 100 meningar',
  ellipsesPer1000: 'Tre punkter per 1000 ord',
  capsWordsPer1000: 'Ord i VERSALER per 1000 ord',
  emphasisPer1000: 'Kursiv betoning per 1000 ord',
  namedEmotionsPer1000: 'Utpekade känslor per 1000 ord',
  tellPhrasesPer1000: 'Klyschor ("som om", "plötsligt" ...) per 1000 ord',
  aiTellsPer1000: 'AI-tecken per 1000 ord',
};

export interface FingerprintGap {
  metric: keyof TextFingerprint;
  label: string;
  reference: number;
  candidate: number;
  // Hur många gånger större/mindre (log2) - 1 = dubbelt så mycket, -1 = hälften
  log2Ratio: number;
}

export function compareFingerprints(reference: TextFingerprint, candidate: TextFingerprint): FingerprintGap[] {
  return (Object.keys(FINGERPRINT_LABELS) as (keyof TextFingerprint)[])
    .map(metric => {
      const ref = Number(reference[metric]);
      const cand = Number(candidate[metric]);
      // Liten konstant så att 0 mot 0,5 inte blir oändligt
      const eps = metric.endsWith('Share') || metric === 'sentenceVariation' || metric === 'sentenceStartRepeat' ? 0.02 : 0.5;
      return { metric, label: FINGERPRINT_LABELS[metric]!, reference: ref, candidate: cand, log2Ratio: round(Math.log2((cand + eps) / (ref + eps))) };
    })
    .sort((a, b) => Math.abs(b.log2Ratio) - Math.abs(a.log2Ratio));
}

// Medelvärde av flera fingeravtryck (t.ex. alla referensböcker i en boktyp)
export function averageFingerprint(list: TextFingerprint[]): TextFingerprint {
  const out = { ...list[0] } as unknown as Record<string, unknown>;
  for (const key of Object.keys(out)) {
    const values = list.map(f => (f as unknown as Record<string, unknown>)[key]);
    if (values.every(v => typeof v === 'number')) {
      const nums = values as number[];
      out[key] = round(nums.reduce((a, b) => a + b, 0) / nums.length, 2);
    }
  }
  return out as unknown as TextFingerprint;
}
