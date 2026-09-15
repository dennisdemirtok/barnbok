// Bildstilar som kompletta bokkoncept. Varje stil bestämmer inte bara färg och
// linje utan också figurdesign (ansikten, proportioner), bildform och
// typografi - så att samma text blir olika böcker i olika stilar.
//
// `series` pekar på en analyserad stilprofil i barnbok_style_profiles. Profilen
// läggs till som kompletterande referens men ersätter aldrig art direction,
// eftersom profilerna ofta beskriver liknande saker ("clean outlines, large eyes").

import type { IllustrationShape } from './types';

export type { IllustrationShape };

export interface StylePreset {
  id: string;
  label: string;
  // Kort svensk beskrivning av bokkonceptet för UI:t
  concept: string;
  series?: string;
  // Engelsk art direction till bildmodellen - avgör hela uttrycket
  artDirection: string;
  // spread = liggande uppslagsbild (32×21 cm), page = stående helsida (16×21 cm)
  shape: IllustrationShape;
  // Typografi i den satta boken
  fonts: { body: BookFont; heading: BookFont };
  // Tailwind-gradient för stilens färgmarkering i UI:t
  swatch: string;
}

export type BookFont = 'literata' | 'nunito';

const NO_GENERIC = 'Do NOT fall back to a generic modern digital storybook look with big glossy eyes - every face, body and line must follow THIS style\'s own character design language.';

export const STYLE_PRESETS: StylePreset[] = [
  {
    id: 'handbok',
    label: 'Handbok för Superhjältar',
    concept: 'Filmisk äventyrsbok med dramatiska helsidesuppslag',
    series: 'Handbok for Superhjaltar',
    shape: 'spread',
    fonts: { body: 'nunito', heading: 'nunito' },
    swatch: 'from-indigo-700 to-fuchsia-500',
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
    fonts: { body: 'literata', heading: 'literata' },
    swatch: 'from-sky-800 to-teal-500',
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
    fonts: { body: 'literata', heading: 'nunito' },
    swatch: 'from-orange-500 to-red-600',
    artDirection: `ART STYLE: Humorous Scandinavian cartoon illustration for a funny crime-caper children's book.
RENDERING: Loose, scratchy, energetic black ink line with visible pen texture; slightly messy hatching; bright but warm watercolor-like color washes that do not stay inside the lines; white paper showing through.
CHARACTER DESIGN LANGUAGE: Strong CARICATURE - big bulbous or long pointed noses, small dot or bead eyes, oversized grins or grimaces, gangly long limbs or round stout bodies, big hands and feet, wild messy hair, exaggerated comic expressions and slapstick body language. Characters look quirky, never pretty or anime-like.
COMPOSITION: Busy, lively scenes packed with funny little background details and clutter; slightly tilted, playful perspective.
${NO_GENERIC}`,
  },
  {
    id: 'mammamu',
    label: 'Mamma Mu (akvarell)',
    concept: 'Klassisk bilderbok i tusch och akvarell',
    series: 'Mamma Mu',
    shape: 'spread',
    fonts: { body: 'literata', heading: 'literata' },
    swatch: 'from-lime-600 to-amber-600',
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
    fonts: { body: 'nunito', heading: 'nunito' },
    swatch: 'from-blue-500 to-violet-500',
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
    fonts: { body: 'nunito', heading: 'nunito' },
    swatch: 'from-stone-400 to-stone-600',
    artDirection: `ART STYLE: Minimalist flat graphic illustration, like a modern design-led picture book.
RENDERING: Flat vector shapes with NO outlines, a strictly limited palette of 3-4 colors plus off-white, subtle risograph grain texture.
CHARACTER DESIGN LANGUAGE: Highly simplified geometric figures - dot eyes, no nose or a single line, simple shapes for hair and bodies, emotion shown through posture.
COMPOSITION: Bold asymmetric composition with large areas of empty negative space.
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
  return profileImageStyle
    ? `${preset.artDirection}\n\nSUPPLEMENTARY NOTES from analysis of real books in this series (secondary to the art direction above):\n${profileImageStyle}`
    : preset.artDirection;
}
