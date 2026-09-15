// "Slutför din bok": författarens eget språk, tidslinje och kapitel.

// Hur en författare skriver - analyseras ur författarens egen text och kan sparas
// för att återanvändas i andra böcker
export interface VoiceProfile {
  summary: string; // 2-3 meningar om hur författaren låter
  tense: 'presens' | 'preteritum' | 'blandat';
  perspective: string; // t.ex. "tredje person, nära Otis"
  sentenceRhythm: string;
  dialogue: string; // hur repliker skrivs och taggas
  dialogueMarker: string; // tecknet som inleder en replik, t.ex. "* " eller "– "
  vocabulary: string;
  emotions: string; // hur känslor visas
  details: string; // vilka slags detaljer författaren väljer
  humor: string;
  pacing: string;
  signatureMoves: string[]; // typiska grepp
  avoid: string[]; // sådant författaren aldrig gör
}

export interface AuthorVoice {
  id: string;
  name: string;
  profile: VoiceProfile;
  samples: string[]; // ordagranna utdrag ur författarens egen text
  sourceTitle?: string;
  createdAt: string;
  updatedAt?: string;
}

export type ChapterSource = 'author' | 'ai';

export interface TimelineChapter {
  id: string;
  title: string; // "Prolog", "Kapitel 2 – Skogsstigen"
  notes: string; // författarens plan för kapitlet
  text: string; // tomt tills kapitlet är skrivet
  source: ChapterSource; // author = författarens egen text, skrivs aldrig om utan att be
  status: 'planned' | 'written';
  history: string[]; // tidigare versioner för ångra (senaste sist, max 10)
  updatedAt?: string;
}

export interface FinishSettings {
  targetAge: string;
  totalChapters: number;
  wordsPerChapter: number;
  genre?: string;
  // Hur fritt AI:n får tolka tidslinjen
  freedom: 'follow' | 'balanced' | 'free';
}

export interface FinishProject {
  id: string;
  title: string;
  author: string;
  premise: string; // vad boken handlar om och vart den är på väg
  ending?: string; // slutet författaren tänkt sig
  voice?: AuthorVoice; // språket som används (kopia, kan vara osparat)
  chapters: TimelineChapter[];
  settings: FinishSettings;
  createdAt: string;
  updatedAt: string;
}

// ── API-kontrakt ──

export interface ChapterContext {
  id: string;
  title: string;
  notes: string;
  text: string;
  source: ChapterSource;
}

export interface ProjectContext {
  title: string;
  premise: string;
  ending?: string;
  voice?: Pick<AuthorVoice, 'profile' | 'samples'>;
  settings: FinishSettings;
  chapters: ChapterContext[];
}

// POST /api/author/voice
export interface VoiceRequest { text: string; name?: string }
export interface VoiceResponse { voice: Pick<AuthorVoice, 'name' | 'profile' | 'samples'> }

// POST /api/author/timeline - skriver aldrig om kapitel som redan har text
export interface TimelineRequest {
  project: ProjectContext;
  mode: 'fill' | 'rework'; // fill: fyll i tomma planer + nya kapitel upp till totalChapters; rework: gör om planerade kapitel enligt instruktion
  instruction?: string;
}
export interface TimelineResponse {
  // Med id = uppdatera det planerade kapitlet; utan id = nytt kapitel sist
  chapters: { id?: string; title: string; notes: string }[];
}

// POST /api/author/chapter - skriver (eller skriver om) ett kapitel
export interface ChapterRequest { project: ProjectContext; chapterId: string; comment?: string }
export interface ChapterResponse { text: string; truncated: boolean }

// POST /api/author/rewrite - skriver om en markerad del
export interface RewriteRequest {
  project: Pick<ProjectContext, 'title' | 'premise' | 'voice' | 'settings'>;
  chapterTitle: string;
  before: string; // text före markeringen (ca 1500 tecken)
  selection: string;
  after: string; // text efter (ca 800 tecken)
  mode: 'comment' | 'variants' | 'polish';
  comment?: string;
}
export interface RewriteResponse { variants: string[] }
