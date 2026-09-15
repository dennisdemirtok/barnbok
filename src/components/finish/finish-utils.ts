// Hjälpfunktioner för "Slutför din bok" - ren logik utan React
import type {
  AuthorVoice,
  FinishProject,
  FinishSettings,
  ProjectContext,
  RewriteRequest,
  TimelineChapter,
  TimelineResponse,
  VoiceProfile,
} from '@/lib/author-types';
import { STYLE_PRESETS } from '@/lib/styles';

export const newId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export const nowIso = () => new Date().toISOString();

export function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

export const fmt = (n: number) => n.toLocaleString('sv-SE');

export function formatUpdated(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  if (sameDay) return `i dag ${d.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })}`;
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'i går';
  return d.toLocaleDateString('sv-SE', { day: 'numeric', month: 'short', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}

// ── Åldrar och inställningar ──

export const AGE_OPTIONS = Array.from(new Set(['3-6 år', '6-9 år', '8-12 år', '12+ år', ...STYLE_PRESETS.map(s => s.book.age)]))
  .sort((a, b) => parseInt(a) - parseInt(b));

export const FREEDOM_OPTIONS: { value: FinishSettings['freedom']; label: string; hint: string; icon: string }[] = [
  { value: 'follow', label: 'Följ min tidslinje', hint: 'Håller sig nära dina anteckningar', icon: 'route' },
  { value: 'balanced', label: 'Balans', hint: 'Följer planen men hittar på detaljer', icon: 'balance' },
  { value: 'free', label: 'Fri', hint: 'Får ta ut svängarna och överraska', icon: 'explore' },
];

// ── Dela upp författarens början i kapitel ──

export const HEADING_RE = /^(prolog|epilog|förord|inledning|kapitel\s+\S+)(\s*[-–—:.]\s*.*)?$/i;

// Rubrikrad (även "# Kapitel 1" eller "**Prolog**") → rubriktext, annars null
export function headingText(line: string): string | null {
  const t = line.trim().replace(/^#{1,6}\s+/, '').replace(/^\*\*(.+)\*\*$/, '$1').trim();
  if (!t || t.length > 90) return null;
  return HEADING_RE.test(t) ? t : null;
}

export function splitBeginning(raw: string): { title: string; text: string }[] {
  const lines = raw.replace(/\r\n?/g, '\n').split('\n');
  const before: string[] = [];
  const parts: { title: string; lines: string[] }[] = [];
  for (const line of lines) {
    const heading = headingText(line);
    if (heading) {
      parts.push({ title: heading, lines: [] });
      continue;
    }
    (parts.length ? parts[parts.length - 1].lines : before).push(line);
  }
  const clean = (ls: string[]) => ls.join('\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  const result: { title: string; text: string }[] = [];
  const beforeText = clean(before);
  // Text före första rubriken blir "Inledning". Utan rubriker alls är allt kapitel 1.
  if (beforeText) result.push({ title: parts.length ? 'Inledning' : 'Kapitel 1', text: beforeText });
  for (const p of parts) result.push({ title: p.title, text: clean(p.lines) });
  return result;
}

// ── Kapitelnumrering i författarens stil ──

const WORD_NUMBERS = ['noll', 'ett', 'två', 'tre', 'fyra', 'fem', 'sex', 'sju', 'åtta', 'nio', 'tio', 'elva', 'tolv', 'tretton', 'fjorton', 'femton', 'sexton', 'sjutton', 'arton', 'nitton', 'tjugo'];
const NUMBER_RE = /^(\s*kapitel\s+)(\S+?)(?=$|\s|[-–—:.,])/i;

interface NumberInfo { prefix: string; n: number; words: boolean; capital: boolean }

function numberInfo(title: string): NumberInfo | null {
  const m = title.match(NUMBER_RE);
  if (!m) return null;
  const token = m[2];
  if (/^\d+$/.test(token)) return { prefix: m[1], n: parseInt(token, 10), words: false, capital: false };
  const i = WORD_NUMBERS.indexOf(token.toLowerCase());
  if (i > 0) return { prefix: m[1], n: i, words: true, capital: token[0] !== token[0].toLowerCase() };
  return null;
}

function formatNumber(n: number, style: NumberInfo | null): string {
  if (style?.words && n < WORD_NUMBERS.length) {
    const w = WORD_NUMBERS[n];
    return style.capital ? w[0].toUpperCase() + w.slice(1) : w;
  }
  return String(n);
}

// Nästa kapiteltitlar efter de befintliga: "Kapitel 1 - Försvinnandet" → "Kapitel 2", "Kapitel 3"...
export function continueTitles(existing: string[], count: number): string[] {
  let last: NumberInfo | null = null;
  for (const t of existing) last = numberInfo(t) ?? last;
  const prefix = last ? last.prefix.trim().replace(/\s+/g, ' ') : 'Kapitel';
  let n = last?.n ?? 0;
  return Array.from({ length: Math.max(0, count) }, () => `${prefix} ${formatNumber(++n, last)}`);
}

// Numrerar om "Kapitel N" i ordning - bara om författaren numrerade i följd innan ändringen
export function renumber(before: TimelineChapter[], after: TimelineChapter[]): TimelineChapter[] {
  const infos = before.map(c => numberInfo(c.title)).filter((x): x is NumberInfo => !!x);
  if (infos.length === 0) return after;
  const sequential = infos.every((info, i) => info.n === infos[0].n + i);
  if (!sequential) return after;
  let n = infos[0].n;
  const style = infos[0];
  return after.map(c => {
    if (!numberInfo(c.title)) return c;
    const title = c.title.replace(NUMBER_RE, (_m, pre: string) => `${pre}${formatNumber(n, style)}`);
    n++;
    return title === c.title ? c : { ...c, title };
  });
}

export function newPlannedChapter(title: string, notes = ''): TimelineChapter {
  return { id: newId(), title, notes, text: '', source: 'ai', status: 'planned', history: [] };
}

// Titel för ett kapitel som läggs in på plats `index` (renumber() rättar resten)
export function insertTitle(chapters: TimelineChapter[], index: number): string {
  const earlier = chapters.slice(0, index).map(c => c.title);
  const hasNumbers = chapters.some(c => numberInfo(c.title));
  return hasNumbers || chapters.length === 0 ? continueTitles(earlier, 1)[0] : 'Nytt kapitel';
}

// ── Historik ──

export const HISTORY_MAX = 10;

export function pushHistory(history: string[], text: string): string[] {
  if (!text.trim()) return history;
  if (history[history.length - 1] === text) return history;
  return [...history, text].slice(-HISTORY_MAX);
}

// Ny text med föregående version sparad i historiken
export function withText(ch: TimelineChapter, text: string, patch: Partial<TimelineChapter> = {}): TimelineChapter {
  return {
    ...ch,
    ...patch,
    text,
    status: text.trim() ? 'written' : 'planned',
    history: ch.text !== text ? pushHistory(ch.history, ch.text) : ch.history,
    updatedAt: nowIso(),
  };
}

// ── API-kontext ──

export function buildContext(p: FinishProject): ProjectContext {
  return {
    title: p.title,
    premise: p.premise,
    ending: p.ending?.trim() || undefined,
    voice: p.voice ? voicePayload(p.voice) : undefined,
    settings: p.settings,
    chapters: p.chapters.map(c => ({
      id: c.id,
      title: c.title,
      notes: c.notes,
      text: c.status === 'written' ? c.text : '',
      source: c.source,
    })),
  };
}

export function voicePayload(voice: AuthorVoice): Pick<AuthorVoice, 'profile' | 'samples'> {
  const profile = normalizeProfile(voice.profile);
  const clean = (items: string[]) => items.map(s => s.replace(/^[-•*]\s+/, '').trim()).filter(Boolean);
  return {
    profile: { ...profile, signatureMoves: clean(profile.signatureMoves), avoid: clean(profile.avoid) },
    samples: voice.samples.filter(s => s.trim()),
  };
}

export function rewriteProject(p: FinishProject): RewriteRequest['project'] {
  const { title, premise, voice, settings } = buildContext(p);
  return { title, premise, voice, settings };
}

// Tidslinjesvar → kapitel. Skriver aldrig över kapitel som har text (bara tomma anteckningar).
export function applyTimeline(chapters: TimelineChapter[], items: TimelineResponse['chapters']): TimelineChapter[] {
  const next = chapters.map(c => ({ ...c }));
  for (const item of items || []) {
    if (!item || typeof item.title !== 'string') continue;
    const target = item.id ? next.find(c => c.id === item.id) : undefined;
    if (target) {
      if (target.status === 'planned') {
        target.title = item.title.trim() || target.title;
        target.notes = typeof item.notes === 'string' ? item.notes.trim() : target.notes;
      } else if (!target.notes.trim() && item.notes) {
        target.notes = item.notes.trim();
      }
    } else {
      next.push(newPlannedChapter(item.title.trim() || continueTitles(next.map(c => c.title), 1)[0], (item.notes || '').trim()));
    }
  }
  return next;
}

export function manuscriptText(chapters: TimelineChapter[]): string {
  return chapters
    .filter(c => c.text.trim())
    .map(c => `${c.title.trim()}\n\n${c.text.trim()}`)
    .join('\n\n');
}

export function projectStats(p: FinishProject) {
  const written = p.chapters.filter(c => c.status === 'written').length;
  const words = p.chapters.reduce((sum, c) => sum + countWords(c.text), 0);
  return { written, total: p.chapters.length, words, planned: p.chapters.length - written };
}

// ── Författarspråk ──

export const PROFILE_FIELDS: { key: Exclude<keyof VoiceProfile, 'summary' | 'tense' | 'signatureMoves' | 'avoid'>; label: string; placeholder: string }[] = [
  { key: 'perspective', label: 'Perspektiv', placeholder: 'T.ex. tredje person, nära Otis' },
  { key: 'sentenceRhythm', label: 'Meningsrytm', placeholder: 'Korta och långa meningar om vartannat...' },
  { key: 'dialogue', label: 'Repliker', placeholder: 'Hur repliker skrivs och taggas' },
  { key: 'dialogueMarker', label: 'Replikmarkör', placeholder: 'T.ex. "* " eller "– "' },
  { key: 'vocabulary', label: 'Ordval', placeholder: 'Vardagligt, konkret...' },
  { key: 'emotions', label: 'Känslor', placeholder: 'Visas genom kroppen snarare än att sägas...' },
  { key: 'details', label: 'Detaljer', placeholder: 'Vilka detaljer författaren väljer' },
  { key: 'humor', label: 'Humor', placeholder: 'Torr, varm, sällsynt...' },
  { key: 'pacing', label: 'Tempo', placeholder: 'Hur fort berättelsen rör sig' },
];

export const TENSE_OPTIONS: VoiceProfile['tense'][] = ['presens', 'preteritum', 'blandat'];

export function normalizeProfile(p: Partial<VoiceProfile> | undefined): VoiceProfile {
  const s = (v: unknown) => (typeof v === 'string' ? v : '');
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  return {
    summary: s(p?.summary),
    tense: p?.tense && TENSE_OPTIONS.includes(p.tense) ? p.tense : 'blandat',
    perspective: s(p?.perspective),
    sentenceRhythm: s(p?.sentenceRhythm),
    dialogue: s(p?.dialogue),
    dialogueMarker: s(p?.dialogueMarker),
    vocabulary: s(p?.vocabulary),
    emotions: s(p?.emotions),
    details: s(p?.details),
    humor: s(p?.humor),
    pacing: s(p?.pacing),
    signatureMoves: list(p?.signatureMoves),
    avoid: list(p?.avoid),
  };
}

export function voiceFromResponse(v: { name?: string; profile?: Partial<VoiceProfile>; samples?: string[] }, fallbackName: string, sourceTitle?: string): AuthorVoice {
  return {
    id: newId(),
    name: v.name?.trim() || fallbackName,
    profile: normalizeProfile(v.profile),
    samples: Array.isArray(v.samples) ? v.samples.filter(s => typeof s === 'string' && s.trim()) : [],
    sourceTitle,
    createdAt: nowIso(),
  };
}

// Författarens egen text (för att analysera språket igen)
export function authorText(chapters: TimelineChapter[]): string {
  return manuscriptText(chapters.filter(c => c.source === 'author'));
}

export function errorText(err: unknown, fallback: string): string {
  if (err instanceof TypeError && /fetch|network|load failed/i.test(err.message)) return 'Ingen kontakt med servern – kontrollera uppkopplingen och försök igen';
  return err instanceof Error && err.message ? err.message : fallback;
}
