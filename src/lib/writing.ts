// Gemensam skrivkärna för all text som AI:n skriver: regler mot "AI-text",
// variation mellan genereringar och en städning som tar bort typiska AI-tecken.
// Ingen serverkod här - läsaren/klienten använder också findAiTells().

// ── Regler som läggs i varje skrivprompt ──
export const PROSE_QUALITY_RULES = `SÅ SKA TEXTEN KÄNNAS
Som en riktig svensk barnboksförfattare har skrivit den: levande, konkret, lite egen. Aldrig stolpig, aldrig "AI-text".
- Konkreta vardagsdetaljer framför allmänna beskrivningar (märket på flingpaketet, en obäddad säng, ett skoskav).
- Känslor i kroppen och i handlingar ("det knyter sig i magen"), inte uppräknade känsloord.
- Repliker som låter som när folk faktiskt pratar: korta, avbrutna, ibland fel.
- Variera meningslängd på riktigt. Låt vissa stycken vara vanliga och odramatiska.

FÖRBJUDET (typiska AI-tecken)
- Långa tankstreck (—) och tankstreck mitt i meningar. Skriv om med punkt eller komma. Talstreck först i en replik är okej.
- Kaskader som "Först ... Sedan ... Och sedan ..." och uppräkningar i tre led ("den grunda, den lugna, den tysta").
- Mer än en "som om"-liknelse per sida, och staplade metaforer.
- Enordsstycken för dramatik ("Knarr." "Tystnad.") mer än någon enstaka gång i hela texten.
- Att avsluta varje scen eller kapitel med en olycksbådande enradare.
- Pekpinnar, sammanfattande moral och fraser som "ett äventyr de aldrig skulle glömma", "hjärtat bultade", "plötsligt" om och om igen.
- Ordet "magisk" och liknande tomma förstärkningsord.`;

// Vanliga standardval som gör att olika böcker blir likadana
const OVERUSED_DEFAULTS = [
  'namnen Vega, Sigge, Luna, Elsa, Leo, Alva, Nora, Ester, Doris, Rune, Bengt, Vide, Signe',
  'farmor i kofta som bakar kanelbullar',
  'glasögon som glider ner på näsan',
  'en båt som luktar diesel',
  'en katt som sover på trappan',
  'ett vindsfönster med ett ljus',
];

const GIVEN_NAMES = [
  'Ines', 'Majken', 'Tuva', 'Selma', 'Juni', 'Hedda', 'Lovisa', 'Amina', 'Stina', 'Freja', 'Nelly', 'Siri', 'Ronja', 'Tyra',
  'Minna', 'Edith', 'Leia', 'Yara', 'Hanna', 'Iris', 'Märta', 'Rut', 'Klara', 'Dagny', 'Noor', 'Svea', 'Lea', 'Tilde',
  'Ebba', 'Signhild', 'Greta', 'Liv', 'Moa', 'Filippa', 'Zara', 'Maja-Li', 'Ester-Lo', 'Idun', 'Vilja', 'Sanna', 'Hilma',
  'Nova', 'Lykke', 'Mira', 'Sara', 'Ayla', 'Wilma', 'Lin', 'Emmy', 'Asta', 'Doris-Mae', 'Jasmin', 'Elina', 'Frida', 'Sofi',
  'Malte', 'Ture', 'Hugo', 'Elis', 'Kasim', 'Bruno', 'Otto', 'Aron', 'Nils', 'Isak', 'Melker', 'Loke', 'Viggo', 'Samir',
  'Tage', 'Colin', 'Axel', 'Harald', 'Jonatan', 'Emil', 'Folke', 'Ivar', 'Milo', 'Adam', 'Gustav', 'Lukas', 'Frans', 'Omar',
  'Albin', 'Sixten', 'Knut', 'Ludvig', 'Ali', 'Teo', 'Vidar', 'Arvid', 'Edvin', 'Hampus', 'Noel', 'Olle', 'Ragnar', 'Yusuf',
  'Mio', 'Birk', 'Enzo', 'Idris', 'Julian', 'Levi', 'Matteo', 'Otis', 'Rasmus', 'Svante', 'Tim', 'Valter', 'Wilgot', 'Zakaria',
  'Kim', 'Robin', 'Alex', 'Charlie', 'Sam', 'Love', 'Nour', 'Eli', 'Juno', 'Ariel',
];
const ADULT_NAMES = [
  'Gunnel', 'Birgitta', 'Ulla', 'Margit', 'Lena', 'Anneli', 'Pia', 'Maud', 'Kerstin', 'Yvonne', 'Farida', 'Gun',
  'Agneta', 'Britt', 'Carina', 'Eivor', 'Helena', 'Inger', 'Jessica', 'Katarina', 'Lotta', 'Marianne', 'Nadia', 'Petra',
  'Ronja-Britt', 'Susanne', 'Tove', 'Viveka', 'Åsa', 'Zeynep', 'Mona', 'Solveig', 'Hayat', 'Therese', 'Camilla', 'Ingela',
  'Lasse', 'Göran', 'Kent', 'Arne', 'Bosse', 'Stig', 'Håkan', 'Mats', 'Reza', 'Ulf', 'Tomas', 'Leif',
  'Anders', 'Bengt-Åke', 'Christer', 'Dragan', 'Erik', 'Fredrik', 'Gösta', 'Hassan', 'Ingvar', 'Jörgen', 'Kjell', 'Lennart',
  'Magnus', 'Nisse', 'Olof', 'Peter', 'Roger', 'Sven-Erik', 'Torbjörn', 'Urban', 'Yngve', 'Janne', 'Mehmet', 'Pontus',
];
const OPENING_APPROACHES = [
  'mitt i en replik, utan presentation',
  'med en vardaglig syssla som går lite fel',
  'med ett ljud eller en lukt i huvudpersonens närhet',
  'med något huvudpersonen vet men inte har berättat för någon',
  'med en detalj som inte stämmer, utan att förklara den',
  'med huvudpersonen mitt uppe i något hen är riktigt dålig på',
  'med en regel eller ett löfte som huvudpersonen snart kommer att bryta',
  'en stund efter att något redan har hänt, som läsaren får pussla ihop',
];

function shuffle<T>(list: T[]): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Slumpat variationsblock: namnförslag, öppningsgrepp och standardval att undvika
export function variationBlock(options: { names?: boolean; opening?: boolean } = { names: true, opening: true }): string {
  const lines = ['VARIATION (varje bok ska bli unik)'];
  if (options.names !== false) {
    // Exakta namn i stället för en lista - annars väljer modellen samma favoriter varje gång
    const [kid1, kid2] = shuffle(GIVEN_NAMES);
    const [adult1, adult2] = shuffle(ADULT_NAMES);
    lines.push(`- Behöver du hitta på namn: huvudpersonen heter ${kid1}. Fler barn: ${kid2}. Vuxna: ${adult1}, ${adult2}. Hitta bara på andra namn om fler figurer behövs, och undvik de vanligaste barnboksnamnen.`);
  }
  if (options.opening !== false) {
    lines.push(`- Förslag på öppning: ${OPENING_APPROACHES[Math.floor(Math.random() * OPENING_APPROACHES.length)]}.`);
  }
  lines.push(`- Undvik standardval som gör alla böcker lika: ${OVERUSED_DEFAULTS.join('; ')}.`);
  return lines.join('\n');
}

// ── Städning: ta bort AI-tecken som ändå slinker igenom ──
// Kapitelrubriker ("Kapitel 2 – Titel") får behålla sitt streck
const HEADING_LINE = /^\s*(kapitel\s+\S+|prolog|epilog|inledning|förord|efterord)\b/i;

export function sanitizeProse(text: string): string {
  return text
    .split('\n')
    .map(line => {
      // Talstreck först i raden är bokkonvention
      let out = line.replace(/^(\s*)[—―]\s*/, '$1– ');
      // Långt tankstreck mitt i en mening blir komma
      out = out.replace(/(\S)\s*[—―]\s*/g, '$1, ');
      // Tankstreck med mellanslag mitt i en mening (inte talstreck, inte "3–6 år", inte rubriker)
      if (!HEADING_LINE.test(out)) out = out.replace(/(\S)\s+–\s+(?=\S)/g, '$1, ');
      return out
        .replace(/,\s*,/g, ',')
        .replace(/,\s*([.!?])/g, '$1');
    })
    .join('\n');
}

// ── Granskning: hitta AI-tecken i en text (visas för författaren) ──
export interface AiTell {
  id: string;
  label: string;
  count: number;
  examples: string[];
}

export function findAiTells(text: string): AiTell[] {
  const tells: AiTell[] = [];
  const words = Math.max(1, text.split(/\s+/).filter(Boolean).length);
  const add = (id: string, label: string, matches: string[], threshold = 1) => {
    if (matches.length >= threshold) tells.push({ id, label, count: matches.length, examples: matches.slice(0, 3) });
  };
  const sentenceAround = (re: RegExp) => Array.from(text.matchAll(re)).map(m => {
    const start = Math.max(0, (m.index ?? 0) - 40);
    return text.slice(start, (m.index ?? 0) + m[0].length + 40).replace(/\s+/g, ' ').trim();
  });

  add('emdash', 'Långa tankstreck (—)', sentenceAround(/[—―]/g));
  // Tankstreck mitt i en mening (inte replikstreck först i raden)
  add('midDash', 'Tankstreck mitt i meningar', sentenceAround(/[^\n\s]\s+–\s+[a-zåäö]/g), Math.max(2, Math.round(words / 400)));
  add('somOm', 'Många "som om"-liknelser', sentenceAround(/\bsom om\b/gi), Math.max(3, Math.round(words / 250)));
  add('cascade', '"Först ... sedan ... och sedan"', sentenceAround(/\bFörst\b[^.]{0,80}[.,]\s*(och\s+)?[Ss]edan\b/g));
  add('triple', 'Uppräkningar i tre led', sentenceAround(/\bden \w+, den \w+,? (och )?den\b/gi));
  add('plotsligt', 'Många "plötsligt"', sentenceAround(/\bplötsligt\b/gi), 3);
  add('cliche', 'Klyschor', sentenceAround(/\b(magisk\w*|hjärtat bultade|ett äventyr (hon|han|de) aldrig|aldrig skulle glömma|i det ögonblicket)\b/gi));
  const oneWord = text.split('\n').map(l => l.trim()).filter(l => /^[A-ZÅÄÖ][\wåäö-]*[.!]$/.test(l));
  add('oneWord', 'Dramatiska enordsstycken', oneWord, 3);
  return tells;
}
