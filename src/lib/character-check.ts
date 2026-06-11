import { GoogleGenAI } from '@google/genai';
import { Character, Spread, BookFormat } from './types';
import { generatePageImage, regeneratePageImage, findCharactersInScene } from './gemini';

function getClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY saknas');
  return new GoogleGenAI({ apiKey });
}

export interface CheckIssue {
  character: string;
  issue: string;
  severity: 'minor' | 'major';
}

export interface CheckResult {
  passed: boolean;
  characters_found?: number;
  characters_expected?: number;
  issues: CheckIssue[];
  summary: string;
}

// Analyze a generated illustration against the character descriptions.
// Comic-panel aware: the same character in several panels is normal storytelling.
export async function checkCharacterConsistency(
  imageBase64: string,
  characters: Character[]
): Promise<CheckResult> {
  const ai = getClient();

  const charDescriptions = characters.map(c =>
    `- ${c.name}: ${c.appearance}${c.heroCostume ? `. Kostym: ${c.heroCostume}` : ''}`
  ).join('\n');

  const prompt = `You are a quality control system for children's book illustrations. Analyze this illustration and check if the characters match their descriptions.

CHARACTERS THAT SHOULD APPEAR:
${charDescriptions}

ANALYZE THE IMAGE AND RESPOND IN THIS EXACT JSON FORMAT:
{
  "passed": true/false,
  "characters_found": number,
  "characters_expected": ${characters.length},
  "issues": [
    {
      "character": "character name",
      "issue": "brief description of mismatch",
      "severity": "minor" or "major"
    }
  ],
  "summary": "Brief overall assessment in Swedish"
}

CHECK FOR:
1. Is each character present in the image?
2. Do hair color, clothing, species (human/animal) and key features match the descriptions?
3. Is the same character drawn twice WITHIN A SINGLE PANEL/SCENE?
4. Are proportions and style consistent?
5. Is there any English text on the image (the book is Swedish)? English text is a "major" issue.
6. Are there any EMPTY speech bubbles or text boxes? Empty bubbles are a "major" issue.

IMPORTANT - COMIC PANEL RULES:
- If the illustration is a comic page with MULTIPLE PANELS, the same character appearing in several different panels is NORMAL comic storytelling and NOT an issue. Do not report it.
- A character shown both in normal clothes and in hero costume across different panels (a transformation) is NORMAL and NOT an issue.
- ONLY report duplication if the same character appears more than once inside ONE panel/scene.

SEVERITY GUIDE:
- "major": wrong species (e.g. animal drawn as human), wrong hair color, missing main character, duplicated character within one panel, English text, empty speech bubbles
- "minor": small detail differences (missing freckles, slightly different shade, missing small accessory)

Mark as "passed": true if there are no major issues (minor style variations are OK).
Mark as "passed": false only when there is at least one major issue.

RESPOND WITH ONLY THE JSON, no other text.`;

  const response = await ai.models.generateContent({
    model: 'gemini-flash-latest',
    contents: [
      { text: prompt },
      {
        inlineData: {
          mimeType: 'image/png',
          data: imageBase64,
        },
      },
    ],
  });

  const responseText = response.candidates?.[0]?.content?.parts?.[0];
  if (!responseText || !('text' in responseText)) {
    throw new Error('Inget svar från Gemini');
  }

  const jsonMatch = (responseText.text || '').match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Kunde inte tolka svaret');
  }

  return JSON.parse(jsonMatch[0]) as CheckResult;
}

export interface QualityGenerationResult {
  image: string;
  check?: CheckResult;
  attempts: number;
  autoFixed: boolean;
}

// Generate a page image, quality-check it, and automatically regenerate once
// if the check finds major issues. The check result is returned so the UI can
// show quality status; a failing check never blocks image delivery.
export async function generatePageWithQualityCheck(
  spread: Spread,
  characters: Character[],
  styleGuide: string,
  bookFormat?: BookFormat
): Promise<QualityGenerationResult> {
  let image = await generatePageImage(spread, characters, styleGuide, bookFormat);

  // Only check against the characters that actually belong in this scene -
  // checking against the full cast produces false "missing character" majors
  const approved = characters.filter(c => c.approved && c.referenceImage);
  const charsInScene = findCharactersInScene(spread, approved);

  if (charsInScene.length === 0) {
    return { image, attempts: 1, autoFixed: false };
  }

  try {
    let check = await checkCharacterConsistency(image, charsInScene);
    const majors = (check.issues || []).filter(i => i.severity === 'major');

    if (!check.passed && majors.length > 0) {
      const issueList = majors
        .map(i => `- ${i.character}: ${i.issue}`)
        .join('\n');
      const instructions = `A quality control review found these problems in the previous attempt. Fix ALL of them while keeping everything else the same:\n${issueList}`;

      console.log(`[Kvalitetsloop] Uppslag ${spread.pages}: ${majors.length} allvarliga fel - regenererar automatiskt`);
      image = await regeneratePageImage(spread, characters, styleGuide, instructions, bookFormat);

      try {
        check = await checkCharacterConsistency(image, charsInScene);
      } catch {
        // keep previous check info if re-check fails
      }
      return { image, check, attempts: 2, autoFixed: true };
    }

    return { image, check, attempts: 1, autoFixed: false };
  } catch (err) {
    // The check itself failed (rate limit etc.) - deliver the image anyway
    console.warn('[Kvalitetsloop] Kontrollen kunde inte köras:', err instanceof Error ? err.message : err);
    return { image, attempts: 1, autoFixed: false };
  }
}
