import { GoogleGenAI } from '@google/genai';
import { Character, Spread, BookFormat, IllustrationShape } from './types';
import { textSideForSpread } from './styles';

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

  // Build layout instructions based on whether hero costume exists
  let layoutSection: string;
  if (hasHeroCostume) {
    layoutSection = `LAYOUT: 2×2 grid (4 views) on a clean white background.
- Top-left: FRONT VIEW wearing normal clothes. Label: "FRONT - Normal"
- Top-right: 3/4 ANGLE VIEW wearing normal clothes. Label: "3/4 - Normal"
- Bottom-left: FRONT VIEW wearing hero costume. Label: "FRONT - Hero"
- Bottom-right: 3/4 ANGLE VIEW wearing hero costume. Label: "3/4 - Hero"`;
  } else {
    layoutSection = `LAYOUT: 1×2 grid (2 views side by side) on a clean white background.
- Left: FRONT VIEW wearing normal clothes. Label: "FRONT - Normal"
- Right: 3/4 ANGLE VIEW wearing normal clothes. Label: "3/4 - Normal"`;
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
3. FACIAL EXPRESSION: Neutral/calm expression in ALL views — not smiling, not angry, just neutral and composed. This makes it easy to adapt the character to different emotions later.
4. VIEW LABELS: Clear text label directly under each view (e.g., "FRONT - Normal", "3/4 - Normal"${hasHeroCostume ? ', "FRONT - Hero", "3/4 - Hero"' : ''}).
5. BACKGROUND: Clean pure white background. No scenery, no props, no distractions.
6. PROFESSIONAL LAYOUT: Arrange everything like a professional animation or comic character model sheet used by illustrators for reference.

CONSISTENCY RULES (CRITICAL):
- The character must look IDENTICAL across ALL views: same exact proportions, same facial features, same hair style and color, same eye color, same skin tone.
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
}

// Bokformat med text i bilden (serietidning / lärobok) - allt annat sätts av layoutmotorn
function textInImage(bookFormat?: BookFormat): boolean {
  return bookFormat === 'bildbok-text-pa-bild' || bookFormat === 'larobok' || !bookFormat;
}

export function resolveIllustrationShape(bookFormat?: BookFormat, shape?: IllustrationShape): IllustrationShape {
  if (shape) return shape;
  return bookFormat === 'bildbok-separat-text' || bookFormat === 'kapitelbok' ? 'page' : 'spread';
}

// Layoutinstruktioner. VIKTIGT: inga stilord här (linjer, ögon, färger, teknik) -
// stilen kommer enbart från STYLE GUIDE, annars blir alla stilar likadana.
function getLayoutInstructions(bookFormat: BookFormat | undefined, shape: IllustrationShape, spreadNumber: number): string {
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

  // Detect which characters are in this specific scene
  const approvedChars = characters.filter(c => c.referenceImage && c.approved);
  const charsInScene = findCharactersInScene(spread, approvedChars);
  const mainCharsInScene = charsInScene.filter(c => c.role === 'main');
  const supportingCharsInScene = charsInScene.filter(c => c.role !== 'main');

  // Add reference images for characters in this scene FIRST (higher priority)
  for (const char of charsInScene) {
    contents.push({
      text: `Reference image for character "${char.name}"${char.heroName ? ` (${char.heroName})` : ''} - THIS CHARACTER APPEARS IN THIS SCENE. ${char.appearance}`,
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
    : getLayoutInstructions(bookFormat, shape, spread.spreadNumber);
  const includeTextOnImage = !isCover && textInImage(bookFormat);

  // Build text section based on format - CLEAN position labels
  let textSection = '';
  if (isCover) {
    textSection = `TEXT ON THE COVER: The ONLY text allowed on the cover is the book title in Swedish (given in the image description below), rendered as large decorative title lettering. No other words, labels or text anywhere on the image.`;
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

CRITICAL: There are exactly ${charsInScene.length} character(s) in this scene. Each character must appear EXACTLY ONCE.
IMPORTANT: Do NOT draw any character more than once. Each person appears only ONE time in the illustration.
${mainCharsInScene.length > 1 ? `There are ${mainCharsInScene.length} main characters in this scene - make sure ALL of them are clearly visible and recognizable, but each drawn only ONCE.` : ''}
${supportingCharsInScene.length > 0 ? `Supporting characters: ${supportingCharsInScene.map(c => c.name).join(', ')} - include them as described in the scene, each appearing once.` : ''}`;
  }

  // Omslag och helsidor är stående, uppslag liggande
  const isPortrait = isCover || shape === 'page';
  const imageSize = isCover
    ? 'the front cover of a children\'s book (portrait, 16cm x 21cm)'
    : isPortrait
    ? 'a single book page (portrait, 16cm x 21cm)'
    : 'a children\'s book spread (double page, 32cm x 21cm)';

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
${isPortrait
  ? '- The image must be a portrait illustration, NOT a wide landscape spread'
  : '- The image must be a wide landscape double-page spread'}
- Make sure character proportions, hair, clothing, and features match their reference sheets
- Every character must look the SAME across all pages - same hair color, same clothing, same features
- NEVER duplicate a character - each person appears EXACTLY ONCE in the image
- NEVER write position labels like "left page", "right page", "sida X", or page numbers on the image`;

  contents.push({ text: mainPrompt });

  // Use retry logic for resilience
  return withRetry(async () => {
    const response = await ai.models.generateContent({
      model: MODEL,
      contents,
      config: {
        responseModalities: ['TEXT', 'IMAGE'],
        imageConfig: {
          aspectRatio: isPortrait ? '3:4' : '3:2',
          imageSize: options.imageSize || '1K',
        },
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
