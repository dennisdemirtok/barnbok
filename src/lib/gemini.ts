import { GoogleGenAI } from '@google/genai';
import { Character, Spread, BookFormat } from './types';

const MODEL = 'gemini-3.1-flash-image-preview';

function getClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY saknas i .env.local');
  return new GoogleGenAI({ apiKey });
}

// Rate limiting
let lastRequestTime = 0;
const MIN_DELAY_MS = 3000;

async function rateLimitedDelay() {
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;
  if (timeSinceLastRequest < MIN_DELAY_MS) {
    await new Promise(resolve => setTimeout(resolve, MIN_DELAY_MS - timeSinceLastRequest));
  }
  lastRequestTime = Date.now();
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

  const prompt = `Create a character reference sheet for a children's book character. Show the character from front view and 3/4 angle view, on a simple white background.

CHARACTER DETAILS:
- Name: ${character.name}${character.heroName ? ` (Hero name: ${character.heroName})` : ''}
- Age: ${character.age || 'unknown'}
- Appearance: ${character.appearance}
${character.normalClothes ? `- Normal clothes: ${character.normalClothes}` : ''}
${character.heroCostume ? `- Hero costume: ${character.heroCostume}` : ''}
${character.personality ? `- Personality: ${character.personality}` : ''}

STYLE: ${styleGuide}

Show the character clearly with consistent features, large expressive eyes in manga/comic style. The reference sheet should make it easy to reproduce this character exactly in future illustrations. Include both normal clothes and hero costume if applicable.

Label each view clearly. White/light grey background.`;

  return withRetry(async () => {
    const response = await ai.models.generateContent({
      model: MODEL,
      contents: [{ text: prompt }],
      config: {
        responseModalities: ['TEXT', 'IMAGE'],
      },
    });

    if (!response.candidates?.[0]?.content?.parts) {
      throw new Error('Inget svar fran Gemini');
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
      return `LAYOUT STYLE: Single illustration (like "Luna" picture books).
- Create ONE clear, beautiful illustration that fills most of the image area
- DO NOT include any text on the image - text will be printed separately
- Softer, more painterly illustration style - warm colors, gentle lighting
- Characters should be expressive but in a softer, less exaggerated style than comics
- Focus on one key scene/moment from the story
- Include detailed, atmospheric backgrounds that set the mood
- The illustration should complement the story text without needing to contain it
- Think of classic Scandinavian children's book illustration style
- Simpler composition focused on the characters and their emotions
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

CRITICAL: ALL ${charsInScene.length} characters listed above MUST appear in this illustration. Do NOT leave any of them out.
${mainCharsInScene.length > 1 ? `There are ${mainCharsInScene.length} main characters in this scene - make sure ALL of them are clearly visible and recognizable.` : ''}
${supportingCharsInScene.length > 0 ? `Supporting characters: ${supportingCharsInScene.map(c => c.name).join(', ')} - include them as described in the scene.` : ''}`;
  }

  // Add the main prompt
  const mainPrompt = `Generate an illustration for a children's book spread (double page, 32cm x 21cm).

${formatInstructions}

STYLE GUIDE: ${styleGuide}

${textSection}

IMAGE DESCRIPTION:
${spread.imagePrompt}
${characterPresenceSection}

CHARACTER CONSISTENCY:
- Keep ALL characters looking EXACTLY like their reference images above
- Maintain consistent art style throughout
- The image should be a full illustration suitable for a children's book spread
- Make sure character proportions, hair, clothing, and features match their reference sheets
- Every character must look the SAME across all pages - same hair color, same clothing, same features
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
      throw new Error('Inget svar fran Gemini');
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
