import { GoogleGenAI } from '@google/genai';
import { aspectFor, resolveComposition } from './compositions';
import { Character, Spread, BookFormat, IllustrationShape } from './types';
import { textSideForSpread } from './styles';
import { describeLettering, letteringCaps } from './comic';
import { withReferenceImages } from './character-refs';

const MODEL = 'gemini-3.1-flash-image-preview';

function getClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY saknas i .env.local');
  return new GoogleGenAI({ apiKey });
}

// Rate limiting with queue for parallel requests
let lastRequestTime = 0;
const MIN_DELAY_MS = 2000;
let rateLimitQueue = Promise.resolve();

async function rateLimitedDelay() {
  // Chain requests so they respect minimum delay even when called in parallel
  rateLimitQueue = rateLimitQueue.then(async () => {
    const now = Date.now();
    const timeSinceLastRequest = now - lastRequestTime;
    if (timeSinceLastRequest < MIN_DELAY_MS) {
      await new Promise(resolve => setTimeout(resolve, MIN_DELAY_MS - timeSinceLastRequest));
    }
    lastRequestTime = Date.now();
  });
  await rateLimitQueue;
}

// Retry with exponential backoff
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelayMs: number = 5000
): Promise<T> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxRetries) {
        const delay = baseDelayMs * Math.pow(2, attempt); // 5s, 10s, 20s
        console.log(`Gemini attempt ${attempt + 1} failed, retrying in ${delay / 1000}s...`, lastError.message);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
}

// Clean position labels from text blocks so they don't appear on images
// "sida 82 - textruta överst" -> just the actual text content
function cleanPositionForPrompt(position: string): string {
  // Remove page references and technical position info
  // Keep only meaningful placement hints like "överst", "nedre", "mitten"
  const placementMatch = position.match(/(överst|nedre|mitten|vänster|höger|topp|botten|center)/i);
  if (placementMatch) {
    return placementMatch[1].toLowerCase();
  }
  return '';
}

export async function generateCharacterSheet(
  character: Character,
  styleGuide: string
): Promise<string> {
  await rateLimitedDelay();
  const ai = getClient();

  // Estimate height from age string
  const ageNum = parseInt(character.age || '', 10);
  let heightEstimate: string;
  if (!isNaN(ageNum)) {
    if (ageNum <= 4) heightEstimate = '~100cm';
    else if (ageNum <= 6) heightEstimate = '~110cm';
    else if (ageNum <= 8) heightEstimate = '~125cm';
    else if (ageNum <= 9) heightEstimate = '~130cm';
    else if (ageNum <= 11) heightEstimate = '~140cm';
    else if (ageNum <= 13) heightEstimate = '~155cm';
    else if (ageNum <= 15) heightEstimate = '~165cm';
    else heightEstimate = '~170cm';
  } else {
    heightEstimate = '~130cm';
  }

  // Guard against placeholder values from older saved characters
  const hasHeroCostume = !!character.heroCostume &&
    !/^(ej relevant|inte relevant|ingen|inga|nej|n\/a|saknas|-)\.?$/i.test(character.heroCostume.trim());

  // Ansiktet är karaktärens identitet, så bladet har alltid en stor närbild på
  // ansiktet - i en liten helkroppsfigur syns inte dragen tillräckligt tydligt.
  let layoutSection: string;
  if (hasHeroCostume) {
    layoutSection = `LAYOUT: 3 columns × 2 rows (6 views) on a clean white background.
- Top-left: FRONT VIEW, full body, normal clothes. Label: "FRONT - Normal"
- Top-middle: 3/4 ANGLE VIEW, full body, normal clothes. Label: "3/4 - Normal"
- Top-right: BACK VIEW, full body, normal clothes. Label: "BAK - Normal"
- Bottom-left: LARGE CLOSE-UP OF THE HEAD seen straight from the front, filling its whole cell - the face is the most important part of the sheet, draw the features large and clearly. Label: "ANSIKTE - framifrån"
- Bottom-middle: CLOSE-UP OF THE HEAD in profile (seen from the side). Label: "ANSIKTE - profil"
- Bottom-right: FRONT VIEW, full body, hero costume. Label: "FRONT - Hero"`;
  } else {
    layoutSection = `LAYOUT: 2 columns × 2 rows (4 views) on a clean white background.
- Top-left: FRONT VIEW, full body, normal clothes. Label: "FRONT - Normal"
- Top-right: 3/4 ANGLE VIEW, full body, normal clothes. Label: "3/4 - Normal"
- Bottom-left: LARGE CLOSE-UP OF THE HEAD seen straight from the front, filling its whole cell - the face is the most important part of the sheet, draw the features large and clearly. Label: "ANSIKTE - framifrån"
- Bottom-right: CLOSE-UP OF THE HEAD in profile (seen from the side), same head as the close-up next to it. Label: "ANSIKTE - profil"`;
  }

  // Build color swatch list
  const swatchColors: string[] = [];
  swatchColors.push('hair color', 'eye color', 'skin tone', 'main clothing colors');
  if (hasHeroCostume) {
    swatchColors.push('hero costume colors');
  }

  const prompt = `Create a professional CHARACTER MODEL SHEET / CHARACTER REFERENCE SHEET for a children's book character.

CHARACTER DETAILS:
- Name: ${character.name}${character.heroName ? ` (Hero name: ${character.heroName})` : ''}
- Age: ${character.age || 'unknown'}
- Appearance: ${character.appearance}
${character.normalClothes ? `- Normal clothes: ${character.normalClothes}` : ''}
${hasHeroCostume ? `- Hero costume: ${character.heroCostume}` : ''}
${character.personality ? `- Personality: ${character.personality}` : ''}

ART STYLE: ${styleGuide}

${layoutSection}

REQUIRED ELEMENTS:
1. COLOR CALLOUT SWATCHES: Include a row of small labeled colored squares showing the exact colors used for: ${swatchColors.join(', ')}. Each swatch must have a text label beneath it identifying what it represents.
2. HEIGHT SCALE: Draw a vertical reference line with height marking (${heightEstimate}) next to the front view to indicate the character's height.
3. FACE: give the character clear, memorable facial features that are easy to redraw - the shape of the face, the eyes and eyebrows, the nose, the mouth and teeth, the hairline and hairstyle, plus any freckles, mole, gap in the teeth, glasses or similar marks mentioned in the appearance. The close-up views must show all of them. Neutral/calm expression in ALL views — not smiling, not angry, just neutral and composed. This makes it easy to adapt the character to different emotions later.
4. VIEW LABELS: Clear text label directly under each view (e.g., "FRONT - Normal", "3/4 - Normal"${hasHeroCostume ? ', "FRONT - Hero", "3/4 - Hero"' : ''}).
5. BACKGROUND: Clean pure white background. No scenery, no props, no distractions.
6. PROFESSIONAL LAYOUT: Arrange everything like a professional animation or comic character model sheet used by illustrators for reference.

CONSISTENCY RULES (CRITICAL):
- The character must look IDENTICAL across ALL views: same exact proportions, same facial features, same hair style and color, same eye color, same skin tone. The close-up head must be the same face as the full-body views, only larger.
- Clothing details must be consistent within each outfit (normal clothes consistent across normal views, hero costume consistent across hero views).
- The character should be easily reproducible from this reference sheet in future illustrations.

This reference sheet will be used as the definitive guide for drawing this character consistently throughout an entire book.`;

  return withRetry(async () => {
    const response = await ai.models.generateContent({
      model: MODEL,
      contents: [{ text: prompt }],
      config: {
        responseModalities: ['TEXT', 'IMAGE'],
      },
    });

    if (!response.candidates?.[0]?.content?.parts) {
      throw new Error('Inget svar från Gemini');
    }

    for (const part of response.candidates[0].content.parts) {
      if (part.inlineData) {
        return part.inlineData.data as string;
      }
    }

    throw new Error('Ingen bild genererades');
  });
}

export interface PageImageOptions {
  // Bildform - annars härleds den från bokformatet
  shape?: IllustrationShape;
  // 1K räcker för provningar, 2K för tryckkvalitet i den färdiga boken
  imageSize?: '1K' | '2K';
  // Rättelser från den automatiska granskningen (engelska, en per rad) - läggs sist i prompten
  corrections?: string[];
  // Tidsstyrning för granskningsloopen - standard är 3 omförsök utan timeout
  maxRetries?: number;
  timeoutMs?: number;
}

// Bokformat med text i bilden (serietidning / lärobok) - allt annat sätts av layoutmotorn
export function textInImage(bookFormat?: BookFormat): boolean {
  return bookFormat === 'bildbok-text-pa-bild' || bookFormat === 'larobok' || !bookFormat;
}

export function resolveIllustrationShape(bookFormat?: BookFormat, shape?: IllustrationShape): IllustrationShape {
  if (shape) return shape;
  return bookFormat === 'bildbok-separat-text' || bookFormat === 'kapitelbok' ? 'page' : 'spread';
}

// Layoutinstruktioner. VIKTIGT: inga stilord här (linjer, ögon, färger, teknik) -
// stilen kommer enbart från STYLE GUIDE, annars blir alla stilar likadana.
function getLayoutInstructions(bookFormat: BookFormat | undefined, shape: IllustrationShape, spreadNumber: number, composition?: Spread['composition']): string {
  if (bookFormat === 'bildbok-text-pa-bild' && shape === 'page') {
    // Serieroman: bilden ÄR den färdiga boksidan, med all text letrad i bilden
    return `LAYOUT: ONE COMPLETE COMIC BOOK PAGE (portrait 3:4, 16×21 cm) - the finished printed page of a kids' comic novel, with all lettering drawn in. This is NOT an illustration that gets text added later.
- Draw exactly the panels of the PAGE SCRIPT in the image description (2-6 panels), in reading order left to right, top to bottom, with a small even paper margin around the whole page
- Follow the panel sizes in the script; a sound effect may burst over panel borders
- Hand-letter every speech bubble, caption box and sound effect from the script INSIDE the image, in bold ALL-CAPS comic lettering, large and easy for a 6-year-old to read
- Speech bubbles: white with a black outline, the tail pointing clearly at the character who speaks; bubbles never cover a face. When a panel has several bubbles, the first spoken one sits highest / leftmost
- Caption boxes: small rectangular boxes tucked into a corner of their panel. Sound effects: giant colorful letters
- ONLY the texts in the script: no empty bubbles, no extra or invented words, no page numbers, titles, labels, signatures or words on signs
- The same character looks identical in every panel they appear in, and appears at most once per panel`;
  }

  if (bookFormat === 'bildbok-text-pa-bild') {
    return `LAYOUT: Comic/graphic-novel spread with panels.
- A professional comic spread with several panels of varied size
- SPEECH BUBBLES for dialogue (tail pointing to the speaker) and NARRATION BOXES for narrative text
- Every piece of provided Swedish text must appear in a bubble or box - exactly as written, never translated, never invented
- Never draw empty bubbles or boxes; if there is no dialogue, draw no speech bubbles
- Text must be large and legible for children aged 6-9
- No chapter headings, titles, page numbers or labels`;
  }

  if (bookFormat === 'larobok') {
    return `LAYOUT: Educational/activity book spread.
- Clear pedagogical illustrations; labels and arrows are allowed where they help explain
- Organized layout that supports learning
- No page numbers or metadata`;
  }

  // Rörliga böcker: varje bild har sin egen bildtyp
  if (composition === 'spot') {
    return `LAYOUT: SPOT ILLUSTRATION (square) that will sit inside a text page of a chapter book.
- Only the character(s) of the moment and the one or two props they hold or use - NO room, landscape or background scenery
- Plain white paper background all around, with generous empty white margins on every side so the figures can float on the page
- Under their feet at most a simple ground hint in the style's own means - only if the style guide uses color, a small soft flat patch of color (like a puddle of watercolor); in a pure black-and-white style just a short ink floor line, never a grey wash - nothing else
- Full body, clear readable silhouettes and funny body language; figures fill roughly the central 60-70% of the square
- Absolutely NO text, letters, numbers or speech bubbles`;
  }
  if (composition === 'round') {
    return `LAYOUT: ROUND VIGNETTE (square image that will be cropped to a circle).
- One clear, centered motif: a face close-up, an object, a clue or a small moment
- Fill the WHOLE square edge to edge with the scene - do NOT draw a circle, frame or border yourself; the book designer crops it to a circle
- Keep everything important inside the central circle (about 80% of the width); the corners will be cut away
- Absolutely NO text, letters, numbers or speech bubbles`;
  }
  if (composition === 'band') {
    return `LAYOUT: WIDE HORIZONTAL BAND (16:9) that will run edge to edge across the top or bottom of a text page.
- A scene that reads left to right: a journey, a street, a road, a room seen from the side, a row of characters
- Keep characters and key details away from the extreme top and bottom edges
- Absolutely NO text, letters, numbers or signage words`;
  }
  if (composition === 'panels') {
    return `LAYOUT: COMIC PANELS - one image containing 3 or 4 panels in a simple grid with thin white gutters, like a page from a funny comic.
- The panels show the moment step by step, in reading order (left to right, top to bottom), as described below
- The same characters look identical in every panel
- NO speech bubbles, captions, sound words, letters or numbers in any panel - keep one panel calm enough for a caption to be printed next to it
- Vary the framing between panels (wide, close-up, reaction)`;
  }
  if (composition === 'full') {
    return `LAYOUT: FULL-PAGE ILLUSTRATION (portrait, 16×21 cm), printed edge to edge.
- A complete scene with environment and atmosphere for an important moment
- Absolutely NO text, letters, numbers or signage words anywhere in the image`;
  }

  if (shape === 'spread') {
    const textSide = textSideForSpread(spreadNumber);
    return `LAYOUT: One continuous DOUBLE-PAGE SPREAD illustration (landscape, 32×21 cm).
- Absolutely NO text, letters, numbers or signage words anywhere in the image - the story text is typeset separately by the book designer
- The vertical center line is the book's fold: never place a face or key detail exactly on the center line
- Keep a calm, low-detail area (sky, wall, floor, soft background) across roughly the ${textSide.toUpperCase()} THIRD of the image, where the story text will be printed on top
- Put the main action and characters in the other two thirds`;
  }

  return `LAYOUT: Single PAGE illustration (portrait, 16×21 cm) for a book where the text is typeset on its own pages.
- Absolutely NO text, letters, numbers or signage words anywhere in the image
- Focus on one key moment of the scene
- Use the composition the art style calls for (e.g. soft vignette on white, or full page)`;
}

// Detect which characters from the list are mentioned in a spread's text/imagePrompt
export function findCharactersInScene(spread: Spread, characters: Character[]): Character[] {
  const allText = [
    ...spread.textBlocks.map(tb => tb.text),
    spread.imagePrompt,
  ].join(' ').toLowerCase();

  return characters.filter(char => {
    // Check name (and parts of the name)
    const nameParts = char.name.split(/\s+/);
    for (const part of nameParts) {
      if (part.length >= 2 && allText.includes(part.toLowerCase())) return true;
    }
    // Check hero name
    if (char.heroName && allText.includes(char.heroName.toLowerCase())) return true;
    return false;
  });
}

export async function generatePageImage(
  spread: Spread,
  characters: Character[],
  styleGuide: string,
  bookFormat?: BookFormat,
  options: PageImageOptions = {}
): Promise<string> {
  await rateLimitedDelay();
  const ai = getClient();

  // Build the contents array with reference images and prompt
  const contents: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];

  // Detect which characters are in this specific scene. Bilder som ligger i molnet hämtas hem.
  const withRefs = await withReferenceImages(characters);
  const approvedChars = withRefs.filter(c => c.referenceImage && c.approved);
  const charsInScene = findCharactersInScene(spread, approvedChars);
  const mainCharsInScene = charsInScene.filter(c => c.role === 'main');
  const supportingCharsInScene = charsInScene.filter(c => c.role !== 'main');

  // Add reference images for characters in this scene FIRST (higher priority)
  for (const char of charsInScene) {
    contents.push({
      text: `Reference image for character "${char.name}"${char.heroName ? ` (${char.heroName})` : ''} - THIS CHARACTER APPEARS IN THIS SCENE. This sheet defines who ${char.name} IS: draw exactly this face (face shape, eyes, eyebrows, nose, mouth and teeth, freckles or marks, ears), this hair color and hairstyle, skin tone, age and body proportions. Clothes may change only when the scene calls for it; the face never changes.${char.faceNotes ? ` FACE: ${char.faceNotes}` : ''} ${char.appearance}`,
    });
    contents.push({
      inlineData: {
        mimeType: 'image/png',
        data: char.referenceImage!,
      },
    });
  }

  // Also add reference images for characters NOT in this scene (for style consistency)
  const charsNotInScene = approvedChars.filter(c => !charsInScene.includes(c));
  for (const char of charsNotInScene) {
    contents.push({
      text: `Reference for character "${char.name}" (NOT in this scene, for style reference only). ${char.appearance}`,
    });
    contents.push({
      inlineData: {
        mimeType: 'image/png',
        data: char.referenceImage!,
      },
    });
  }

  // Get format-specific instructions
  const isCover = spread.pages === 'omslag';
  const shape = resolveIllustrationShape(bookFormat, options.shape);
  const formatInstructions = isCover
    ? `LAYOUT: FRONT COVER of a published children's book (portrait, 16×21 cm).
- Eye-catching, inviting composition that captures the book's theme and mood
- The book title MUST appear as large, beautifully lettered SWEDISH title text in the upper part, integrated with the artwork and lettered in a way that fits the art style (the exact title is given in the image description below)
- Apart from the title, NO other text anywhere
- Show the main character(s) in an appealing scene, leaving the title area uncluttered
- Professional bookshop-quality cover
- No labels, page numbers or metadata`
    : getLayoutInstructions(bookFormat, shape, spread.spreadNumber, spread.composition);
  const includeTextOnImage = !isCover && textInImage(bookFormat);
  const composition = isCover ? 'full' : resolveComposition(spread.composition, shape);
  // Serieroman: en stående bild per boksida med rutor och letrade pratbubblor
  const comicPage = !isCover && bookFormat === 'bildbok-text-pa-bild' && shape === 'page';
  // Figurer får förekomma en gång per ruta i serier
  const perPanel = composition === 'panels' || (!isCover && bookFormat === 'bildbok-text-pa-bild');

  // Build text section based on format - CLEAN position labels
  let textSection = '';
  if (isCover) {
    textSection = `TEXT ON THE COVER: The ONLY text allowed on the cover is the book title in Swedish (given in the image description below), rendered as large, clearly readable title lettering in the style given under COVER TITLE LETTERING in the style guide (if present) - it must look like this book series' own logo, not a generic decorative serif. No other words, labels or text anywhere on the image.`;
  } else if (comicPage) {
    const entries = spread.textBlocks
      .map((tb, idx) => `${idx + 1}. ${describeLettering(tb, idx)}: "${letteringCaps(tb.text)}"`)
      .join('\n');
    textSection = spread.textBlocks.length > 0
      ? `LETTERING - these are ALL ${spread.textBlocks.length} texts on this page. Letter each one exactly once, in its panel, copied letter for letter:
${entries}

SPELLING IS CRITICAL: the texts are Swedish and must never be translated. Keep every Å, Ä and Ö with its ring or dots (Å is not A, Ä is not A, Ö is not O), keep all punctuation, and never add, drop, change or reorder a word. Check every bubble, caption and sound effect against this list before finishing.
No other text anywhere on the page: no page number, no title, no labels, no extra bubbles.`
      : 'LETTERING: this page has no texts - draw no speech bubbles, caption boxes, sound effects or any other letters.';
  } else if (includeTextOnImage) {
    const textEntries = spread.textBlocks.map((tb, idx) => {
      const placement = cleanPositionForPrompt(tb.position);
      const placementHint = placement ? ` (placement: ${placement})` : '';
      return `Text ${idx + 1}${placementHint}:\n"${tb.text}"`;
    }).join('\n\n');

    textSection = `TEXT THAT MUST APPEAR ON THE IMAGE:
${textEntries}

IMPORTANT: ALL Swedish text above MUST be included on the image in speech bubbles, narration boxes, or text areas as appropriate.
Make sure ALL text is spelled correctly in Swedish.
Draw EXACTLY as many text boxes/speech bubbles as there are texts above - no extra bubbles, no empty bubbles, and no invented text.
Every word on the image must be Swedish and come from the texts above. Do not add chapter headings or titles.
DO NOT write any position labels, metadata, or page numbers. Only the actual story text should appear.`;
  } else {
    const storyText = spread.textBlocks.map(tb => tb.text).join('\n\n');
    textSection = `STORY CONTEXT (for reference only - DO NOT put this text on the image):
${storyText}

IMPORTANT: Do NOT include any text, letters, words, page numbers, or labels on the illustration. The text will be printed separately.`;
  }

  // Build explicit character presence instructions
  let characterPresenceSection = '';
  if (charsInScene.length > 0) {
    const charList = charsInScene.map(c =>
      `- ${c.name}${c.heroName ? ` (${c.heroName})` : ''}: ${c.appearance.substring(0, 100)}`
    ).join('\n');

    characterPresenceSection = `\nCHARACTERS THAT MUST BE VISIBLE IN THIS SCENE:
${charList}

CRITICAL: There are exactly ${charsInScene.length} character(s) in this scene. Each character must appear EXACTLY ONCE${perPanel ? ' PER PANEL' : ''}.
${perPanel ? `IMPORTANT: Within each panel, draw every character at most once.${comicPage ? ' Showing a character in several panels is normal comic storytelling.' : ''}` : 'IMPORTANT: Do NOT draw any character more than once. Each person appears only ONE time in the illustration.'}
${mainCharsInScene.length > 1 ? `There are ${mainCharsInScene.length} main characters in this scene - make sure ALL of them are clearly visible and recognizable, but each drawn only ONCE.` : ''}
${supportingCharsInScene.length > 0 ? `Supporting characters: ${supportingCharsInScene.map(c => c.name).join(', ')} - include them as described in the scene, each appearing once.` : ''}`;
  }

  // Omslag och helsidor är stående, uppslag liggande; rörliga böcker har egna bildtyper
  const aspectRatio = aspectFor(composition);
  const isPortrait = composition === 'full';
  const imageSize = isCover
    ? 'the front cover of a children\'s book (portrait, 16cm x 21cm)'
    : comicPage
    ? 'a complete comic book page with panels and lettering (portrait, 16cm x 21cm)'
    : composition === 'spread'
    ? 'a children\'s book spread (double page, 32cm x 21cm)'
    : composition === 'full'
    ? 'a single book page (portrait, 16cm x 21cm)'
    : `a ${composition === 'band' ? 'wide band' : composition === 'panels' ? 'comic panel' : composition === 'round' ? 'round vignette' : 'spot'} illustration for a chapter book page (${aspectRatio})`;

  // Add the main prompt
  const mainPrompt = `Generate an illustration for ${imageSize}.

STYLE GUIDE (this defines the entire look - rendering, line, color AND how faces and bodies are drawn):
${styleGuide}

${formatInstructions}

${textSection}

IMAGE DESCRIPTION:
${spread.imagePrompt}
${characterPresenceSection}

CHARACTER CONSISTENCY:
- Keep ALL characters looking EXACTLY like their reference images above
- Draw everyone in the character design language of the STYLE GUIDE
${composition === 'spread'
  ? '- The image must be a wide landscape double-page spread'
  : composition === 'full'
  ? '- The image must be a portrait illustration, NOT a wide landscape spread'
  : `- Follow the ${aspectRatio} format and the layout instructions above`}
- Make sure character proportions, hair, clothing, and features match their reference sheets
- Every character must be recognizably the SAME person on every page - same face (shape, eyes, nose, mouth, freckles/marks), same hair color and hairstyle, same age and proportions. Only the clothes may change, and only when the scene motivates it (pajamas in bed, a jacket outside); otherwise use their normal clothes
- NEVER duplicate a character - each person appears EXACTLY ONCE ${perPanel ? 'in each panel' : 'in the image'}
- NEVER write position labels like "left page", "right page", "sida X", or page numbers on the image`;

  contents.push({ text: mainPrompt });

  // Rättelser från granskningen läggs sist så att de väger tyngst
  const corrections = (options.corrections || []).map(c => c.trim()).filter(Boolean);
  if (corrections.length > 0) {
    contents.push({
      text: `CORRECTIONS FROM REVIEW (a reviewer rejected a previous attempt at this exact illustration - every fix below is MANDATORY and overrides anything above; keep everything else as described):
${corrections.map(c => `- ${c}`).join('\n')}`,
    });
  }

  // Use retry logic for resilience
  return withRetry(async () => {
    const response = await ai.models.generateContent({
      model: MODEL,
      contents,
      config: {
        responseModalities: ['TEXT', 'IMAGE'],
        imageConfig: {
          aspectRatio,
          imageSize: options.imageSize || '1K',
        },
        ...(options.timeoutMs ? { httpOptions: { timeout: options.timeoutMs } } : {}),
      },
    });

    if (!response.candidates?.[0]?.content?.parts) {
      throw new Error('Inget svar från Gemini');
    }

    for (const part of response.candidates[0].content.parts) {
      if (part.inlineData) {
        return part.inlineData.data as string;
      }
    }

    throw new Error('Ingen bild genererades');
  }, options.maxRetries ?? 3);
}

export async function regeneratePageImage(
  spread: Spread,
  characters: Character[],
  styleGuide: string,
  customInstructions?: string,
  bookFormat?: BookFormat,
  options: PageImageOptions = {}
): Promise<string> {
  if (customInstructions) {
    const modifiedSpread = {
      ...spread,
      imagePrompt: `${spread.imagePrompt}\n\nADDITIONAL INSTRUCTIONS: ${customInstructions}`,
    };
    return generatePageImage(modifiedSpread, characters, styleGuide, bookFormat, options);
  }
  return generatePageImage(spread, characters, styleGuide, bookFormat, options);
}
