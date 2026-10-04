// Hjärnan: kunskap från riktiga barnböcker som läggs i skrivprompten.
// Källor och arbetsgång: referensbocker/PLAN-hjarnan.md och scripts/hjarnan/.
// Här står bara det vi formulerat själva - regler, egna exempel och mätvärden.
import type { StylePreset } from '../styles';
import { chapterCraft, chapterContrasts, DIARY_CRAFT } from './kapitelbok';

// Mätvärden från analyserade förlagor (scripts/hjarnan/samla.mjs). Används som
// ungefärliga mål, inte som exakta krav.
export interface StyleTargets {
  sources: string[]; // vilka förlagor värdena kommer från (titlar, för spårbarhet)
  sentenceMean: number; // ord per mening
  dialogueShare: number; // andel av texten i repliker
  saidShare: number; // andel anföringar med sa/säger
  exclamationsPer100Sentences: number;
  ellipsesPer1000: number;
  particlesPer1000: number;
  capsPer1000?: number; // ord i versaler (ljudord, betoning) - bara där appen brukar ta i för mycket
  emotionsPer1000?: number; // utpekade känslor i berättartexten - vissa förlagor säger dem rakt ut ofta
}

// Kapitelböcker 6-12 år i allmänhet: medel av de analyserade serierna, där
// varje serie väger lika (Yumi & Tomu 2 böcker, Familjen Knyckertz 3, Luna 1)
const GENRE_TARGETS: StyleTargets | null = {
  sources: ['Yumi & Tomu (2 böcker)', 'Familjen Knyckertz (3 böcker)', 'Luna (1 bok)'],
  sentenceMean: 8.9,
  dialogueShare: 0.34,
  saidShare: 0.48,
  exclamationsPer100Sentences: 9.3,
  ellipsesPer1000: 4.7,
  particlesPer1000: 5.9,
};
// Boktyper med egna analyserade förlagor
const STYLE_TARGETS: Record<string, StyleTargets> = {
  luna: {
    sources: ['Luna och superkraften – Det osynliga barnet'],
    sentenceMean: 10.1,
    dialogueShare: 0.35,
    saidShare: 0.57,
    exclamationsPer100Sentences: 4.8,
    ellipsesPer1000: 3.3,
    particlesPer1000: 6.2,
    capsPer1000: 0.7,
    emotionsPer1000: 12,
  },
  uppdrag: {
    sources: ['Yumi & Tomu – Resan till Interversum', 'Yumi & Tomu – Fantasimaskinen'],
    sentenceMean: 8.9,
    dialogueShare: 0.39,
    saidShare: 0.34,
    exclamationsPer100Sentences: 14.8,
    ellipsesPer1000: 9.7,
    particlesPer1000: 7.8,
    capsPer1000: 1.7,
  },
  knyckertz: {
    sources: ['Familjen Knyckertz och guld-diamanten', 'Familjen Knyckertz och gipskattens förbannelse', 'Familjen Knyckertz och damen med fjäderboan'],
    sentenceMean: 7.6,
    dialogueShare: 0.28,
    saidShare: 0.55,
    exclamationsPer100Sentences: 8.2,
    ellipsesPer1000: 1.2,
    particlesPer1000: 3.8,
    capsPer1000: 4.3,
  },
};

function every(n: number): string {
  if (n <= 1.5) return 'nästan varannan';
  if (n <= 2.5) return 'ungefär varannan';
  if (n <= 3.5) return 'ungefär var tredje';
  if (n <= 4.5) return 'ungefär var fjärde';
  if (n <= 5.5) return 'ungefär var femte';
  if (n <= 6.5) return 'ungefär var sjätte';
  if (n <= 7.5) return 'ungefär var sjunde';
  if (n <= 9) return 'ungefär var åttonde';
  return `ungefär en av ${Math.round(n)}`;
}

// "ungefär var sjätte mening" / "ungefär en mening av 21"
function everySentence(n: number): string {
  return n <= 9 ? `${every(n)} mening` : `ungefär en mening av ${Math.round(n)}`;
}

// Var AI-skriven text brukar hamna (mätt på appens egna bokstarter, eval-reports/fore)
const TYPICAL_AI = { dialogueShare: 0.2, saidShare: 0.77, exclamationsPer100Sentences: 3, ellipsesPer1000: 0.3, particlesPer1000: 2.3, sentenceMean: 6.5 };

function targetsBlock(t: StyleTargets): string {
  const pct = (n: number) => `${Math.round(n * 100)} procent`;
  const lines = [
    `RYTM I FÖRLAGORNA - sikta på det här. AI-skriven text brukar hamna fel på just de här punkterna:`,
    `- Repliker: omkring ${pct(t.dialogueShare)} av texten. AI-text har ofta bara ${pct(TYPICAL_AI.dialogueShare)}. Skriv fler och längre replikskiften och korta ner berättarpartierna mellan dem.`,
    `- Anföringar: "säger" eller "sa" i bara ${every(1 / Math.max(0.05, t.saidShare))} anföring - AI-text har det i ${pct(TYPICAL_AI.saidShare)}. Låt de flesta replikerna stå utan anföring eller med en handling bredvid, och välj ett annat verb när det låter något särskilt.`,
    `- Utrop: ${everySentence(100 / Math.max(1, t.exclamationsPer100Sentences)).replace(/^./, c => c.toUpperCase())} slutar med utropstecken, mest i replikerna (AI-text: ${everySentence(100 / TYPICAL_AI.exclamationsPer100Sentences)}).`,
  ];
  if (t.ellipsesPer1000 >= 3) lines.push(`- Tre punkter (…) ${t.ellipsesPer1000 >= 7 ? 'flera gånger per sida' : 'några gånger per sida'}: när någon tvekar, blir avbruten, fyller i en annans mening eller när en mening ska fortsätta på nästa sida.`);
  if (t.particlesPer1000 >= 4) lines.push(`- Småord som ju, nog, faktiskt, alltså, väl ${t.particlesPer1000 >= 7 ? 'flera gånger per sida' : 'några gånger per sida'}, mest i replikerna - de gör att det låter som när barn pratar.`);
  if ((t.emotionsPer1000 ?? 0) >= 4) lines.push(`- Säg gärna enkelt och rakt vad huvudpersonen känner (hon blir glad, han är rädd, det känns pirrigt) - förlagan gör det ofta, särskilt i lugna och varma scener. Visa det också i kroppen.`);
  lines.push(`- VERSALER bara för enstaka ljudord eller ett ord som ropas, högst ett par gånger per sida - utropstecken räcker oftast.`);
  lines.push(`- Meningslängd: AI-text blir ofta hackig med bara ${TYPICAL_AI.sentenceMean.toString().replace('.', ',')} ord per mening. Förlagorna har i snitt runt ${Math.round(t.sentenceMean)}: blanda korta meningar med lite längre som binds ihop med och, men, när, så att - särskilt i berättartexten mellan replikerna.`);
  return lines.join('\n');
}

// Hjärnans block till skrivprompten för en boktyp. Tomt för boktyper som
// hjärnan ännu inte har förlagor för (bilderböcker, serieromaner).
// Med författarens eget språk (voice) gäller hantverket men inte förlagornas
// rytm - författarens röst går före.
export function brainBlock(preset: StylePreset, options: { voice?: boolean } = {}): string {
  if (preset.book.format !== 'kapitelbok') return '';
  if (preset.book.paper === 'lined') return DIARY_CRAFT;
  const style = preset.book.dialogue ?? 'dash';
  const targets = options.voice ? null : STYLE_TARGETS[preset.id] ?? GENRE_TARGETS;
  return [chapterCraft(style), chapterContrasts(style), targets ? targetsBlock(targets) : ''].filter(Boolean).join('\n\n');
}
