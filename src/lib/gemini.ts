import { GoogleGenAI } from '@google/genai';
import { Character, Spread, BookFormat } from './types';

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

  const hasHeroCostume = !!character.heroCostume;

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

// Format-specific prompt instructions
function getFormatImageInstructions(bookFormat?: BookFormat): string {
  switch (bookFormat) {
    case 'bildbok-text-pa-bild':
      return `LAYOUT STYLE: Comic/manga panel layout (like "Handbok for Superhjaltar").
- Create a PROFESSIONAL comic book page with multiple panels per spread
- Use SPEECH BUBBLES for all dialogue text - white rounded bubbles with tail pointing to speaker
- Use NARRATION BOXES (rectangular, slightly tinted) for descriptive/narrative text
- Panel borders should be clean, with thick dark outlines
- Arrange panels dynamically - mix large and small panels for visual variety
- Characters should have large expressive manga-style eyes, thick outlines
- Use vibrant, saturated colors with detailed backgrounds
- The text in speech bubbles must use a clean, bold, comic-style font
- Text must be large enough to read easily (suitable for children age 6-9)
- EVERY piece of Swedish text MUST appear in an appropriate bubble or narration box
- Make it look like a REAL published comic book page - professional quality
- DO NOT write any position labels, page numbers, or metadata on the image`;

    case 'bildbok-separat-text':
      return `LAYOUT STYLE: Single-page illustration for a children's chapter book (like Swedish "Luna" books by Karin Lemon).
- Create ONE illustration sized for a SINGLE book page (portrait orientation, approximately 14cm x 21cm)
- The illustration will be placed on ONE page of a spread - the OTHER page will have printed text
- DO NOT include any text, letters, words, or writing on the image - text is printed separately on the facing page
- The illustration should NOT fill the entire image - leave some white/empty space around the edges
- Clean line art style with soft digital coloring - similar to modern Scandinavian children's book illustration
- Characters should have expressive faces with large eyes, clean outlines, soft shading
- NOT watercolor or painterly - more like clean digital illustration with defined edges
- Focus on ONE key moment or character interaction from the scene
- Background can be simple or partially white - does not need to fill the entire space
- Think of how illustrations look in chapter books: sometimes full-page, sometimes smaller with white space
- Characters should feel warm and relatable, with natural proportions (not overly cartoonish)
- Soft, muted color palette with gentle lighting
- The illustration should complement the story text on the facing page
- DO NOT write any labels, page numbers, position text, or metadata on the image`;

    case 'kapitelbok':
      return `LAYOUT STYLE: Chapter book illustration.
- Create a SINGLE, simpler illustration - more like a sketch or spot illustration
- DO NOT include any text on the image - text is printed separately
- Style can be more minimalistic - focus on one key moment or character pose
- Use softer colors or even consider black and white with light shading
- The illustration should enhance the text but the text carries the story
- Simpler backgrounds, focus on character expressions and key story moments
- Think of illustrations in books like Harry Potter or Bert-series
- DO NOT write any labels, page numbers, or metadata on the image`;

    case 'larobok':
      return `LAYOUT STYLE: Educational/activity book illustration.
- Create clear, pedagogical illustrations
- Can include labels, arrows, or visual elements that help explain concepts
- Bright, clear colors with good contrast
- Mix of character illustrations and informational graphics
- Text labels on the image should be in clean, readable font
- Organized layout that supports learning
- DO NOT write page numbers or position metadata on the image`;

    default:
      return `LAYOUT STYLE: Children's book illustration with integrated text.
- INCLUDE the Swedish text on the image in the correct positions
- Place text in readable text boxes or speech bubbles with good contrast
- Use a clear, readable font style suitable for children (age 6-9)
- Use vibrant colors with thick outlines in manga/comic style
- DO NOT write any position labels, page numbers, or metadata on the image`;
  }
}

// Detect which characters from the list are mentioned in a spread's text/imagePrompt
function findCharactersInScene(spread: Spread, characters: Character[]): Character[] {
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
  bookFormat?: BookFormat
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
  const formatInstructions = getFormatImageInstructions(bookFormat);
  const includeTextOnImage = bookFormat === 'bildbok-text-pa-bild' || bookFormat === 'larobok' || !bookFormat;

  // Build text section based on format - CLEAN position labels
  let textSection = '';
  if (includeTextOnImage) {
    const textEntries = spread.textBlocks.map((tb, idx) => {
      const placement = cleanPositionForPrompt(tb.position);
      const placementHint = placement ? ` (placement: ${placement})` : '';
      return `Text ${idx + 1}${placementHint}:\n"${tb.text}"`;
    }).join('\n\n');

    textSection = `TEXT THAT MUST APPEAR ON THE IMAGE:
${textEntries}

IMPORTANT: ALL Swedish text above MUST be included on the image in speech bubbles, narration boxes, or text areas as appropriate.
Make sure ALL text is spelled correctly in Swedish.
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

  // Determine image format based on book type
  const isSinglePageFormat = bookFormat === 'bildbok-separat-text' || bookFormat === 'kapitelbok';
  const imageSize = isSinglePageFormat
    ? 'a single book page (portrait, approximately 14cm x 21cm)'
    : 'a children\'s book spread (double page, 32cm x 21cm)';

  // Add the main prompt
  const mainPrompt = `Generate an illustration for ${imageSize}.

${formatInstructions}

STYLE GUIDE: ${styleGuide}

${textSection}

IMAGE DESCRIPTION:
${spread.imagePrompt}
${characterPresenceSection}

CHARACTER CONSISTENCY:
- Keep ALL characters looking EXACTLY like their reference images above
- Maintain consistent art style throughout
${isSinglePageFormat
  ? '- The image should be a single-page illustration - portrait orientation, NOT a wide landscape spread'
  : '- The image should be a full illustration suitable for a children\'s book spread'}
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
  bookFormat?: BookFormat
): Promise<string> {
  if (customInstructions) {
    const modifiedSpread = {
      ...spread,
      imagePrompt: `${spread.imagePrompt}\n\nADDITIONAL INSTRUCTIONS: ${customInstructions}`,
    };
    return generatePageImage(modifiedSpread, characters, styleGuide, bookFormat);
  }
  return generatePageImage(spread, characters, styleGuide, bookFormat);
}
