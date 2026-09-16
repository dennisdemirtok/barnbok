export type BookFormat = 'bildbok-text-pa-bild' | 'bildbok-separat-text' | 'kapitelbok' | 'larobok';

// spread = liggande uppslagsbild (32×21 cm), page = stående helsida (16×21 cm)
export type IllustrationShape = 'spread' | 'page';

// Hur en enskild bild används i boken. Rörliga boktyper (t.ex. busiga kapitelböcker)
// blandar dem genom hela boken i stället för samma bildform varje gång.
//   full   - helsida med utfallande bild
//   spread - uppslag över två sidor
//   band   - brett band överst eller nederst på en textsida
//   spot   - en eller två utklippta figurer på vitt papper, mitt i texten
//   round  - rund vinjett
//   panels - 3-4 serierutor
export type Composition = 'full' | 'spread' | 'band' | 'spot' | 'round' | 'panels';

export interface BookProject {
  id: string;
  title: string;
  subtitle?: string;
  author?: string;
  targetAge?: string;
  bookFormat?: BookFormat;
  // Vald stil (lib/styles.ts) - styr bildform och typografi i den satta boken
  stylePresetId?: string;
  illustrationShape?: IllustrationShape;
  characters: Character[];
  spreads: Spread[];
  styleGuide: string;
  status: 'importing' | 'characters' | 'generating' | 'reviewing' | 'done';
  createdAt: string;
  updatedAt?: string;
}

export interface SavedCharacter {
  id: string;
  name: string;
  heroName?: string;
  age?: string;
  appearance: string;
  normalClothes?: string;
  heroCostume?: string;
  personality?: string;
  power?: string;
  role: 'main' | 'supporting' | 'villain';
  referenceImage?: string; // base64
  faceNotes?: string; // ansiktets kännetecken från karaktärsbladet
  stylePresetId?: string; // stilen referensbilden gjordes i
  savedAt: string;
  fromBookId?: string;
  fromBookTitle?: string;
}

export interface Character {
  id: string;
  name: string;
  heroName?: string;
  age?: string;
  appearance: string;
  normalClothes?: string;
  heroCostume?: string;
  personality?: string;
  power?: string;
  role: 'main' | 'supporting' | 'villain';
  referenceImage?: string; // base64
  referenceImageUrl?: string; // sparad i molnet - servern hämtar bilden härifrån
  faceNotes?: string; // ansiktets kännetecken, avlästa från karaktärsbladet
  approved: boolean;
}

export interface Spread {
  id: string;
  spreadNumber: number;
  imageUrl?: string; // bild sparad i molnet (servern lägger den här)
  pages: string; // e.g. "6-7"
  chapter?: string;
  textBlocks: TextBlock[];
  imagePrompt: string;
  composition?: Composition;
  generatedImage?: string; // base64
  status: 'pending' | 'generating' | 'done' | 'error';
  error?: string;
  qualityCheck?: SpreadQualityCheck;
}

// Result of the automatic quality check that runs after image generation
export interface SpreadQualityCheck {
  passed: boolean;
  summary: string;
  autoFixed: boolean; // true if the delivered image came from an automatic correction attempt
  issues?: { character: string; issue: string; severity: 'minor' | 'major'; category?: QualityIssueCategory }[];
  attempts?: number; // number of image generations used (1-3)
  score?: number; // reviewer score 0-100 for the delivered image
  reviewed?: boolean; // false if the reviewer could not run - the image is then unchecked
}

export type QualityIssueCategory =
  | 'missing_character'
  | 'duplicate_character'
  | 'extra_figure'
  | 'wrong_appearance'
  | 'missing_element'
  | 'unwanted_text'
  | 'anatomy'
  | 'cropped_character'
  | 'layout'
  | 'other';

export interface TextBlock {
  position: string; // e.g. "sida 6 - textruta överst"
  text: string;
}

export interface SavedText {
  id: string;
  title: string;
  rawText: string;
  bookFormat?: BookFormat;
  author?: string;
  stylePresetId?: string;
  characterCount: number;
  spreadCount: number;
  savedAt: string;
}
