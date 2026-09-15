// Bildstilar som kompletta bokkoncept. Varje stil bestämmer inte bara färg och
// linje utan också figurdesign (ansikten, proportioner), bildform och
// typografi - så att samma text blir olika böcker i olika stilar.
//
// `series` pekar på en analyserad stilprofil i barnbok_style_profiles. Profilen
// läggs till som kompletterande referens men ersätter aldrig art direction,
// eftersom profilerna ofta beskriver liknande saker ("clean outlines, large eyes").

import type { Composition, IllustrationShape } from './types';
import type { FontFamily } from './book-fonts';

export type { IllustrationShape };

export interface StylePreset {
  id: string;
  label: string;
  // Kort svensk beskrivning av bokkonceptet för UI:t
  concept: string;
  series?: string;
  // Engelsk art direction till bildmodellen - avgör hela uttrycket
  artDirection: string;
  // Hur titeln letras på omslaget (annars blir alla omslag samma dekorativa serif)
  coverLettering: string;
  // spread = liggande uppslagsbild (32×21 cm), page = stående helsida (16×21 cm)
  shape: IllustrationShape;
  // Typografi i den satta boken: brödtext + rubriker (kapitel, titelsida)
  fonts: { body: FontFamily; heading: FontFamily };
  // Tailwind-gradient för stilens färgmarkering i UI:t
  swatch: string;
  // Bokkonceptet: format, textmängd och längd följer stilen, så att användaren
  // aldrig behöver ange antal sidor
  book: BookConcept;
}

export interface BookConcept {
  // bildbok-text-pa-bild = serieroman där texten står i pratbubblor i bilderna
  format: 'bildbok-separat-text' | 'kapitelbok' | 'bildbok-text-pa-bild';
  wordsPerImage: number; // ungefär hur mycket text som hör till varje bild
  targetWords: number; // typisk längd när AI:n skriver boken
  age: string;
  lengthLabel: string; // kort beskrivning för UI:t
  // Rörlig bildblandning: vikter per bildtyp. Utan mix används stilens bildform på alla bilder.
  compositionMix?: Partial<Record<Composition, number>>;
  // Hur repliker skrivs i boktypen (svensk standard är talstreck)
  dialogue?: 'dash' | 'quotes';
  // Språket i boktypen, beskrivet med egna ord utifrån analys av förlagor (aldrig citat)
  textStyle?: string;
  // Sidans papper: linjerat som ett skrivhäfte (dagbok)
  paper?: 'lined';
}


const NO_GENERIC = 'Do NOT fall back to a generic modern digital storybook look with big glossy eyes - every face, body and line must follow THIS style\'s own character design language.';

export const STYLE_PRESETS: StylePreset[] = [
  {
    id: 'handbok',
    label: 'Handbok för Superhjältar',
    concept: 'Filmisk äventyrsbok med dramatiska helsidesuppslag',
    series: 'Handbok for Superhjaltar',
    shape: 'spread',
    fonts: { body: 'Nunito', heading: 'Bangers' },
    swatch: 'from-indigo-700 to-fuchsia-500',
    book: { format: 'kapitelbok', wordsPerImage: 220, targetWords: 6000, age: '8-12 år', lengthLabel: 'Illustrerad kapitelbok · ca 90 sidor' },
    coverLettering: 'Bold, chunky comic-book title logo with a thick dark outline, slight 3D extrusion and dynamic tilt, like a superhero comic masthead.',
    artDirection: `ART STYLE: Cinematic digital graphic-novel painting for a Swedish middle-grade adventure series.
RENDERING: Crisp dark ink contours of varying weight, smooth painted gradient shading, glowing rim light, strong chiaroscuro. Night-time palette of deep indigo, teal and magenta cut by warm amber and yellow light sources (street lamps, flashlights, windows).
CHARACTER DESIGN LANGUAGE: Slender, slightly elongated anime/manga-influenced proportions; angular faces with pointed chins; large almond-shaped eyes with bright specular highlights; small noses drawn as a simple line; expressive eyebrows; hair drawn in sharp spiky clumps with strong highlights; dynamic, tense poses.
COMPOSITION: Wide cinematic camera angles (low angles, over-the-shoulder, dramatic perspective), deep atmospheric backgrounds, a sense of mystery and suspense.
${NO_GENERIC}`,
  },
  {
    id: 'luna',
    label: 'Luna',
    concept: 'Varm kapitelbok med mjuka vinjettbilder',
    series: 'Luna',
    shape: 'page',
    fonts: { body: 'Alegreya', heading: 'Alegreya' },
    swatch: 'from-sky-800 to-teal-500',
    book: { format: 'kapitelbok', wordsPerImage: 250, targetWords: 4500, age: '6-9 år', lengthLabel: 'Kapitelbok · ca 70 sidor' },
    coverLettering: 'Soft, rounded hand-lettered title in lowercase with gentle curves, small star or moon flourishes, calm and cosy - never all-caps serif.',
    artDirection: `ART STYLE: Soft, cozy 2D digital illustration for a Swedish early-reader chapter book.
RENDERING: Thin COLORED outlines (never black), flat colors with gentle airbrushed shading, subtle grain texture. The illustration is a soft-edged VIGNETTE that fades gently into a pure white page - not a full-bleed rectangle.
CHARACTER DESIGN LANGUAGE: Round, friendly faces with soft chubby cheeks and a rosy blush; oval eyes of moderate size with a single small highlight; tiny button nose; simple curved mouth; slightly large heads on small rounded bodies (about 4.5 heads tall); hair as soft simple shapes.
PALETTE: Midnight blue, teal and soft purple contrasted with warm lamp-light oranges and earthy terracotta accents.
COMPOSITION: Calm, intimate eye-level moments, uncluttered backgrounds, lots of breathing room.
${NO_GENERIC}`,
  },
  {
    id: 'knyckertz',
    label: 'Familjen Knyckertz',
    concept: 'Busig, humoristisk deckarbok med karikatyrer',
    series: 'Familjen Knyckertz',
    shape: 'page',
    // Skrivmaskinsrubriker och klassisk brödtext, som i förlagan
    fonts: { body: 'Literata', heading: 'CourierPrime' },
    swatch: 'from-orange-500 to-red-600',
    book: {
      format: 'kapitelbok', wordsPerImage: 180, targetWords: 9000, age: '6-9 år', lengthLabel: 'Kapitelbok · ca 110 sidor',
      // Rörligt formspråk: mest utklippta figurer, blandat med helsidor, band, serierutor och vinjetter
      compositionMix: { spot: 0.34, full: 0.18, band: 0.16, panels: 0.12, round: 0.1, spread: 0.1 },
      dialogue: 'quotes',
      textStyle: `Presens och tredje person nära barnet. Korta kapitel med numrerade, lekfulla rubriker, gärna som en fråga eller ett påstående som väcker nyfikenhet. Dialogen bär berättelsen: många korta repliker i citattecken med enkla anföringar som "säger", "undrar", "viskar", ofta i snabba växlingar. Torr, lågmäld humor där de vuxna tar absurda saker på största allvar och barnet är den som ser igenom dem. Figurer och platser får ordvitsnamn. Återkommande skämt och små ritualer (en gest, en fras) som kommer tillbaka flera gånger. Ibland listor, skyltar, tidningsrubriker eller lappar som bryter texten. Ljudord i versaler när det händer något. Meningarna är enkla och rytmiska, med konkreta vardagsdetaljer och ingen moralkaka.`,
    },
    coverLettering: 'Ransom-note collage lettering: each letter cut from a different paper or magazine, mixed sizes and colors, slightly crooked, like a playful crook\'s note.',
    artDirection: `ART STYLE: Humorous Scandinavian cartoon illustration for a funny crime-caper chapter book, drawn by hand.
RENDERING: Loose, slightly scratchy dark ink line with visible pen texture and light hatching. Flat, muted watercolor or gouache washes (dusty blues, lilac evening tones, ochre, grey) with small punches of warm orange-red. Lots of white paper; color often sits in soft flat patches rather than filling everything. Night scenes use deep violet with warm lamp light.
CHARACTER DESIGN LANGUAGE: Gentle caricature. Lanky, thin arms and legs, big feet in simple shoes, long or bulbous noses, small eyes, expressive eyebrows, slightly hunched deadpan poses. Figures are drawn fairly small and full-body with clear silhouettes and comic body language. Quirky and dry, never cute, glossy or anime-like.
COMPOSITION: Graphic and airy. Figures often stand on plain white paper with only a soft flat color puddle under their feet. Bold graphic devices: silhouettes against the sky, a flashlight cone of light, tilted rooms seen from above, a winding road across the page, spiky bursts. Playful, slightly skewed perspective with just the props the joke needs.
${NO_GENERIC}`,
  },
  {
    id: 'mammamu',
    label: 'Mamma Mu (akvarell)',
    concept: 'Klassisk bilderbok i tusch och akvarell',
    series: 'Mamma Mu',
    shape: 'spread',
    fonts: { body: 'LibreCaslon', heading: 'LibreCaslon' },
    swatch: 'from-lime-600 to-amber-600',
    book: { format: 'bildbok-separat-text', wordsPerImage: 70, targetWords: 900, age: '3-6 år', lengthLabel: 'Bilderbok · ca 32 sidor' },
    coverLettering: 'Classic hand-painted brush lettering in warm dark brown, slightly irregular like it was painted with the same watercolour brush, simple and old-fashioned.',
    artDirection: `ART STYLE: Classic Scandinavian pen-and-ink and watercolor picture-book illustration.
RENDERING: Fine, lively black ink line with delicate cross-hatching for shadows; transparent watercolor washes with visible paper texture and soft blooms; the scene sits as a vignette with soft irregular edges fading into warm white paper.
CHARACTER DESIGN LANGUAGE: Gentle cartoon realism - small dot eyes, round or potato-shaped noses, rosy cheeks, slightly stocky and rounded bodies, rumpled clothes with ink folds, warm humorous expressions. No big glossy eyes.
PALETTE: Earthy natural colors - meadow greens, Falu red, ochre, warm browns, soft wintry grays.
COMPOSITION: Detailed rural or homely environments full of small observed details (tools, plants, animals).
${NO_GENERIC}`,
  },
  {
    id: 'disney',
    label: 'Tecknad film (3D)',
    concept: 'Filmisk bilderbok som en animerad långfilm',
    shape: 'spread',
    fonts: { body: 'Nunito', heading: 'Fredoka' },
    swatch: 'from-blue-500 to-violet-500',
    book: { format: 'bildbok-separat-text', wordsPerImage: 60, targetWords: 800, age: '3-6 år', lengthLabel: 'Bilderbok · ca 32 sidor' },
    coverLettering: 'Glossy, dimensional animated-film title logo with soft bevel, warm glow and a playful swash, like a family movie poster.',
    artDirection: `ART STYLE: Modern 3D animated feature-film look (high-end CG render) as a picture-book illustration.
RENDERING: Soft global illumination, subsurface scattering on skin, shallow depth of field, cinematic color grading, polished materials.
CHARACTER DESIGN LANGUAGE: Stylized 3D characters - large heads, big expressive eyes, soft rounded simplified anatomy, appealing exaggerated expressions, stylized hair as sculpted shapes.
COMPOSITION: Cinematic framing with foreground, midground and background depth.`,
  },
  {
    id: 'minimalistisk',
    label: 'Minimalistisk',
    concept: 'Grafisk, modern bilderbok med stora ytor',
    shape: 'page',
    fonts: { body: 'Figtree', heading: 'Figtree' },
    swatch: 'from-stone-400 to-stone-600',
    book: { format: 'bildbok-separat-text', wordsPerImage: 40, targetWords: 450, age: '2-5 år', lengthLabel: 'Bilderbok · ca 24 sidor' },
    coverLettering: 'Clean, modern geometric sans-serif title set in one flat colour, generous letter spacing, no ornaments or effects.',
    artDirection: `ART STYLE: Minimalist flat graphic illustration, like a modern design-led picture book.
RENDERING: Flat vector shapes with NO outlines, a strictly limited palette of 3-4 colors plus off-white, subtle risograph grain texture.
CHARACTER DESIGN LANGUAGE: Highly simplified geometric figures - dot eyes, no nose or a single line, simple shapes for hair and bodies, emotion shown through posture.
COMPOSITION: Bold asymmetric composition with large areas of empty negative space.
${NO_GENERIC}`,
  },
  {
    id: 'dagbok',
    label: 'Dagbok (Wimpy Kid-känsla)',
    concept: 'Rolig dagbok i jagform med svartvita teckningar på linjerat papper',
    shape: 'page',
    fonts: { body: 'Schoolbell', heading: 'Schoolbell' },
    swatch: 'from-slate-600 to-slate-900',
    book: {
      format: 'kapitelbok', wordsPerImage: 90, targetWords: 9000, age: '8-12 år', lengthLabel: 'Dagboksroman · ca 150 sidor',
      // Teckningarna står mitt i texten: breda band och figurer, ibland en tankebubbla eller rutor
      compositionMix: { band: 0.42, spot: 0.36, round: 0.12, panels: 0.1 },
      dialogue: 'quotes',
      paper: 'lined',
      textStyle: `Jagform och preteritum, som en riktig dagbok. Varje inlägg börjar med veckodagen på en egen rad ("Måndag", "Tisdag" ...). Berättaren är ett barn som tycker att hen själv har rätt och alla andra är orättvisa, och läsaren ser mer än berättaren. Korta stycken på 2-4 meningar. Repliker återges oftast indirekt ("Mamma sa att jag MÅSTE ...") och ibland som korta citat. Enstaka ord i VERSALER för betoning. Humorn kommer från pinsamma situationer, felaktiga slutsatser, syskonbråk och vuxna regler som berättaren försöker ta sig runt. Konkreta vardagsdetaljer från skola, familj och kompisar. Varje inlägg slutar gärna med en torr kommentar eller en plan som uppenbart kommer att gå fel. Inga långa beskrivningar - allt låter som när ett barn skriver snabbt och ärligt.`,
    },
    coverLettering: 'Simple, slightly uneven hand-drawn marker lettering in black on a torn piece of lined notebook paper taped onto the cover, as if the kid wrote the title himself.',
    artDirection: `ART STYLE: Simple black-and-white cartoon doodles, as if drawn by a kid with a black fineliner in a lined diary - for a funny diary novel.
RENDERING: Pure black ink on white, no color, no grey shading, no gradients. Clean, confident, slightly wobbly line of even thickness. Large areas of SOLID FLAT BLACK are used for hair, shoes, clothes details and especially for background people and crowds drawn as black silhouettes. Simple patterns (checks, stripes, dots) instead of shading. Plain white background with only the props the gag needs.
CHARACTER DESIGN LANGUAGE: Very simple figures: big round or oval heads, dot eyes, small line mouths, a few lines of hair or solid black hair shapes, thin stick-like arms and legs, simple rectangular bodies and clothes. Expressions are clear and funny with minimal lines. Everyone is drawn in the same flat, graphic doodle style - never realistic, never cute or glossy.
COMPOSITION: Flat, frontal or side-on views like a quick sketch, figures standing on an implied floor line, generous white space around. Objects are simplified (a bed, a car, a table) and easy to read. The drawing should look good sitting between lines of handwritten text.
${NO_GENERIC}`,
  },
  {
    id: 'serie',
    label: 'Färgglad serie (Dog Man-känsla)',
    concept: 'Tokig serieroman i färg med rutor, pratbubblor och ljudord',
    shape: 'page',
    fonts: { body: 'ComicNeue', heading: 'LuckiestGuy' },
    swatch: 'from-yellow-400 to-red-600',
    book: {
      format: 'bildbok-text-pa-bild', wordsPerImage: 45, targetWords: 3500, age: '6-10 år', lengthLabel: 'Serieroman · ca 80 sidor',
      textStyle: `Serieroman i presens där allt berättas i rutor: korta repliker i pratbubblor, små textrutor som "Under tiden ..." eller "Senare ...", och stora ljudord (ZOOOM, KLONK, PANG). Repliker är korta, 2-10 ord, ofta med utropstecken och ett betonat ord. Tokig, snäll humor med ordvitsar, missförstånd, slapstick och en skurk som inte är farlig på riktigt. Hjärtat i berättelsen är vänskap och att vara modig och snäll. Tempo: en händelse per ruta, cliffhanger längst ner på sidan, ofta en helsida eller ett uppslag när något stort händer.`,
    },
    coverLettering: 'Big bouncy comic-book title lettering with thick black outlines, bright fill colors, a drop shadow and a jagged burst shape behind it.',
    artDirection: `ART STYLE: Bright, loud full-color comic book for kids, hand-drawn and hand-lettered.
RENDERING: Thick, wobbly black ink outlines with a marker feel. Saturated flat colors (red, yellow, purple, turquoise, orange) with visible halftone dot shading and simple color gradients in the backgrounds, like printed comics. Panels have thick black borders on off-white paper with white gutters. Sparkly stars, speed lines and motion puffs.
CHARACTER DESIGN LANGUAGE: Simple, chunky cartoon characters with big round heads, huge round eyes with small pupils, big grins, rubbery limbs and oversized hands and feet. Very exaggerated, slapstick poses and expressions. Everything is goofy and friendly.
COMPOSITION: Classic comic page with 3-6 panels of varied size; occasional big splash panel. Hand-lettered speech bubbles and caption boxes in ALL-CAPS comic lettering, and giant colorful sound effects that burst out of the panels. Backgrounds are simple: a brick wall, a starry night, a city skyline in silhouette, a green field.
${NO_GENERIC}`,
  },
];

// På liggande uppslagsbilder hålls en lugn yta fri för texten. Bildprompten och
// layoutmotorn måste vara överens om vilken sida - därför en gemensam regel.
export function textSideForSpread(spreadNumber: number): 'left' | 'right' {
  return spreadNumber % 2 === 0 ? 'right' : 'left';
}

export function getStylePreset(id?: string): StylePreset | undefined {
  return id ? STYLE_PRESETS.find(s => s.id === id) : undefined;
}

// Kombinera stilens art direction med analysen av riktiga böcker (om den finns)
export function composeStyleGuide(preset: StylePreset, profileImageStyle?: string | null): string {
  const base = `${preset.artDirection}\n\nCOVER TITLE LETTERING (only used when drawing the front cover): ${preset.coverLettering}`;
  return profileImageStyle
    ? `${base}\n\nSUPPLEMENTARY NOTES from analysis of real books in this series (secondary to the art direction above):\n${profileImageStyle}`
    : base;
}
