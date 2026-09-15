// Idémotor: slumpar ihop berättelsens byggstenar ur stora pooler så att
// böckerna inte drar mot samma "mysiga svenska mysterium" varje gång.
// Varje boktyp har egna viktningar - Knyckertz blir busig, Mamma Mu vardaglig.

export interface StorySeeds {
  engine: string; // vilken sorts berättelse
  place: string;
  tone: string;
  // Två slumpade detaljer ur uppbyggnad, livssituation, gnista, insats och vinkel.
  // Fler än så gjorde att AI:n bockade av alla och böckerna fick samma formler.
  extras: { label: string; text: string }[];
}

type Tag = 'humor' | 'spanning' | 'kansla' | 'fantasi' | 'vardag' | 'action' | 'enkel' | 'djur';

interface Weighted { text: string; tags: Tag[] }

const w = (text: string, ...tags: Tag[]): Weighted => ({ text, tags });

const ENGINES: Weighted[] = [
  w('vardagskomik där något litet växer till kaos', 'humor', 'vardag', 'enkel'),
  w('mysterium som löses med vardagslogik', 'spanning'),
  w('äventyr långt hemifrån', 'spanning', 'action', 'fantasi'),
  w('fantasi där något omöjligt händer mitt i vardagen', 'fantasi', 'vardag'),
  w('vänskapsberättelse om att bli sams igen', 'kansla', 'vardag'),
  w('tävling eller uppvisning som går snett', 'humor', 'action'),
  w('resa dit och hem igen', 'spanning', 'enkel'),
  w('absurd och tokig berättelse med egen logik', 'humor', 'fantasi'),
  w('berättelse om ett djur och ett barn', 'djur', 'kansla', 'enkel'),
  w('att våga något man är rädd för', 'kansla', 'action'),
  w('varsam berättelse om saknad efter någon', 'kansla'),
  w('uppfinnarberättelse där en idé får oväntade följder', 'humor', 'fantasi'),
  w('kupp eller finurlig plan som ska genomföras', 'humor', 'spanning', 'action'),
  w('superhjälteuppdrag med vardagliga problem', 'action', 'humor'),
  w('berättelse om att rätta till en orättvisa', 'kansla', 'action'),
  w('berättelse om en förändring i familjen', 'kansla', 'vardag'),
  w('sökande efter något borttappat', 'spanning', 'enkel', 'vardag'),
  w('berättelse där barnet måste ta hand om någon annan', 'kansla', 'vardag'),
  w('lugn upptäcktsfärd i naturen', 'djur', 'enkel'),
  w('kumulativ saga där samma sak upprepas och växer', 'enkel', 'humor'),
];

const STRUCTURES = [
  'en enda dag från frukost till läggdags',
  'en nedräkning mot något som måste bli klart',
  'en regel som bryts i början och får följder',
  'ett missförstånd som blir större för varje kapitel',
  'två perspektiv som möts på slutet',
  'en jakt i flera steg där varje steg ger en ledtråd',
  'fisk på torra land: huvudpersonen hamnar någonstans där hen inte hör hemma',
  'ett rollbyte där någon tvingas vara någon annan en tid',
  'en hemlighet som måste bevaras från fel personer',
  'upprepning med variation, där tredje försöket blir annorlunda',
  'en lista eller ett uppdrag som ska bockas av',
  'resan dit och hem, där hemmet ser annorlunda ut efteråt',
];

const FAMILIES = [
  'bor med pappa i en trea på fjärde våningen',
  'har två mammor och en lillebror som härmar allt',
  'är mitten av fem syskon och blir alltid bortglömd',
  'är enda barnet och har mest vuxna omkring sig',
  'har nyss flyttat till Sverige och lär sig språket',
  'bor på en gård där alla hjälps åt',
  'har en farfar som nyss flyttat in i gästrummet',
  'har fått en bonusbror som hen inte bett om',
  'har en mamma som jobbar natt och en pappa som somnar i soffan',
  'bor växelvis hos mamma och pappa, varannan vecka',
  'bor ovanför familjens pizzeria',
  'har en storasyster som plötsligt inte vill leka längre',
  'bor i en husbil hela sommaren',
  'har en morbror som är den enda vuxna som lyssnar',
];

const PLACES = [
  'tvättstugan i ett höghus', 'tunnelbanans sista station', 'en frisersalong', 'ett restaurangkök en fredagskväll',
  'fotbollsplanen när det regnar', 'en bensinmack på natten', 'ett växthus i januari', 'en snickarverkstad',
  'ett nattåg norrut', 'fritidsgården', 'ett äldreboende', 'en tandläkarmottagning', 'en möbelaffär som stänger',
  'innergården i en förort', 'ett fjällhotell i snöstorm', 'en skidbacke med trasig lift', 'en isbana på en frusen sjö',
  'hamnen när fiskebåtarna kommer in', 'en radiostation', 'en bilverkstad', 'en glassfabrik', 'ett gatukök',
  'en second hand-butik', 'flygplatsens hittegodsrum', 'taket på ett parkeringshus', 'en trädkoja som ingen får veta om',
  'förskolans gård på kvällen', 'ett tält i trädgården', 'en övergiven minigolfbana', 'ett stenbrott',
  'en myr med spänger', 'kyrkans kör på repetition', 'ett sjukhus väntrum', 'en cirkus som slår upp tältet',
  'ett bageri klockan fyra på morgonen', 'skolans matsal', 'en djuraffär', 'en hästgård', 'ett reningsverk',
  'en kolonilott i stan', 'en marknad med stånd från hela världen', 'ett tåg som stannat mitt i skogen',
  'en simskola', 'en tom villa som ska säljas', 'ett torg i en liten stad', 'en brandstation', 'ett bibliotek med bokbuss',
  'en fotbollsturnering i en annan stad', 'en bondgård med för många getter', 'en stuga utan el',
];

const SPARKS = [
  'ett brev som kommer tjugo år för sent', 'en hund som följer efter hem och inte vill gå', 'en tavla som ändrar sig på natten',
  'ett recept som inte fungerar utan en hemlig ingrediens', 'en borttappad mobil med ett konstigt meddelande',
  'en granne som alltid bär samma röda väska', 'mormors gamla kassettband', 'en tand som inte vill lossna',
  'en tävlingslott som vinner fel pris', 'ett ägg som börjar spricka', 'en snögubbe som flyttar sig',
  'ett fönster som bara syns från gatan', 'en teckning som någon annan ritat klart', 'ett husdjur som försvinner varje tisdag',
  'en skola som ska rivas', 'en cykel som hittas i sjön', 'en nyckel till en dörr som saknas', 'ett skoskav som är en ledtråd',
  'en inbjudan till en fest som ingen har hört talas om', 'en robotdammsugare som vägrar lyda', 'en papegoja som svär på finska',
  'ett felbokat hotellrum', 'en gammal kamera med en film kvar', 'en klassresa som ställs in', 'en pjäs där huvudrollen blir sjuk',
  'en fotboll som flög över muren', 'ett lotteri där alla vinner samma sak', 'en sten som är varm fast det är vinter',
  'ett ljud från ventilationen', 'en jättelik pumpa', 'en tvilling som byter plats för en dag', 'ett paket utan avsändare',
  'ett spår i snön som tar slut mitt på fältet', 'en läskig lärare som har en hemlighet', 'en bortsprungen get',
  'en regnbåge som inte försvinner', 'en borttappad teaterperuk', 'en hemlig tunnel under lekparken',
];

const STAKES = [
  'något måste lämnas tillbaka innan någon märker att det är borta',
  'en vän kommer att flytta om ingenting görs',
  'en fest måste räddas', 'ett löfte till en vuxen håller på att brytas',
  'någon annan får skulden för något huvudpersonen gjort', 'ett djur behöver hjälp innan natten',
  'huvudpersonen måste välja mellan två vänner', 'familjen riskerar att bli av med något de älskar',
  'en rekordtid eller ett mål som känns omöjligt', 'en lögn som växer och snart upptäcks',
];

const TONES: Record<Tag, string[]> = {
  humor: ['busig och snabb', 'torr och underfundig', 'tokig men varm'],
  spanning: ['spännande men trygg', 'lite läskig', 'nervig och kvick'],
  kansla: ['varm och nära', 'stillsam med humor i kanten', 'ärlig och modig'],
  fantasi: ['förundrad och lekfull', 'drömsk men konkret'],
  vardag: ['vardaglig och igenkännbar', 'lugn och mysig'],
  action: ['fartfylld', 'filmisk och pampig med självdistans'],
  enkel: ['lugn och rytmisk', 'enkel och lekfull'],
  djur: ['varm och nyfiken', 'lekfull'],
};

const TWISTS = [
  'huvudpersonen har fel om något viktigt från början',
  'det finns ingen skurk, bara ett problem',
  'en vuxen vet mer än hen säger men är inte farlig',
  'humorn kommer från en bifigur med en egen längtan',
  'det avgörande ögonblicket löses av något huvudpersonen är dålig på',
  'ett föremål återkommer i början, mitten och slutet',
  'huvudpersonen hjälps av någon hen inte gillar',
  'berättelsen börjar när det värsta redan har hänt',
  'en liten detalj från första sidan får betydelse på slutet',
  'en figur pratar alltid i frågor',
];

// Vilka slags berättelser som passar varje boktyp
const PRESET_TAGS: Record<string, Tag[]> = {
  knyckertz: ['humor', 'spanning', 'action'],
  handbok: ['action', 'humor', 'spanning'],
  luna: ['kansla', 'vardag', 'fantasi', 'spanning'],
  mammamu: ['vardag', 'enkel', 'djur', 'humor'],
  disney: ['fantasi', 'action', 'kansla', 'djur'],
  minimalistisk: ['enkel', 'djur', 'vardag'],
};

// Rotation: det som dragits nyligen dras inte igen förrän halva poolen har använts.
// Lever i serverns minne - räcker för att upprepade klick och parallella böcker skiljer sig.
const recentPicks = new Map<string, string[]>();

function rotate(category: string, list: string[], avoid: (item: string) => boolean = () => false): string {
  const recent = recentPicks.get(category) ?? [];
  const fresh = list.filter(x => !recent.includes(x) && !avoid(x));
  const source = fresh.length > 0 ? fresh : list.filter(x => !recent.includes(x));
  const choice = (source.length > 0 ? source : list)[Math.floor(Math.random() * (source.length > 0 ? source.length : list.length))];
  recent.push(choice);
  const memory = Math.max(1, Math.floor(list.length / 2));
  recentPicks.set(category, recent.slice(-memory));
  return choice;
}

function pick<T>(list: T[]): T | undefined {
  return list[Math.floor(Math.random() * list.length)];
}

function pickWeighted(list: Weighted[], tags: Tag[]): Weighted {
  const scored = list.map(item => ({ item, weight: 1 + item.tags.filter(t => tags.includes(t)).length * 3 }));
  const total = scored.reduce((n, s) => n + s.weight, 0);
  let r = Math.random() * total;
  for (const s of scored) {
    r -= s.weight;
    if (r <= 0) return s.item;
  }
  return scored[scored.length - 1].item;
}

// avoidText: nyligen använda miljöer och idéer (från berättelseminnet)
export function drawStorySeeds(presetId: string, avoidText = ''): StorySeeds {
  const tags = PRESET_TAGS[presetId] ?? ['vardag', 'kansla'];
  const recent = avoidText.toLowerCase();
  const usedRecently = (text: string) => text.toLowerCase().split(/[\s,]+/)
    .filter(x => x.length > 5).some(word => recent.includes(word));

  // Berättelsetypen viktas efter boktypen men roterar också
  let engine = pickWeighted(ENGINES, tags);
  const recentEngines = recentPicks.get('engine') ?? [];
  for (let tries = 0; tries < 4 && recentEngines.includes(engine.text); tries++) engine = pickWeighted(ENGINES, tags);
  recentPicks.set('engine', [...recentEngines, engine.text].slice(-Math.floor(ENGINES.length / 2)));

  const toneTag = pick(engine.tags.filter(t => tags.includes(t))) ?? tags[0];
  const pool = [
    { label: 'Uppbyggnad', list: STRUCTURES },
    { label: 'Huvudpersonens liv', list: FAMILIES },
    { label: 'Det som sätter igång', list: SPARKS },
    { label: 'Vad som står på spel', list: STAKES },
    { label: 'Vinkel', list: TWISTS },
  ].sort(() => Math.random() - 0.5).slice(0, 2);

  return {
    engine: engine.text,
    place: rotate('place', PLACES, usedRecently),
    tone: rotate(`tone:${toneTag}`, TONES[toneTag] ?? TONES.vardag),
    extras: pool.map(p => ({ label: p.label, text: rotate(p.label, p.list, usedRecently) })),
  };
}

export function seedsBlock(seeds: StorySeeds, strength: 'grund' | 'krydda'): string {
  return `INSPIRATION (${strength === 'grund' ? 'utgå från detta' : 'bara krydda till författarens idé'}). Det här är inspiration, inte text: formulera allt med egna ord, kopiera aldrig formuleringarna och byt ut det som inte passar.
- Sorts berättelse: ${seeds.engine}
- Miljö: ${seeds.place}
- Ton: ${seeds.tone}
${seeds.extras.map(e => `- ${e.label}: ${e.text}`).join('\n')}`;
}
