import Anthropic from '@anthropic-ai/sdk';
import { BookFormat } from './types';

export type TextDensity = 'minimal' | 'lite' | 'medium' | 'mycket';

export interface BookConfig {
  title: string;
  bookFormat: BookFormat;
  numCharacters: number;
  characterNames: string[]; // empty = auto-generate
  numPages: number;
  targetAge: string;
  plot: string; // handling/story tags
  setting: string; // miljo
  imageStyle: string; // format bilder
  subject?: string; // for larobok (e.g. "matematik")
  textDensity: TextDensity;
}

function getClient() {
  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) throw new Error('CLAUDE_API_KEY saknas i .env.local');
  return new Anthropic({ apiKey });
}

function getFormatDescription(format: BookConfig['bookFormat']): string {
  switch (format) {
    case 'bildbok-text-pa-bild':
      return `Bildbok med text PÅ bilderna (liknande "Handbok för Superhjältar").
Bokformat: 16×21 cm (bred × hög). Varje uppslag (2 sidor) har en helsides-illustration med texten integrerad i bilden.
Texten placeras i textrutor ovanpå illustrationen.
Ca 50-100 ord per sida (100-200 ord per uppslag). Visuellt berättande med integrerad text.`;
    case 'bildbok-separat-text':
      return `Bildbok med separat text (liknande "Luna"-böcker).
Bokformat: 16×21 cm (bred × hög). Varannan sida har illustration, varannan har text. Eller text ovanför/under bilden.
Ca 100-200 ord per textsida (en fullsida med text har ca 180 ord). Bild och text kompletterar varandra.
Typiskt 10 kapitel i en bok på ~96 sidor.`;
    case 'kapitelbok':
      return `Kapitelbok med mycket text (liknande Harry Potter / Bert-böcker).
Mest text med enstaka illustrationer. Längre berättande stycken.
Ca 200-300 ord per sida (400-600 ord per uppslag). Detaljerade beskrivningar och dialoger.
Rikare berättande med karaktärsutveckling och spänningskurva.`;
    case 'larobok':
      return `Lärobok/aktivitetsbok (liknande "Ärtan, Pärtan" eller Matteböcker).
Bokformat: 16×21 cm. Blandning av text, bilder och uppgifter/övningar.
Ca 60-150 ord per sida. Instruktioner, förklaringar och interaktiva element.
Pedagogiskt upplägg med tydlig progression.`;
  }
}

function getFormatTemplate(format: BookConfig['bookFormat']): string {
  switch (format) {
    case 'bildbok-text-pa-bild':
      return `Varje uppslag ska ha:
- 1-3 textblock med position (t.ex. "Text (sida X - textruta överst):", "Text (sida Y - textruta nedre):")
- BILDPROMPT som beskriver en helsides-illustration där texten ska integreras
- Kort, kärnfull text som barn kan läsa själva
- Bildprompten ska inkludera var texten ska placeras i bilden`;
    case 'bildbok-separat-text':
      return `Varje uppslag ska ha:
- 1-2 längre textblock med position
- BILDPROMPT som beskriver illustrationen (utan text i bilden)
- Texten berättar mer detaljer, bilden visar scenen
- Mer berättande text med beskrivningar`;
    case 'kapitelbok':
      return `Varje uppslag ska ha:
- 1-2 långa textblock med berättande text, dialoger, beskrivningar
- BILDPROMPT som beskriver en enklare illustration (inte varje sida behöver detaljerad bild)
- Fokus på textberättande med stödjande bilder`;
    case 'larobok':
      return `Varje uppslag ska ha:
- Textblock med instruktioner, förklaringar eller uppgifter
- BILDPROMPT som beskriver pedagogiska illustrationer, diagram eller figurer
- Blandning av lärandeinnehåll och övningar
- Tydlig progression i svårighetsgrad`;
  }
}

function getTextDensityDescription(density: TextDensity, format: BookConfig['bookFormat']): string {
  // Format-specific word counts based on real book data
  const wordRanges: Record<BookConfig['bookFormat'], Record<TextDensity, { perPage: string; perSpread: string; desc: string }>> = {
    'bildbok-text-pa-bild': {
      'minimal': { perPage: '15-30', perSpread: '30-60', desc: 'Mycket kort text integrerad i bilden. 1-2 meningar per textruta. Bilden berättar mest.' },
      'lite': { perPage: '30-50', perSpread: '60-100', desc: 'Kort text i textrutor på bilden. 2-3 meningar per textruta. Visuellt berättande dominerar.' },
      'medium': { perPage: '50-80', perSpread: '100-160', desc: 'Lagom mängd text integrerad i bilden. 3-5 meningar per textruta. Balans mellan text och bild.' },
      'mycket': { perPage: '80-120', perSpread: '160-240', desc: 'Riklig text i bilden, liknande Handbok för Superhjältar. 4-6 meningar per textruta, fler textrutor per uppslag.' },
    },
    'bildbok-separat-text': {
      'minimal': { perPage: '30-60', perSpread: '30-60', desc: 'Kort text på textsidan. 2-4 meningar. Bilderna dominerar berättelsen.' },
      'lite': { perPage: '60-100', perSpread: '60-100', desc: 'Enkel, lättläst text. 4-6 meningar per textsida. God balans bild/text.' },
      'medium': { perPage: '100-160', perSpread: '100-160', desc: 'Typisk Luna-bok textmängd. 6-10 meningar per textsida (~150 ord). Berättande text med detaljer.' },
      'mycket': { perPage: '160-220', perSpread: '160-220', desc: 'Mycket text per sida, upp mot 180-200 ord på textsidan. Riklig berättelse med dialoger och beskrivningar.' },
    },
    'kapitelbok': {
      'minimal': { perPage: '100-150', perSpread: '200-300', desc: 'Kortare stycken, mer luftig text. Enklare språk, korta meningar. Passar yngre läsare.' },
      'lite': { perPage: '150-200', perSpread: '300-400', desc: 'Lagom textmängd med tydliga stycken. Medellånga meningar och dialoger.' },
      'medium': { perPage: '200-280', perSpread: '400-560', desc: 'Typisk kapitelbok-textmängd. Detaljerade beskrivningar, dialoger och berättande. ~250 ord per sida.' },
      'mycket': { perPage: '280-350', perSpread: '560-700', desc: 'Riklig text som Harry Potter. Långa stycken, utförliga beskrivningar, komplex berättelse. ~300+ ord per sida.' },
    },
    'larobok': {
      'minimal': { perPage: '30-60', perSpread: '60-120', desc: 'Korta instruktioner och enkla övningar. Mest bilder och aktiviteter.' },
      'lite': { perPage: '60-100', perSpread: '120-200', desc: 'Tydliga förklaringar med övningar. Lagom text med visuellt stöd.' },
      'medium': { perPage: '100-150', perSpread: '200-300', desc: 'Utförligare förklaringar och fler övningar. Blandning av text och aktiviteter.' },
      'mycket': { perPage: '150-200', perSpread: '300-400', desc: 'Detaljerade förklaringar, exempel och uppgifter. Mer text, pedagogiskt djup.' },
    },
  };

  const range = wordRanges[format][density];
  const densityLabel = { 'minimal': 'MINIMAL', 'lite': 'LITE', 'medium': 'MEDIUM', 'mycket': 'MYCKET' }[density];

  return `${densityLabel} text - ca ${range.perPage} ord per sida (${range.perSpread} ord per uppslag).
${range.desc}`;
}

export async function generateBookContent(config: BookConfig): Promise<string> {
  const client = getClient();

  const numSpreads = Math.ceil(config.numPages / 2);
  const formatDesc = getFormatDescription(config.bookFormat);
  const formatTemplate = getFormatTemplate(config.bookFormat);

  const characterInstructions = config.characterNames.length > 0
    ? `Använd dessa karaktärsnamn: ${config.characterNames.join(', ')}. Skapa detaljerade beskrivningar för varje karaktär.`
    : `Skapa ${config.numCharacters} unika karaktärer med svenska namn. Ge varje karaktär ett unikt utseende, personlighet och bakgrund.`;

  const textDensityDesc = getTextDensityDescription(config.textDensity, config.bookFormat);

  const prompt = `Du är en erfaren barnboksförfattare. Skapa en komplett barnbok på SVENSKA.

BOKENS GRUNDDATA:
- Titel: "${config.title}"
- Målålder: ${config.targetAge}
- Antal sidor: ${config.numPages} (= ${numSpreads} uppslag)
- Antal karaktärer: ${config.numCharacters}
${config.subject ? `- Ämne: ${config.subject}` : ''}

HANDLING/TEMA: ${config.plot}
MILJÖ: ${config.setting}

TEXTMÄNGD PER SIDA:
${textDensityDesc}

BOKFORMAT:
${formatDesc}

${formatTemplate}

BILDSTIL: ${config.imageStyle}

KARAKTÄRER:
${characterInstructions}

---

Skapa HELA boken i EXAKT detta format (det är viktigt att formatet följs exakt):

Titel: ${config.title}

KARAKTÄRER

* [Karaktärsnamn] - [ålder], [kort beskrivning]
Utseende: [detaljerad beskrivning av utseende - hårfärg, ögonfärg, kroppsbyggnad, speciella drag]
Vanliga kläder: [vad karaktären brukar ha på sig]
Personlighet: [personlighetsdrag]
${config.bookFormat === 'bildbok-text-pa-bild' ? 'Superhjältedräkt: [om relevant]' : ''}

(Upprepa för varje karaktär)

KAPITEL 1: [KAPITELNAMN]

SIDA 6-7 (Uppslag 1)

Text (sida 6 - textruta överst):
[Text här]

Text (sida 7 - textruta nedre):
[Text här]

BILDPROMPT - SIDA 6-7:
[Detaljerad bildprompt på ENGELSKA som beskriver illustrationen. Inkludera stil, komposition, karaktärernas positioner, bakgrund, belysning, stämning. Skriv alltid bildprompten på engelska.]

(Fortsätt med alla ${numSpreads} uppslag)

SLUTSIDA

Text (sida ${config.numPages}):
[Avslutande text]

BILDPROMPT - SIDA ${config.numPages}:
[Avslutande illustration]

---

VIKTIGA REGLER:
1. Skriv ALL berättande text på SVENSKA
2. Skriv ALLA bildpromptar på ENGELSKA
3. Följ formatet EXAKT - parsern behöver "SIDA X-Y (Uppslag N)", "Text (sida X):", och "BILDPROMPT - SIDA X-Y:"
4. Skapa ALLA ${numSpreads} uppslag - hoppa inte över några
5. Varje kapitel ska ha en KAPITEL-rubrik
6. Sidor börjar på 6-7 (sida 1-5 är titel/copyright etc.)
7. Gör berättelsen engagerande, åldersanpassad och med en tydlig dramaturgi
8. Varje bildprompt ska vara detaljerad (minst 3-4 meningar) och inkludera stilen: ${config.imageStyle}
9. Karaktärsbeskrivningarna ska vara tillräckligt detaljerade för att kunna generera konsekventa bilder
10. ${config.bookFormat === 'bildbok-text-pa-bild' ? 'Inkludera i bildprompten var texten ska placeras (t.ex. "text box in upper left", "speech bubble")' : 'Bildprompten ska INTE inkludera text i bilden'}`;

  const message = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 16000,
    messages: [
      {
        role: 'user',
        content: prompt,
      },
    ],
  });

  // Extract text content
  const textContent = message.content.find(c => c.type === 'text');
  if (!textContent || textContent.type !== 'text') {
    throw new Error('Inget textinnehåll i svaret från Claude');
  }

  return textContent.text;
}
