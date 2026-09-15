// Snabbmallar för Karaktärsstudion. En mall fyller i alla fält så att man
// kommer igång direkt och sedan bara justerar. Fälten skrivs på svenska,
// precis som karaktärerna som tas fram ur manus (parser/claude) - bildmodellen
// får dem som de är i karaktärsbladets prompt.

import type { SavedCharacter } from './types';

export interface CharacterTemplateFields {
  name: string;
  heroName?: string;
  age: string;
  role: SavedCharacter['role'];
  appearance: string;
  normalClothes: string;
  personality: string;
  heroCostume?: string;
  power?: string;
}

export interface CharacterTemplate {
  id: string;
  label: string;
  // Material Symbols-ikon
  icon: string;
  // Kort svensk beskrivning för UI:t
  description: string;
  fields: CharacterTemplateFields;
}

export const CHARACTER_TEMPLATES: CharacterTemplate[] = [
  {
    id: 'nyfiken-upptackare',
    label: 'Nyfiken upptäckare',
    icon: 'explore',
    description: 'Frågvis äventyrare som alltid vill se vad som finns bakom nästa krök',
    fields: {
      name: 'Elsa',
      age: '7 år',
      role: 'main',
      appearance: 'Flicka med rufsigt kastanjebrunt hår i två tofsar, stora gröna ögon, fräknar över näsan och en smal, kvick kroppsbyggnad. Har ett förstoringsglas i en snodd runt halsen.',
      normalClothes: 'Senapsgul regnjacka, randig tröja, gröna byxor med många fickor och röda gummistövlar',
      personality: 'Nyfiken, orädd, frågvis och envis',
    },
  },
  {
    id: 'busigt-syskon',
    label: 'Busig lillebror',
    icon: 'child_care',
    description: 'Snabb, skrattande och full av hyss',
    fields: {
      name: 'Leo',
      age: '5 år',
      role: 'supporting',
      appearance: 'Liten pojke med kort, spretigt ljust hår som står rakt upp, runda blå ögon, knubbiga kinder, glugg mellan framtänderna och ett plåster på ena knät.',
      normalClothes: 'Dinosaurie-t-shirt med fläckar, blå shorts, omaka strumpor och gympaskor med kardborreband',
      personality: 'Busig, snabb, skrattar högt och retas gärna men har ett stort hjärta',
    },
  },
  {
    id: 'busig-lillasyster',
    label: 'Busig lillasyster',
    icon: 'sentiment_very_satisfied',
    description: 'Liten, envis och alltid i centrum',
    fields: {
      name: 'Tilde',
      age: '4 år',
      role: 'supporting',
      appearance: 'Liten flicka med rödblont lockigt hår i en spretig tofs rakt upp på huvudet, stora bruna ögon, fräknar och runda rosiga kinder.',
      normalClothes: 'Gul klänning med prickar över randiga leggings, en fladdrande superhjältemantel av en handduk och blinkande sneakers',
      personality: 'Envis, busig, charmig och vill alltid hänga med de stora barnen',
    },
  },
  {
    id: 'modig-superhjalte',
    label: 'Modig superhjälte',
    icon: 'bolt',
    description: 'Vanligt barn på dagen, hjälte när det behövs',
    fields: {
      name: 'Noah',
      heroName: 'Blixten',
      age: '9 år',
      role: 'main',
      appearance: 'Pojke med mörkt lockigt hår, bruna ögon, varm brun hy, atletisk men smal kroppsbyggnad och ett litet ärr på hakan.',
      normalClothes: 'Grå hoodie, mörka jeans och vita sneakers',
      heroCostume: 'Mörkblå dräkt med en gul blixt på bröstet, kort gul cape, gul ögonmask och gula handskar',
      power: 'Supersnabb - kan springa fortare än ljudet',
      personality: 'Modig, rättvis, lite otålig och ställer alltid upp för sina vänner',
    },
  },
  {
    id: 'klok-mormor',
    label: 'Klok mormor',
    icon: 'elderly_woman',
    description: 'Lugn berättare med ett bra råd för allt',
    fields: {
      name: 'Mormor Greta',
      age: '72 år',
      role: 'supporting',
      appearance: 'Äldre kvinna med silvervitt hår i en lös knut, runda glasögon, vänliga ljusblå ögon med skrattrynkor och en mjuk, rund kroppsbyggnad.',
      normalClothes: 'Stickad grön kofta med stora knappar, blommig kjol, förkläde med fickor och bekväma bruna skor',
      personality: 'Klok, lugn, varm och berättar gärna historier',
    },
  },
  {
    id: 'klok-morfar',
    label: 'Klok morfar',
    icon: 'elderly',
    description: 'Lite glömsk men full av historier från förr',
    fields: {
      name: 'Morfar Bengt',
      age: '75 år',
      role: 'supporting',
      appearance: 'Äldre, lång och lite framåtböjd man med kal hjässa och en krans av vitt hår, stor vit mustasch, buskiga ögonbryn och snälla bruna ögon bakom halvmånsglasögon.',
      normalClothes: 'Brun manchesterkavaj med lappar på armbågarna, rutig skjorta, hängslen och en gammal keps',
      personality: 'Klok, tålmodig, lite glömsk och full av roliga historier',
    },
  },
  {
    id: 'talande-djur',
    label: 'Talande djur',
    icon: 'pets',
    description: 'En räv som går på två ben och pratar mest hela tiden',
    fields: {
      name: 'Herr Räv',
      age: 'vuxen',
      role: 'supporting',
      appearance: 'Rödorange räv som går på två ben, vit bröst- och svanstipp, smala bärnstensgula ögon, spetsiga öron med svarta toppar och en lång yvig svans. Ungefär lika lång som ett barn.',
      normalClothes: 'Grön väst med guldknappar, rutig fluga och en liten brun hatt',
      personality: 'Listig, charmig och pratglad, men snäll innerst inne',
    },
  },
  {
    id: 'liten-drake',
    label: 'Liten drake',
    icon: 'local_fire_department',
    description: 'Blyg drakunge som hickar rökmoln',
    fields: {
      name: 'Glöd',
      age: '3 år',
      role: 'supporting',
      appearance: 'Liten knubbig drake med turkosa fjäll, ljusgul mage, små fladdriga vingar som är för små för kroppen, stora runda lila ögon, två korta horn och en tjock svans med hjärtformad spets.',
      normalClothes: 'Inga kläder - bara en röd stickad halsduk',
      personality: 'Blyg men nyfiken, hickar små rökmoln när den blir nervös och älskar kanelbullar',
      power: 'Kan spruta små gnistor och värma händer',
    },
  },
  {
    id: 'detektiv',
    label: 'Detektiv',
    icon: 'search',
    description: 'Skarpsinnig spanare som ser alla ledtrådar',
    fields: {
      name: 'Sam',
      age: '10 år',
      role: 'main',
      appearance: 'Barn med kort svart pagefrisyr, mörka smala ögon bakom runda glasögon med tjocka bågar, lång och smal för sin ålder.',
      normalClothes: 'Beige trenchcoat som är lite för stor, rutig keps, anteckningsblock och penna i bröstfickan och bruna kängor',
      personality: 'Skarpsinnig, noggrann, torrt humoristisk och lägger märke till allt',
    },
  },
  {
    id: 'aventyrsprinsessa',
    label: 'Äventyrsprinsessa',
    icon: 'castle',
    description: 'Prinsessa som hellre klättrar i torn än sitter i dem',
    fields: {
      name: 'Prinsessan Ines',
      age: '8 år',
      role: 'main',
      appearance: 'Flicka med långt tjockt svart hår i en fläta, bruna ögon, olivfärgad hy, en liten guldkrona som sitter snett och skrubbsår på knäna.',
      normalClothes: 'Kort lila tunika över praktiska byxor, läderbälte med ett träsvärd, höga bruna stövlar och en röd mantel',
      personality: 'Äventyrslysten, envis och modig - trött på att sitta still i slottet',
    },
  },
  {
    id: 'robotkompis',
    label: 'Robotkompis',
    icon: 'smart_toy',
    description: 'Hjälpsam liten robot som tar allt bokstavligt',
    fields: {
      name: 'Bolt',
      age: '1 år',
      role: 'supporting',
      appearance: 'Liten rund robot i blankt vitt och ljusblått metall, ett stort skärmansikte med två runda lysande blå ögon, en antenn med röd lampa på toppen, korta armar med tre fingrar och larvfötter i stället för ben.',
      normalClothes: 'Inga kläder - en orange verktygsväska på ryggen',
      personality: 'Hjälpsam, logisk, tar allt bokstavligt och piper glatt när den är nöjd',
    },
  },
  {
    id: 'skolkompis',
    label: 'Skolkompis',
    icon: 'school',
    description: 'Glad och lojal bästis från klassen',
    fields: {
      name: 'Maja',
      age: '7 år',
      role: 'supporting',
      appearance: 'Flicka med axellångt rakt blont hår och lugg, blågrå ögon, rosiga kinder och en tappad framtand. Medellång och smal.',
      normalClothes: 'Rosa långärmad tröja med ett hjärta, jeanskjol, randiga strumpbyxor och en blå ryggsäck',
      personality: 'Glad, pratglad, social och en lojal bästa vän',
    },
  },
  {
    id: 'klumpig-skurk',
    label: 'Klumpig skurk',
    icon: 'theater_comedy',
    description: 'Lurig men fåfäng - planerna går alltid snett',
    fields: {
      name: 'Baron Grus',
      age: '45 år',
      role: 'villain',
      appearance: 'Lång, gänglig man med spetsig näsa, tunn svart mustasch som vrider sig i spetsarna, små misstänksamma ögon och bakåtslickat svart hår.',
      normalClothes: 'Lila frack med guldkedja, randiga byxor, blanka spetsiga skor och hög hatt',
      personality: 'Lurig, fåfäng och klumpig',
    },
  },
];

export function getCharacterTemplate(id?: string): CharacterTemplate | undefined {
  return id ? CHARACTER_TEMPLATES.find(t => t.id === id) : undefined;
}
