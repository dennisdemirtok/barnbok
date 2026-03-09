import { BookProject, Character, Spread, TextBlock } from './types';

function generateId(): string {
  return Math.random().toString(36).substring(2, 11);
}

// Pre-process text to normalize formatting issues from Claude/AI output
function preprocessText(rawText: string): string {
  let text = rawText;

  // Remove markdown code block wrappers (```...``` or ```text...```)
  text = text.replace(/^```[\w]*\n?/gm, '');
  text = text.replace(/^```\s*$/gm, '');

  // Remove markdown bold/italic markers
  text = text.replace(/\*\*([^*]+)\*\*/g, '$1');
  text = text.replace(/\*([^*]+)\*/g, '$1');
  text = text.replace(/__([^_]+)__/g, '$1');

  // Remove markdown heading markers (## KARAKTÄRER -> KARAKTÄRER)
  text = text.replace(/^#{1,4}\s+/gm, '');

  // Normalize dashes: em-dash (—) and en-dash (–) to hyphen (-)
  text = text.replace(/[—–]/g, '-');

  // Normalize common spelling variants for KARAKTÄRER
  // KARAKTERER (without dots) -> KARAKTÄRER
  text = text.replace(/\bKARAKTERER\b/gi, 'KARAKTÄRER');
  text = text.replace(/\bKARAKTÄRER\b/gi, 'KARAKTÄRER');
  text = text.replace(/\bKarakterer\b/gi, 'KARAKTÄRER');

  // Normalize BILDPROMPT variations
  text = text.replace(/\bBILD\s*-?\s*PROMPT\b/gi, 'BILDPROMPT');

  return text;
}

// Detect recurring characters that aren't in the main character list
// Scans all spreads for named characters (herr X, fru Y, Mr. Z) appearing in 2+ spreads
function detectRecurringCharacters(spreads: Spread[], existingCharacters: Character[]): Character[] {
  // Build set of existing character names (lowercase for comparison)
  const existingNames = new Set<string>();
  for (const c of existingCharacters) {
    existingNames.add(c.name.toLowerCase());
    // Also add first name and last name parts
    for (const part of c.name.split(/\s+/)) {
      if (part.length >= 2) existingNames.add(part.toLowerCase());
    }
    if (c.heroName) existingNames.add(c.heroName.toLowerCase());
  }

  // Track each detected name across spreads
  const nameData: Map<string, {
    spreads: Set<number>;
    displayName: string;
    descriptions: string[];
  }> = new Map();

  function addName(key: string, displayName: string, spreadNum: number, description?: string) {
    if (existingNames.has(key.toLowerCase())) return;

    if (!nameData.has(key.toLowerCase())) {
      nameData.set(key.toLowerCase(), { spreads: new Set(), displayName, descriptions: [] });
    }
    const data = nameData.get(key.toLowerCase())!;
    data.spreads.add(spreadNum);
    // Keep the longer/more complete display name
    if (displayName.length > data.displayName.length) {
      data.displayName = displayName;
    }
    if (description && !data.descriptions.includes(description)) {
      data.descriptions.push(description);
    }
  }

  for (const spread of spreads) {
    const allText = [
      ...spread.textBlocks.map(tb => tb.text),
      spread.imagePrompt,
    ].join(' ');

    // Pattern 1: Swedish titles - "herr Jansson", "fru Lindström", "fröken Berg"
    const svRegex = /(?:herr|fru|fröken)\s+([A-ZÅÄÖ][a-zåäö]+)/gi;
    let svMatch;
    while ((svMatch = svRegex.exec(allText)) !== null) {
      const surname = svMatch[1];
      const fullTitle = svMatch[0].trim();
      // Look for role context: "vaktmästaren, herr Jansson" or "rektorn fru Lindström"
      const roleMatch = allText.match(new RegExp(`([a-zåäö]+(?:en|ern|arn)),?\\s+(?:herr|fru|fröken)\\s+${surname}`, 'i'));
      const roleDesc = roleMatch ? roleMatch[1] : undefined;
      addName(surname, fullTitle, spread.spreadNumber, roleDesc);
    }

    // Pattern 2: English titles - "Mr. Jansson", "Mrs. Lindström"
    const enRegex = /(?:Mr\.?|Mrs\.?|Ms\.?)\s+([A-ZÅÄÖ][a-zåäö]+)/g;
    let enMatch;
    while ((enMatch = enRegex.exec(allText)) !== null) {
      const surname = enMatch[1];
      // Look for English role: "the janitor, Mr. Jansson" or "janitor Mr. Jansson"
      const roleMatch = allText.match(new RegExp(`(?:the\\s+)?(\\w+),?\\s+(?:Mr\\.?|Mrs\\.?|Ms\\.?)\\s+${surname}`, 'i'));
      const roleDesc = roleMatch ? roleMatch[1] : undefined;
      addName(surname, enMatch[0].trim(), spread.spreadNumber, roleDesc);
    }

    // Pattern 3: Look for proper nouns in image prompts that aren't common words
    // Image prompts are English, so we can pick out Swedish-looking names
    const commonEnglish = new Set([
      'the', 'and', 'with', 'from', 'into', 'that', 'this', 'their', 'they',
      'showing', 'sitting', 'standing', 'looking', 'holding', 'wearing', 'walking',
      'scene', 'illustration', 'watercolor', 'painted', 'tones', 'colors',
      'soft', 'warm', 'bright', 'dark', 'light', 'gentle', 'dramatic',
      'school', 'room', 'house', 'door', 'window', 'office', 'hallway',
      'background', 'foreground', 'atmosphere', 'behind', 'around',
      'swedish', 'children', 'book', 'double', 'page', 'spread',
      'three', 'two', 'four', 'five', 'one', 'all', 'each', 'both',
      'girls', 'boys', 'young', 'old', 'new', 'other', 'first',
      'formal', 'cozy', 'touching', 'magical', 'mysterious', 'tense',
      'hopeful', 'heartwarming', 'triumphant', 'final',
      'autumn', 'spring', 'summer', 'winter', 'afternoon', 'morning',
      'sun', 'sunlight', 'shadows', 'golden', 'blue', 'green', 'red',
      'small', 'large', 'open', 'visible', 'nearby', 'together',
      'resolution', 'understanding', 'friendship', 'memories',
      'professional', 'certificates', 'awards', 'focus',
    ]);
    // Find capitalized words in imagePrompt that might be character names
    const promptWords = spread.imagePrompt.match(/\b[A-ZÅÄÖ][a-zåäö]{2,}\b/g) || [];
    for (const word of promptWords) {
      if (commonEnglish.has(word.toLowerCase())) continue;
      if (existingNames.has(word.toLowerCase())) continue;
      // Only count if the same word also appears in the Swedish text (confirms it's a name)
      const inSwedishText = spread.textBlocks.some(tb => tb.text.includes(word));
      if (inSwedishText) {
        addName(word, word, spread.spreadNumber);
      }
    }
  }

  // Build character entries for names appearing in 2+ different spreads
  const additionalChars: Character[] = [];

  for (const [, data] of nameData.entries()) {
    if (data.spreads.size >= 2) {
      const descParts: string[] = [];
      if (data.descriptions.length > 0) {
        descParts.push(data.descriptions.join(', '));
      }
      descParts.push(`Återkommande bikaraktär (förekommer i ${data.spreads.size} uppslag)`);

      additionalChars.push({
        id: generateId(),
        name: data.displayName,
        appearance: descParts.join('. '),
        role: 'supporting',
        approved: false,
      });
    }
  }

  return additionalChars;
}

export function parseBookData(rawText: string): BookProject {
  const text = preprocessText(rawText);
  const title = extractTitle(text);
  const subtitle = extractSubtitle(text);
  const characters = extractCharacters(text);
  const spreads = extractSpreads(text);
  const styleGuide = extractStyleGuide(text);

  console.log(`[Parser] Titel: "${title}", Karaktarer: ${characters.length}, Uppslag: ${spreads.length}`);
  if (characters.length === 0) {
    console.warn('[Parser] Inga karaktarer hittades! Forsta 500 tecken:', text.substring(0, 500));
  }
  if (spreads.length === 0) {
    console.warn('[Parser] Inga uppslag hittades! Soker efter SIDA-matchningar...');
    const sidaLines = text.split('\n').filter(l => /sida/i.test(l)).slice(0, 10);
    console.warn('[Parser] Rader med "SIDA":', sidaLines);
  }

  // Auto-detect recurring characters not in the main character list
  // (e.g. "herr Jansson", "fru Lindström" that appear in multiple spreads)
  const additionalChars = detectRecurringCharacters(spreads, characters);
  if (additionalChars.length > 0) {
    console.log(`[Parser] Hittade ${additionalChars.length} återkommande bikaraktärer: ${additionalChars.map(c => c.name).join(', ')}`);
    characters.push(...additionalChars);
  }

  return {
    id: generateId(),
    title,
    subtitle,
    characters,
    spreads,
    styleGuide,
    status: 'importing',
    createdAt: new Date().toISOString(),
  };
}

function extractTitle(text: string): string {
  // Look for "Titel:" field
  const titelMatch = text.match(/Titel:\s*(.+?)(?:\n|$)/i);
  if (titelMatch) return titelMatch[1].trim().replace(/^[""]|[""]$/g, '');

  // Look for bold title patterns
  const lines = text.split('\n').filter(l => l.trim());
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length > 3 && trimmed.length < 100 && !trimmed.includes(':') && trimmed === trimmed.toUpperCase()) {
      return trimmed;
    }
  }
  return lines[0]?.trim() || 'Namnlos bok';
}

function extractSubtitle(text: string): string | undefined {
  const match = text.match(/Del\s+\d+:\s*(.+?)(?:\n|$)/i);
  return match ? match[0].trim() : undefined;
}

function extractStyleGuide(text: string): string {
  const styleMatch = text.match(/Stil:\s*(.+?)(?:\n|$)/i);
  if (styleMatch) return styleMatch[1].trim();

  return 'Swedish children\'s book illustration style, manga/comic-inspired with large expressive eyes, thick outlines, detailed backgrounds, vibrant colors, Scandinavian aesthetic.';
}

// Helper for debug logging: count how many valid characters a block list produces
function tryParseCount(blocks: string[]): number {
  let count = 0;
  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed || trimmed.length < 10) continue;
    if (/^(Huvudkaraktärer|Bikaraktärer|KARAKTÄRER|KARAKTARER|Karakt[aä]rer|Rollista|Figurer)\s*$/i.test(trimmed)) continue;
    if (/^(Huvudkaraktärer|Bikaraktärer|KARAKTÄRER|KARAKTARER|Karakt)/i.test(trimmed) && trimmed.length < 40) continue;
    const char = parseCharacterBlock(trimmed);
    if (char) count++;
  }
  return count;
}

function extractCharacters(text: string): Character[] {
  // Find character section - try multiple patterns
  // Pattern 1: KARAKTÄRER section
  let charSectionMatch = text.match(/KARAKTÄRER[\s\S]*?(?=(?:KOMPLETT|KAPITEL\s+\d|^\s*SIDA\s+\d|^OMSLAG\b|---))/im);

  // Pattern 2: Karaktarer (without dots)
  if (!charSectionMatch) {
    charSectionMatch = text.match(/KARAKTARER[\s\S]*?(?=(?:KOMPLETT|KAPITEL\s+\d|^\s*SIDA\s+\d|^OMSLAG\b|---))/im);
  }

  // Pattern 3: Just "Karaktärer" with any casing
  if (!charSectionMatch) {
    charSectionMatch = text.match(/Karakt[aä]r(?:er|skort)\b[\s\S]*?(?=(?:KOMPLETT|KAPITEL\s+\d|^\s*SIDA\s+\d|^OMSLAG\b|---))/im);
  }

  // Pattern 4: "Rollista" or "Figurer" (alternative section names)
  if (!charSectionMatch) {
    charSectionMatch = text.match(/(?:ROLLISTA|FIGURER)\b[\s\S]*?(?=(?:KOMPLETT|KAPITEL\s+\d|^\s*SIDA\s+\d|^OMSLAG\b|---))/im);
  }

  // Last resort: look for the pattern from first * bullet to KAPITEL/SIDA
  if (!charSectionMatch) {
    charSectionMatch = text.match(/\n\s*\*\s+[A-ZÅÄÖ][\s\S]*?(?=(?:KAPITEL\s+\d|^\s*SIDA\s+\d))/im);
  }

  if (!charSectionMatch) {
    console.warn('[Parser] Karaktarssektion hittades inte');
    return [];
  }

  const charSection = charSectionMatch[0];

  // Split by character entries - try multiple strategies
  // Strategy 1: Bullet points (* Luna - 10 år...)
  const charBlocks = charSection.split(/\n\s*\*\s+/).filter(b => b.trim());

  // Strategy 2: ALL-CAPS names like "ELLA / BLIXTEN" or "ELLA - 11 år"
  const namedBlocks = charSection.split(/\n(?=[A-ZÅÄÖ]{2,}(?:\s*\/\s*[A-ZÅÄÖ]+)?(?:\s*[-–:]|\s*\())/);

  // Strategy 3: Numbered entries "1. Luna" or "1) Luna"
  const numberedBlocks = charSection.split(/\n\s*\d+[.)]\s+/);

  // Strategy 4: Double newlines (blank line separators between characters)
  const blankLineBlocks = charSection.split(/\n\s*\n/).filter(b => b.trim() && b.trim().length > 10);

  // Strategy 5: Mixed-case names at line start: "Luna - 10 år", "Luna (Månflickan) - ..."
  // Matches: Name followed by " - " or " (heroname)" or ":"
  const mixedCaseBlocks = charSection.split(/\n(?=[A-ZÅÄÖa-zåäö]{2,30}\s*(?:\([^)]+\)\s*)?[-–:]\s)/);

  // Try each strategy and pick the one that produces the most VALID parsed characters
  // This prevents greedy strategies (like mixed-case) from winning when they split on field labels
  const allStrategies = [
    { name: 'bullets', blocks: charBlocks },
    { name: 'caps', blocks: namedBlocks },
    { name: 'numbered', blocks: numberedBlocks },
    { name: 'blank', blocks: blankLineBlocks },
    { name: 'mixed', blocks: mixedCaseBlocks },
  ];

  let bestResult: Character[] = [];
  let bestName = '';

  for (const strategy of allStrategies) {
    const result: Character[] = [];
    for (const block of strategy.blocks) {
      const trimmed = block.trim();
      if (!trimmed || trimmed.length < 10) continue;
      // Skip pure section headers
      if (/^(Huvudkaraktärer|Bikaraktärer|KARAKTÄRER|KARAKTARER|Karakt[aä]rer|Rollista|Figurer)\s*$/i.test(trimmed)) continue;
      if (/^(Huvudkaraktärer|Bikaraktärer|KARAKTÄRER|KARAKTARER|Karakt)/i.test(trimmed) && trimmed.length < 40) continue;

      const char = parseCharacterBlock(trimmed);
      if (char) result.push(char);
    }

    if (result.length > bestResult.length) {
      bestResult = result;
      bestName = strategy.name;
    }
  }

  console.log(`[Parser] Strategi-resultat: bullets=${tryParseCount(charBlocks)}, caps=${tryParseCount(namedBlocks)}, numbered=${tryParseCount(numberedBlocks)}, blank=${tryParseCount(blankLineBlocks)}, mixed=${tryParseCount(mixedCaseBlocks)}`);
  console.log(`[Parser] Bästa strategi: ${bestName} (${bestResult.length} karaktärer): ${bestResult.map(c => c.name).join(', ')}`);

  return bestResult;
}

function parseCharacterBlock(block: string): Character | null {
  const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return null;

  const firstLine = lines[0];

  let name = '';
  let heroName: string | undefined;
  let age: string | undefined;

  // Pattern: "ELLA / BLIXTEN"
  const slashMatch = firstLine.match(/^([A-ZÅÄÖ][A-ZÅÄÖa-zåäö\s]+?)\s*\/\s*([A-ZÅÄÖ][A-ZÅÄÖa-zåäö\s]+)/);
  if (slashMatch) {
    name = slashMatch[1].trim();
    heroName = slashMatch[2].trim();
  }

  // Pattern: "Ella (Blixten) - 11 år, beskrivning"
  const parenMatch = firstLine.match(/^([A-ZÅÄÖa-zåäö\s]+?)\s*\(([^)]+)\)\s*[-–]\s*(\d+)\s*[aå]r/i);
  if (parenMatch && !name) {
    name = parenMatch[1].trim();
    heroName = parenMatch[2].trim();
    age = parenMatch[3] + ' ar';
  }

  // Pattern: "Ella (Blixten) - beskrivning" (without age)
  if (!name) {
    const parenMatch2 = firstLine.match(/^([A-ZÅÄÖa-zåäö\s]+?)\s*\(([^)]+)\)/);
    if (parenMatch2) {
      name = parenMatch2[1].trim();
      heroName = parenMatch2[2].trim();
    }
  }

  // Pattern: "Luna - 10 år, lång brun..." (name with age, no hero name)
  if (!name) {
    const nameAgeMatch = firstLine.match(/^([A-ZÅÄÖa-zåäö\s]+?)\s*[-–]\s*(\d+)\s*[aå]r/i);
    if (nameAgeMatch) {
      name = nameAgeMatch[1].trim();
      age = nameAgeMatch[2] + ' ar';
    }
  }

  // Pattern: "Luna - beskrivning" (name with dash, no age)
  if (!name) {
    const nameDashMatch = firstLine.match(/^([A-ZÅÄÖa-zåäö\s]{2,30}?)\s*[-–:]\s/);
    if (nameDashMatch) {
      name = nameDashMatch[1].trim();
    }
  }

  // Simple name extraction as fallback
  if (!name) {
    const simpleMatch = firstLine.match(/^([A-ZÅÄÖa-zåäö\s]+?)(?:\s*[-–:]|\s*$)/);
    if (simpleMatch) {
      name = simpleMatch[1].trim();
    } else {
      name = firstLine.substring(0, 30).trim();
    }
  }

  // Extract age if not found yet
  if (!age) {
    const ageLineMatch = block.match(/[Åa]lder:\s*(.+?)(?:\n|$)/i);
    if (ageLineMatch) {
      age = ageLineMatch[1].trim();
    } else {
      const ageInline = block.match(/(\d+)\s*[aå]r/i);
      if (ageInline) age = ageInline[0];
    }
  }

  // Extract appearance
  const appearanceMatch = block.match(/Utseende:\s*([\s\S]*?)(?=\n\s*(?:\*|[A-ZÅÄÖa-z]+:)|\n\n|$)/i);
  let appearance = appearanceMatch ? appearanceMatch[1].trim() : '';

  // If no explicit "Utseende:" field, try description from block
  if (!appearance) {
    const descParts: string[] = [];
    for (const line of lines.slice(1)) {
      if (/^(Vanliga kl[aä]der|Superhj[aä]ltedr[aä]kt|Personlighet|Kraft|Kl[aä]der|Hemlighet|Roll|[Åa]lder):/i.test(line)) {
        continue;
      }
      descParts.push(line);
    }
    appearance = descParts.join(' ').substring(0, 500);
  }

  // Extract other fields
  const normalClothes = extractField(block, 'Vanliga kl[aä]der');
  const heroCostume = extractField(block, 'Superhj[aä]ltedr[aä]kt');
  const personality = extractField(block, 'Personlighet');
  const power = extractField(block, 'Kraft');

  // Determine role
  let role: 'main' | 'supporting' | 'villain' = 'supporting';
  const lowerBlock = block.toLowerCase();
  if (lowerBlock.includes('skurk') || lowerBlock.includes('villain') || lowerBlock.includes('antagonist')) {
    role = 'villain';
  } else if (heroName || lowerBlock.includes('huvudkaraktar') || lowerBlock.includes('huvudkaraktär') || lowerBlock.includes('protagonist')) {
    role = 'main';
  }

  if (!name || name.length < 2) return null;

  // Reject names that are actually field labels (not character names)
  const fieldLabelPattern = /^(Utseende|Vanliga|Superhj|Personlighet|Kraft|Kl[aä]der|Hemlighet|Roll|[Åa]lder|Beskrivning|Bakgrund|Text|Stil|Tema|Handling|Milj[oö]|Format|Kapitel)\b/i;
  if (fieldLabelPattern.test(name)) return null;

  // Build full appearance string
  const fullAppearance = [
    appearance,
    age ? `Alder: ${age}` : '',
    normalClothes ? `Vanliga klader: ${normalClothes}` : '',
    heroCostume ? `Superhjalteddrakt: ${heroCostume}` : '',
  ].filter(Boolean).join('. ');

  return {
    id: generateId(),
    name,
    heroName: heroName || undefined,
    age,
    appearance: fullAppearance || `${name} - karaktar i boken`,
    normalClothes: normalClothes || undefined,
    heroCostume: heroCostume || undefined,
    personality: personality || undefined,
    power: power || undefined,
    role,
    approved: false,
  };
}

function extractField(text: string, fieldName: string): string | null {
  const regex = new RegExp(`${fieldName}:\\s*(.+?)(?:\\n|$)`, 'i');
  const match = text.match(regex);
  return match ? match[1].trim() : null;
}

function extractSpreads(text: string): Spread[] {
  const spreads: Spread[] = [];

  // Find all spread sections: "SIDA X-Y (Uppslag N)" or "SIDA X-Y" or "SIDA X"
  // ^ with m flag ensures we only match SIDA at start of line
  // Support both "Sida" and "SIDA" and optional whitespace/markdown
  const spreadRegex = /^\s*(?:SIDA|Sida)\s+(\d+)(?:\s*[-–]\s*(\d+))?\s*(?:\((?:Uppslag|uppslag)\s+(\d+)\))?/gm;
  const matches: Array<{ index: number; pages: string; spreadNum: number }> = [];

  let match;
  let spreadCounter = 0;
  while ((match = spreadRegex.exec(text)) !== null) {
    const startPage = parseInt(match[1]);
    const endPage = match[2] ? parseInt(match[2]) : startPage;

    // Skip chapter range headers like "Sida 48-59" (span > 2 pages)
    if (endPage - startPage > 1) {
      continue;
    }

    spreadCounter++;
    const pages = match[2] ? `${match[1]}-${match[2]}` : match[1];
    matches.push({
      index: match.index,
      pages,
      spreadNum: match[3] ? parseInt(match[3]) : spreadCounter,
    });
  }

  // Also check for OMSLAG (cover)
  const coverMatch = text.match(/^(?:\s*)OMSLAG\b/im);
  if (coverMatch && coverMatch.index !== undefined) {
    matches.push({
      index: coverMatch.index,
      pages: 'omslag',
      spreadNum: 0,
    });
  }

  // Also check for SLUTSIDA (end page)
  const endMatch = text.match(/^(?:\s*)SLUTSIDA\b/im);
  if (endMatch && endMatch.index !== undefined) {
    matches.push({
      index: endMatch.index,
      pages: 'slutsida',
      spreadNum: spreadCounter + 1,
    });
  }

  // Sort by position in text
  matches.sort((a, b) => a.index - b.index);

  // Track current chapter context
  let currentChapter = '';

  for (let i = 0; i < matches.length; i++) {
    const current = matches[i];
    const nextIndex = i < matches.length - 1 ? matches[i + 1].index : text.length;
    const section = text.substring(current.index, nextIndex);

    // Check for chapter heading in text before this spread
    const searchFrom = i > 0 ? matches[i - 1].index : 0;
    const beforeSection = text.substring(searchFrom, current.index);
    // Match "KAPITEL X: Name" or "Kapitel X - Name" or "KAPITEL X"
    const chapterMatch = beforeSection.match(/KAPITEL\s+\d+\s*[:–-]?\s*(.*?)(?:\n|$)/i);
    if (chapterMatch) {
      currentChapter = chapterMatch[0].trim();
    }

    // Extract text blocks and image prompt from this section
    const textBlocks = extractTextBlocks(section);
    const imagePrompt = extractImagePrompt(section);

    // Accept spread even if it only has text (some formats separate text and image)
    if (imagePrompt || textBlocks.length > 0) {
      spreads.push({
        id: generateId(),
        spreadNumber: current.spreadNum,
        pages: current.pages,
        chapter: currentChapter || undefined,
        textBlocks,
        imagePrompt: imagePrompt || '',
        status: 'pending',
      });
    }
  }

  return spreads;
}

function extractTextBlocks(section: string): TextBlock[] {
  const blocks: TextBlock[] = [];

  // Find all "Text ...:" positions in the section
  // Support: "Text (sida 6):", "Text (sida 6 - textruta överst):", "Text:", "Text 1:"
  const textStartRegex = /Text\s*(?:\(([^)]*)\)|\s*(\d+)\s*)?\s*:/gi;
  const textStarts: Array<{ index: number; endOfHeader: number; position: string }> = [];

  let match;
  while ((match = textStartRegex.exec(section)) !== null) {
    textStarts.push({
      index: match.index,
      endOfHeader: match.index + match[0].length,
      position: match[1]?.trim() || match[2]?.trim() || 'text',
    });
  }

  // Find BILDPROMPT position as a boundary
  const bildPromptIndex = section.search(/BILDPROMPT/i);
  const endBoundary = bildPromptIndex !== -1 ? bildPromptIndex : section.length;

  for (let i = 0; i < textStarts.length; i++) {
    const start = textStarts[i];
    // Text content ends at the next Text block or at BILDPROMPT
    const contentEnd = i < textStarts.length - 1
      ? textStarts[i + 1].index
      : endBoundary;

    const content = section.substring(start.endOfHeader, contentEnd).trim();
    if (content) {
      blocks.push({ position: start.position, text: content });
    }
  }

  // Fallback: if no "Text ...:" blocks found, try to get any text before BILDPROMPT
  if (blocks.length === 0 && bildPromptIndex > 0) {
    // Get text between the section header (first line) and BILDPROMPT
    const firstNewline = section.indexOf('\n');
    if (firstNewline > 0 && firstNewline < bildPromptIndex) {
      const fallbackText = section.substring(firstNewline, bildPromptIndex).trim();
      if (fallbackText && fallbackText.length > 5) {
        blocks.push({ position: 'text', text: fallbackText });
      }
    }
  }

  return blocks;
}

function extractImagePrompt(section: string): string {
  // Find "BILDPROMPT" in the section and capture everything after ":" to end of section
  const bildIndex = section.search(/BILDPROMPT/i);
  if (bildIndex === -1) return '';

  const afterBild = section.substring(bildIndex);
  // Find the first colon after BILDPROMPT
  const colonIndex = afterBild.indexOf(':');
  if (colonIndex === -1) {
    // Maybe there's no colon, just a newline - take everything after BILDPROMPT line
    const newlineIndex = afterBild.indexOf('\n');
    if (newlineIndex !== -1) {
      return afterBild.substring(newlineIndex + 1).trim();
    }
    return '';
  }

  // Everything after the colon is the prompt content
  return afterBild.substring(colonIndex + 1).trim();
}
