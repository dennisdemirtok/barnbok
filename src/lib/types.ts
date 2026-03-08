export type BookFormat = 'bildbok-text-pa-bild' | 'bildbok-separat-text' | 'kapitelbok' | 'larobok';

export interface BookProject {
  id: string;
  title: string;
  subtitle?: string;
  targetAge?: string;
  bookFormat?: BookFormat;
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
  approved: boolean;
}

export interface Spread {
  id: string;
  spreadNumber: number;
  pages: string; // e.g. "6-7"
  chapter?: string;
  textBlocks: TextBlock[];
  imagePrompt: string;
  generatedImage?: string; // base64
  status: 'pending' | 'generating' | 'done' | 'error';
  error?: string;
}

export interface TextBlock {
  position: string; // e.g. "sida 6 - textruta överst"
  text: string;
}

export interface SavedText {
  id: string;
  title: string;
  rawText: string;
  bookFormat?: BookFormat;
  characterCount: number;
  spreadCount: number;
  savedAt: string;
}
