'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { BookProject } from '@/lib/types';
import { fetchJob, IllustrationJob } from '@/lib/job-client';
import { DEFAULT_VOICE_ID, NARRATOR_VOICES } from '@/lib/tts-voices';
import Icon from './Icon';

// ── Formen på det servern svarar med ──

interface AudioPart {
  label: string;
  url: string;
  seconds: number;
  // Kapitlets plats i boken - saknas i äldre manifest
  index?: number;
}

// Ett kapitel som går att läsa in för sig. url finns när det redan är inläst.
interface Chapter {
  index: number;
  label: string;
  characters: number;
  seconds: number;
  url?: string;
  // Inläst, men texten eller uttalslistan har ändrats sedan dess
  stale?: boolean;
}

// Uttalsregel: ordet i boken och hur rösten ska säga det
interface PronunciationRule {
  word: string;
  sayAs: string;
}

// I vilka kapitel ordet förekommer
interface PronunciationUsage {
  word: string;
  chapters: { index: number; label: string }[];
}

interface Audiobook {
  bookId: string;
  title: string;
  voice: string;
  voiceId: string;
  seconds: number;
  createdAt: string;
  parts: AudioPart[];
}

interface Estimate {
  segments: number;
  characters: number;
  seconds: number;
}

interface Props {
  // Boken i molnet (behövs för att skapa hela ljudboken)
  bookId?: string;
  // Boken i minnet - används till provlyssning när den inte är sparad i molnet
  book?: BookProject;
  title: string;
  // Falskt när boken inte ligger i molnet - då går bara provlyssning att göra
  canCreate: boolean;
  // Anropas när servern säger att ljudbok inte är påslaget (503)
  onUnavailable?: () => void;
  // Visar en stängknapp när panelen går att fälla ihop
  onClose?: () => void;
}

const POLL_MS = 5000;

// ── Små hjälpare för tid och tal ──

// Speltid i listan: 4:07
function clock(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Längre tider i text: "52 minuter", "2 timmar och 5 minuter"
function spokenDuration(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 90) return `${minutes} ${minutes === 1 ? 'minut' : 'minuter'}`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const hourText = `${hours} ${hours === 1 ? 'timme' : 'timmar'}`;
  if (rest === 0) return hourText;
  return `${hourText} och ${rest} ${rest === 1 ? 'minut' : 'minuter'}`;
}

const thousands = (n: number) => n.toLocaleString('sv-SE');

// Ljudjobbet lägger mp3-adressen i imageUrl och sekunderna i quality
const itemSeconds = (quality: unknown): number =>
  typeof quality === 'object' && quality !== null && typeof (quality as { seconds?: unknown }).seconds === 'number'
    ? (quality as { seconds: number }).seconds
    : 0;

// Boken kan innehålla stora base64-bilder - provlyssningen behöver bara texten
function bookForPreview(book: BookProject) {
  return {
    title: book.title,
    author: book.author,
    spreads: book.spreads.map(s => ({
      id: s.id,
      spreadNumber: s.spreadNumber,
      pages: s.pages,
      chapter: s.chapter,
      textBlocks: s.textBlocks,
      imagePrompt: '',
      status: 'done' as const,
    })),
  };
}

const jobKey = (bookId: string) => `barnbok:ljudjobb:${bookId}`;

// Är uppläsning påslagen på servern? Anropet utan bookId startar inget jobb, det
// svarar bara 503 när nyckeln saknas. Svaret sparas så att vi frågar en gång.
let ttsOffCheck: Promise<boolean> | null = null;
function ttsIsOff(): Promise<boolean> {
  if (!ttsOffCheck) {
    ttsOffCheck = fetch('/api/audio/book', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }).then(res => res.status === 503).catch(() => false);
  }
  return ttsOffCheck;
}

export default function AudiobookPanel({ bookId, book, title, canCreate, onUnavailable, onClose }: Props) {
  const [loading, setLoading] = useState(true);
  const [audiobook, setAudiobook] = useState<Audiobook | null>(null);
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  // Kryssade kapitel i listan
  const [selected, setSelected] = useState<number[]>([]);
  // Visar röst och läge igen när boken redan har delar inlästa
  const [showVoice, setShowVoice] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState('');

  const [voiceId, setVoiceId] = useState(DEFAULT_VOICE_ID);
  // 'best' = bästa uttalet, 'economy' = halva kvoten hos ElevenLabs
  const [quality, setQuality] = useState<'best' | 'expressive' | 'economy'>('best');
  // Röstprov: några sekunder av vald röst, så att valet går att höra
  const [sampleId, setSampleId] = useState('');
  const [customVoice, setCustomVoice] = useState('');
  const sampleRef = useRef<HTMLAudioElement>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewUrl, setPreviewUrl] = useState('');
  const [previewVoice, setPreviewVoice] = useState('');

  const [starting, setStarting] = useState(false);
  const [job, setJob] = useState<IllustrationJob | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  // Vilka kapitel jobbet gäller (tomt = hela boken), och namnet när det bara är ett
  const [jobSegments, setJobSegments] = useState<number[]>([]);
  const [jobLabel, setJobLabel] = useState('');

  const [partIndex, setPartIndex] = useState(0);
  const playerRef = useRef<HTMLAudioElement>(null);
  // Sant när nästa del ska börja spela av sig själv (klick i listan eller slutet på förra delen)
  const autoPlay = useRef(false);

  // Uttalslistan: ord som rösten ska säga på ett annat sätt
  const [pronOpen, setPronOpen] = useState(false);
  const [rules, setRules] = useState<PronunciationRule[]>([]);
  const [usage, setUsage] = useState<PronunciationUsage[]>([]);
  const [pronSaving, setPronSaving] = useState(false);
  const [pronError, setPronError] = useState('');
  const [pronSaved, setPronSaved] = useState(false);
  const [newWord, setNewWord] = useState('');
  const [newSayAs, setNewSayAs] = useState('');
  // Vad som läses upp just nu ('ny' = formuläret, annars regelns ord) och meningen som lästes
  const [sayingKey, setSayingKey] = useState<string | null>(null);
  const [heard, setHeard] = useState<{ key: string; sentence: string } | null>(null);
  const sayRef = useRef<HTMLAudioElement>(null);
  const sayUrl = useRef('');
  useEffect(() => () => { if (sayUrl.current) URL.revokeObjectURL(sayUrl.current); }, []);

  // Städa bort provlyssningens blob-adress när panelen stängs
  useEffect(() => () => { if (previewUrl.startsWith('blob:')) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  const loadAudiobook = useCallback(async (): Promise<Audiobook | null> => {
    if (!bookId) return null;
    const res = await fetch(`/api/audio/book?bookId=${encodeURIComponent(bookId)}`, { cache: 'no-store' });
    if (!res.ok) throw new Error('Kunde inte hämta ljudboken just nu');
    const data = await res.json() as { audiobook: Audiobook | null; estimate: Estimate | null; chapters?: Chapter[] };
    setAudiobook(data.audiobook);
    setEstimate(data.estimate);
    setChapters(data.chapters || []);
    // Kapitel som blivit inlästa ska inte ligga kvar kryssade
    setSelected(prev => prev.filter(i => !(data.chapters || []).some(c => c.index === i && c.url)));
    if (data.audiobook?.voiceId) setVoiceId(data.audiobook.voiceId);
    return data.audiobook;
  }, [bookId]);

  // Första hämtningen: finns ljudboken redan, och är funktionen påslagen?
  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    Promise.all([ttsIsOff(), loadAudiobook().catch(() => null)])
      .then(([off]) => {
        if (cancelled) return;
        if (off) {
          setUnavailable(true);
          onUnavailable?.();
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId]);

  // Uttalslistan hämtas direkt, så att antalet regler syns på knappen
  useEffect(() => {
    if (!bookId || !canCreate) return;
    let cancelled = false;
    fetch(`/api/audio/pronunciations?bookId=${encodeURIComponent(bookId)}`, { cache: 'no-store' })
      .then(res => (res.ok ? res.json() : null))
      .then((data: { rules?: PronunciationRule[]; usage?: PronunciationUsage[] } | null) => {
        if (cancelled || !data) return;
        setRules(data.rules || []);
        setUsage(data.usage || []);
      })
      .catch(() => { /* listan går att öppna ändå - den är då tom */ });
    return () => { cancelled = true; };
  }, [bookId, canCreate]);

  // Ett jobb som redan var igång när sidan laddades om
  useEffect(() => {
    if (!bookId) return;
    let saved: string | null = null;
    try { saved = localStorage.getItem(jobKey(bookId)); } catch { saved = null; }
    if (!saved) return;
    let cancelled = false;
    fetchJob(saved)
      .then(fresh => {
        if (cancelled || !fresh) return;
        if (fresh.status === 'running') {
          setJob(fresh);
          setJobId(saved);
        } else {
          try { localStorage.removeItem(jobKey(bookId)); } catch { /* lagring blockerad */ }
        }
      })
      .catch(() => { /* nätverksglapp - jobbet hittas igen vid nästa försök */ });
    return () => { cancelled = true; };
  }, [bookId]);

  // ── Polla jobbet medan ljudboken görs ──
  useEffect(() => {
    if (!jobId) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      try {
        const fresh = await fetchJob(jobId);
        if (stopped) return;
        if (fresh) {
          setJob(fresh);
          if (fresh.status !== 'running') {
            setJobId(null);
            if (bookId) { try { localStorage.removeItem(jobKey(bookId)); } catch { /* lagring blockerad */ } }
            if (fresh.status === 'failed') {
              setError(fresh.message || 'Uppläsningen avbröts. Försök gärna igen.');
            }
            // Hämta den färdiga innehållsförteckningen
            await loadAudiobook().catch(() => null);
            return;
          }
        }
      } catch {
        // Nätverksglapp - försök igen vid nästa varv
      }
      if (!stopped) timer = setTimeout(tick, POLL_MS);
    };

    timer = setTimeout(tick, POLL_MS);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [jobId, bookId, loadAudiobook]);

  // ── Provlyssning ──
  const playPreview = async () => {
    setError('');
    setPreviewing(true);
    if (previewUrl) {
      if (previewUrl.startsWith('blob:')) URL.revokeObjectURL(previewUrl);
      setPreviewUrl('');
    }
    try {
      // Sparad bok: provet ligger kvar i molnet och spelas som en vanlig adress,
      // så samma prov kostar aldrig något en andra gång
      if (bookId) {
        const url = `/api/audio/preview?bookId=${encodeURIComponent(bookId)}&voiceId=${encodeURIComponent(voiceId)}&quality=${quality}`;
        const head = await fetch(url, { method: 'GET' });
        if (!head.ok) {
          const data = await head.json().catch(() => null) as { error?: string } | null;
          if (head.status === 503) { setUnavailable(true); onUnavailable?.(); return; }
          throw new Error(data?.error || 'Provlyssningen gick inte att göra just nu');
        }
        setPreviewVoice(head.headers.get('X-Voice') || '');
        setPreviewUrl(url);
        return;
      }

      const body: Record<string, unknown> = { voiceId, quality };
      if (book) body.book = bookForPreview(book);
      else throw new Error('Hittade ingen text att läsa upp');

      const res = await fetch('/api/audio/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null) as { error?: string } | null;
        if (res.status === 503) {
          setUnavailable(true);
          onUnavailable?.();
          return;
        }
        throw new Error(data?.error || 'Provlyssningen gick inte att göra just nu');
      }

      const blob = await res.blob();
      setPreviewVoice(res.headers.get('X-Voice') || '');
      setPreviewUrl(URL.createObjectURL(blob));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Provlyssningen gick inte att göra just nu');
    } finally {
      setPreviewing(false);
    }
  };

  // ── Starta uppläsningen: hela boken, eller bara de kapitel som skickas med ──
  const startJob = async (segments?: number[]) => {
    if (!bookId) return;
    setError('');
    setStarting(true);
    const wanted = segments?.length ? segments : [];
    setJobSegments(wanted);
    setJobLabel(wanted.length === 1 ? chapters.find(c => c.index === wanted[0])?.label || '' : '');
    try {
      const res = await fetch('/api/audio/book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(wanted.length ? { bookId, voiceId, quality, segments: wanted } : { bookId, voiceId, quality }),
      });
      const data = await res.json().catch(() => null) as { jobId?: string; total?: number; error?: string } | null;
      if (res.status === 503) {
        setUnavailable(true);
        onUnavailable?.();
        return;
      }
      if (!res.ok || !data?.jobId) throw new Error(data?.error || 'Kunde inte starta ljudboken');

      setJobId(data.jobId);
      setJob({
        id: data.jobId,
        bookId,
        status: 'running',
        total: data.total || 0,
        done: 0,
        failed: 0,
        updatedAt: new Date().toISOString(),
        items: [],
      });
      setSelected([]);
      try { localStorage.setItem(jobKey(bookId), data.jobId); } catch { /* lagring blockerad */ }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kunde inte starta ljudboken');
    } finally {
      setStarting(false);
    }
  };

  // ── Rätta uttal ──
  const sameWord = (a: string, b: string) => a.trim().toLocaleLowerCase('sv-SE') === b.trim().toLocaleLowerCase('sv-SE');

  // Läser upp första meningen i boken där ordet står, med det nya uttalet
  const sayWord = async (key: string, word: string, sayAs: string) => {
    if (!bookId || !word.trim()) return;
    setPronError('');
    setSayingKey(key);
    setHeard(null);
    try {
      const res = await fetch('/api/audio/say', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookId, word: word.trim(), sayAs: sayAs.trim() || word.trim(), voiceId, quality }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null) as { error?: string } | null;
        throw new Error(data?.error || 'Kunde inte läsa upp ordet just nu');
      }
      const blob = await res.blob();
      let sentence = '';
      try { sentence = decodeURIComponent(res.headers.get('X-Sentence') || ''); } catch { sentence = ''; }
      if (sayUrl.current) URL.revokeObjectURL(sayUrl.current);
      sayUrl.current = URL.createObjectURL(blob);
      setHeard({ key, sentence });
      const player = sayRef.current;
      if (player) {
        player.src = sayUrl.current;
        await player.play().catch(() => { /* webbläsaren kan kräva ett klick till */ });
      }
    } catch (err) {
      setPronError(err instanceof Error ? err.message : 'Kunde inte läsa upp ordet just nu');
    } finally {
      setSayingKey(null);
    }
  };

  // Hela listan skickas varje gång och ersätter den gamla
  const saveRules = async (next: PronunciationRule[]): Promise<boolean> => {
    if (!bookId) return false;
    setPronSaving(true);
    setPronError('');
    setPronSaved(false);
    try {
      const res = await fetch('/api/audio/pronunciations', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookId, rules: next }),
      });
      const data = await res.json().catch(() => null) as { rules?: PronunciationRule[]; usage?: PronunciationUsage[]; error?: string } | null;
      if (!res.ok || !data) throw new Error(data?.error || 'Uttalslistan kunde inte sparas');
      setRules(data.rules || []);
      setUsage(data.usage || []);
      setPronSaved(true);
      // Kapitel som läses med det gamla uttalet märks som ändrade
      await loadAudiobook().catch(() => null);
      return true;
    } catch (err) {
      setPronError(err instanceof Error ? err.message : 'Uttalslistan kunde inte sparas');
      return false;
    } finally {
      setPronSaving(false);
    }
  };

  const addRule = async () => {
    const word = newWord.trim();
    const sayAs = newSayAs.trim();
    if (!word || !sayAs) {
      setPronError('Skriv både ordet och hur det ska låta.');
      return;
    }
    if (word === sayAs) {
      setPronError('Skriv ordet på ett annat sätt, så som det ska låta.');
      return;
    }
    // Samma ord igen ersätter den gamla regeln
    const ok = await saveRules([...rules.filter(r => !sameWord(r.word, word)), { word, sayAs }]);
    if (ok) {
      setNewWord('');
      setNewSayAs('');
      if (heard?.key === 'ny') setHeard(null);
    }
  };

  const removeRule = (word: string) => {
    if (heard?.key === word) setHeard(null);
    void saveRules(rules.filter(r => !sameWord(r.word, word)));
  };

  const editRule = (rule: PronunciationRule) => {
    setNewWord(rule.word);
    setNewSayAs(rule.sayAs);
    setPronError('');
  };

  const usageFor = (word: string) => usage.find(u => sameWord(u.word, word))?.chapters;

  // ── Delar att spela: den färdiga ljudboken, annars det jobbet hunnit läsa in ──
  const liveParts: AudioPart[] = (job?.items || [])
    .filter(i => i.status === 'done' && i.imageUrl)
    .map(i => ({
      label: i.label || `Del ${i.spreadNumber + 1}`,
      url: i.imageUrl as string,
      seconds: itemSeconds(i.quality),
      index: i.spreadNumber,
    }));

  // Manifestet först, plus de delar jobbet hunnit bli klart med men som inte
  // hämtats hem ännu. Kapitel som läses om ersätter den gamla delen.
  const manifestParts: AudioPart[] = audiobook?.parts || [];
  const liveOnly = liveParts.filter(p => !manifestParts.some(m => m.index === p.index || m.url === p.url));
  const parts: AudioPart[] = [...manifestParts, ...liveOnly].sort((a, b) =>
    typeof a.index === 'number' && typeof b.index === 'number' ? a.index - b.index : 0
  );
  const current = parts[Math.min(partIndex, parts.length - 1)];
  const totalSeconds = parts.reduce((n, p) => n + p.seconds, 0);
  const running = job?.status === 'running';

  const selectPart = (index: number) => {
    autoPlay.current = true;
    setPartIndex(index);
  };

  // Hoppa till ett inläst kapitel i spelaren
  const playChapter = (chapterIndex: number) => {
    const at = parts.findIndex(p => p.index === chapterIndex);
    if (at >= 0) selectPart(at);
  };

  const toggleChapter = (chapterIndex: number, on: boolean) =>
    setSelected(prev => (on ? [...prev, chapterIndex] : prev.filter(i => i !== chapterIndex)));

  // Snabbläget kostar halva kvoten hos ElevenLabs
  const credits = (characters: number) => (quality === 'economy' ? Math.round(characters / 2) : characters);

  const doneChapters = chapters.filter(c => c.url);
  // Inlästa kapitel där texten eller uttalet ändrats sedan inläsningen
  const staleChapters = doneChapters.filter(c => c.stale);
  const staleCharacters = staleChapters.reduce((n, c) => n + c.characters, 0);
  const leftChapters = chapters.filter(c => !c.url);
  const leftCharacters = leftChapters.reduce((n, c) => n + c.characters, 0);
  const leftSeconds = leftChapters.reduce((n, c) => n + c.seconds, 0);
  const allRead = chapters.length > 0 && leftChapters.length === 0;
  const selectedChapters = chapters.filter(c => selected.includes(c.index));
  const selectedCharacters = selectedChapters.reduce((n, c) => n + c.characters, 0);
  const showChapters = Boolean(canCreate && bookId) && chapters.length > 0;
  const showPronunciation = Boolean(canCreate && bookId);
  // Röst och läge behövs så länge det finns något kvar att läsa in
  const showSetup = !running && !allRead;
  const settingsOpen = parts.length === 0 || showVoice;

  // Vilka kapitel jobbet gäller. Efter en omladdning vet vi det först när
  // jobbets rader hämtats, innan dess litar vi på vad vi själva startade.
  const jobChapters = job?.items?.length ? job.items.map(i => i.spreadNumber) : jobSegments;

  // Progresstexten ska stämma både för hela boken och för ett enda kapitel
  const jobTotal = job?.total || 0;
  const jobRunningItem = (job?.items || []).find(i => i.status === 'running');
  const progressText = jobTotal === 1
    ? `Läser upp ${jobRunningItem?.label || jobLabel || 'kapitlet'}`
    : `Läser upp kapitel ${Math.min((job?.done || 0) + 1, jobTotal || 1)} av ${jobTotal}`;

  // Byt ljudfil och starta den när man valt en del själv eller förra delen tog slut
  useEffect(() => {
    const el = playerRef.current;
    if (!el || !autoPlay.current) return;
    autoPlay.current = false;
    el.play().catch(() => { /* webbläsaren kan kräva ett klick - spelaren står redo */ });
  }, [partIndex, current?.url]);

  // Läser om de inlästa kapitel som inte längre stämmer med texten eller uttalet
  const rereadStaleButton = (
    <button
      onClick={() => startJob(staleChapters.map(c => c.index))}
      disabled={running || starting || staleChapters.length === 0}
      className="btn-action !py-2 !text-sm shrink-0"
      title={`Cirka ${thousands(credits(staleCharacters))} krediter`}
    >
      {starting ? <span className="spinner !w-4 !h-4" /> : <Icon name="refresh" size={17} />}
      Läs om ändrade kapitel ({staleChapters.length})
    </button>
  );

  const onPartEnded = () => {
    if (partIndex + 1 < parts.length) selectPart(partIndex + 1);
  };

  // ════════════════════════════════════════════
  //  Vyer
  // ════════════════════════════════════════════

  if (loading) {
    return (
      <div className="glass rounded-4xl p-5 sm:p-6">
        <div className="space-y-2" aria-label="Hämtar ljudboken">
          <div className="skeleton h-4 w-40 !rounded-md" />
          <div className="skeleton h-4 w-full !rounded-md" />
          <div className="skeleton h-4 w-2/3 !rounded-md" />
        </div>
      </div>
    );
  }

  if (unavailable) {
    return (
      <div className="glass rounded-4xl p-5 sm:p-6">
        <p className="eyebrow">Kommer snart</p>
        <h3 className="mt-1 text-xl font-heading font-bold text-ink">Ljudbok</h3>
        <p className="mt-2 text-sm text-ink/65 leading-relaxed">
          Snart kan <span className="font-semibold text-ink">{title}</span> läsas upp med en naturlig svensk röst.
          Uppläsningen är inte påslagen här ännu.
        </p>
      </div>
    );
  }

  const voice = NARRATOR_VOICES.find(v => v.id === voiceId);

  // Väljer röst och spelar upp provet direkt
  const playSample = (id: string, mode: 'best' | 'expressive' | 'economy') => {
    setSampleId(id);
    const player = sampleRef.current;
    if (!player) return;
    player.src = `/api/audio/voice-sample?voiceId=${encodeURIComponent(id)}&quality=${mode}`;
    player.play().catch(() => setError('Kunde inte spela upp röstprovet'));
  };

  const chooseVoice = (id: string) => {
    setVoiceId(id);
    playSample(id, quality);
  };

  // Byter man läge spelas samma röst upp igen, så skillnaden hörs direkt
  const changeQuality = (mode: 'best' | 'expressive' | 'economy') => {
    setQuality(mode);
    if (sampleId) playSample(sampleId, mode);
  };

  return (
    <div className="glass rounded-4xl p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <div className="hidden sm:flex w-12 h-12 shrink-0 rounded-2xl bg-ink items-center justify-center text-white shadow-soft">
          <Icon name="headphones" filled size={24} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="eyebrow">Ljudbok</p>
          <h3 className="mt-1 text-xl font-heading font-bold text-ink leading-tight break-words">{title}</h3>
          {parts.length > 0 && !running && (
            <p className="mt-1 text-sm text-ink/55">
              {parts.length} {parts.length === 1 ? 'del' : 'delar'} · {spokenDuration(totalSeconds)}
              {audiobook?.voice ? ` · uppläst av ${audiobook.voice}` : ''}
            </p>
          )}
        </div>
        {onClose && (
          <button onClick={onClose} className="btn-icon shrink-0 -mr-1 -mt-1" title="Dölj ljudboken" aria-label="Dölj ljudboken">
            <Icon name="close" size={20} />
          </button>
        )}
      </div>

      {/* ─── Jobbet kör ─── */}
      {running && (
        <div className="mt-5">
          <div className="flex items-center gap-2 text-sm font-medium text-ink">
            <span className="spinner !w-4 !h-4 text-brand" />
            <span className="min-w-0 truncate">{progressText}</span>
          </div>
          {jobTotal > 1 && jobRunningItem?.label && (
            <p className="mt-1 text-xs text-ink/55 truncate">{jobRunningItem.label}</p>
          )}
          <div className="mt-2.5 h-1.5 w-full rounded-full bg-ink/10 overflow-hidden">
            <div
              className="h-full rounded-full bg-brand transition-all duration-500"
              style={{ width: `${job?.total ? Math.round(((job.done || 0) / job.total) * 100) : 0}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-ink/55">Du kan stänga sidan - uppläsningen görs klart i bakgrunden.</p>
        </div>
      )}

      {/* ─── Spelare: färdig ljudbok eller delar som redan blivit klara ─── */}
      {parts.length > 0 && current && (
        <div className="mt-5">
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <audio
            ref={playerRef}
            controls
            preload="none"
            src={current.url}
            onEnded={onPartEnded}
            className="w-full"
          >
            Din webbläsare kan inte spela upp ljud.
          </audio>
          <p className="mt-2 text-sm font-medium text-ink truncate">{current.label}</p>

          <ul className="mt-3 divide-y divide-line rounded-2xl border border-line overflow-hidden">
            {parts.map((part, i) => (
              <li key={`${part.url}-${i}`}>
                <button
                  onClick={() => selectPart(i)}
                  aria-current={i === partIndex}
                  className={`w-full flex items-center gap-3 px-3.5 py-2.5 text-left transition-colors ${
                    i === partIndex ? 'bg-paper' : 'bg-white hover:bg-paper'
                  }`}
                >
                  <Icon
                    name={i === partIndex ? 'play_circle' : 'play_arrow'}
                    filled={i === partIndex}
                    size={20}
                    className={i === partIndex ? 'text-brand shrink-0' : 'text-ink/40 shrink-0'}
                  />
                  <span className="flex-1 min-w-0 text-sm font-medium text-ink truncate">{part.label}</span>
                  <span className="shrink-0 text-xs tabular-nums text-ink/50">{clock(part.seconds)}</span>
                </button>
              </li>
            ))}
          </ul>
          {running && <p className="mt-2 text-xs text-ink/55">Fler delar dyker upp här allt eftersom de blir klara.</p>}
        </div>
      )}

      {/* ─── Kapitel: läs in ett i taget eller flera på en gång ─── */}
      {showChapters && (
        <div className="mt-5">
          <div className="flex items-baseline justify-between gap-2">
            <h4 className="text-sm font-semibold text-ink">Kapitel</h4>
            <p className="text-xs text-ink/50 shrink-0">{doneChapters.length} av {chapters.length} inlästa</p>
          </div>
          {staleChapters.length > 0 && !running && (
            <div className="mt-2 note-warning flex flex-col gap-2 sm:flex-row sm:items-center">
              <p className="flex-1 text-sm">
                {staleChapters.length === 1 ? 'Ett inläst kapitel' : `${staleChapters.length} inlästa kapitel`} stämmer inte längre med texten eller uttalet.
              </p>
              {rereadStaleButton}
            </div>
          )}
          <ul className="mt-2 divide-y divide-line rounded-2xl border border-line overflow-hidden bg-white">
            {chapters.map(chapter => {
              const read = Boolean(chapter.url);
              // Hela boken läser bara in det som saknas, valda kapitel läses in eller om
              const inQueue = running && (jobChapters.length === 0 ? !read : jobChapters.includes(chapter.index));
              const stale = read && Boolean(chapter.stale);
              return (
                <li key={chapter.index} className="flex items-center gap-2.5 px-3 py-2.5">
                  <input
                    type="checkbox"
                    checked={selected.includes(chapter.index)}
                    onChange={e => toggleChapter(chapter.index, e.target.checked)}
                    disabled={running || starting}
                    aria-label={`Markera ${chapter.label}`}
                    className="w-4 h-4 shrink-0 accent-brand disabled:opacity-40"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-ink truncate">{chapter.label}</p>
                    <p className="text-[11px] text-ink/45 tabular-nums">
                      {clock(chapter.seconds)} · {thousands(chapter.characters)} tecken
                      {inQueue ? ' · Läses in' : read ? ' · Inläst' : ''}
                    </p>
                    {stale && !inQueue && (
                      <p className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-medium text-amber-700">
                        <Icon name="error" size={13} /> Texten eller uttalet har ändrats
                      </p>
                    )}
                  </div>
                  {read ? (
                    <>
                      <button
                        onClick={() => playChapter(chapter.index)}
                        className="btn-icon shrink-0"
                        title={`Spela ${chapter.label}`}
                        aria-label={`Spela ${chapter.label}`}
                      >
                        <Icon name="play_arrow" size={20} />
                      </button>
                      <button
                        onClick={() => startJob([chapter.index])}
                        disabled={running || starting}
                        className={`btn-icon shrink-0 disabled:opacity-40 ${stale ? 'text-amber-700' : ''}`}
                        title={`Läs om ${chapter.label}`}
                        aria-label={`Läs om ${chapter.label}`}
                      >
                        <Icon name="refresh" size={19} />
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => startJob([chapter.index])}
                      disabled={running || starting}
                      className="btn-ghost !py-1.5 !px-2.5 !text-xs shrink-0 disabled:opacity-40"
                    >
                      {inQueue ? <span className="spinner !w-3.5 !h-3.5" /> : <Icon name="graphic_eq" size={15} />}
                      Läs in
                    </button>
                  )}
                </li>
              );
            })}
          </ul>

          {selected.length > 0 && !running && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button onClick={() => startJob(selected)} disabled={starting} className="btn-action !py-2 !text-sm">
                {starting ? <span className="spinner !w-4 !h-4" /> : <Icon name="headphones" size={17} />}
                Läs in valda ({selected.length})
              </button>
              <button onClick={() => setSelected([])} className="btn-ghost !py-2 !text-sm">Avmarkera</button>
              <span className="text-xs text-ink/55">
                cirka {thousands(credits(selectedCharacters))} krediter
              </span>
            </div>
          )}
        </div>
      )}

      {/* ─── Rätta uttal: ord som rösten säger konstigt ─── */}
      {showPronunciation && (
        <div className="mt-5 rounded-2xl border border-line bg-white">
          <button
            onClick={() => setPronOpen(o => !o)}
            aria-expanded={pronOpen}
            aria-controls="ratta-uttal"
            className="w-full flex items-center gap-2.5 px-3.5 py-3 text-left"
          >
            <Icon name="record_voice_over" size={20} className="text-ink/55 shrink-0" />
            <span className="flex-1 min-w-0">
              <span className="block text-sm font-semibold text-ink">Rätta uttal</span>
              <span className="block text-xs text-ink/50">
                {rules.length === 0 ? 'Säger rösten ett ord konstigt? Rätta det här.' : `${rules.length} ord med eget uttal`}
              </span>
            </span>
            <Icon name={pronOpen ? 'expand_less' : 'expand_more'} size={22} className="text-ink/45 shrink-0" />
          </button>

          {pronOpen && (
            <div id="ratta-uttal" className="border-t border-line px-3.5 pb-4 pt-3 space-y-4">
              <p className="text-sm text-ink/65 leading-relaxed">
                Säger rösten ett ord konstigt? Skriv ordet och hur det ska låta, t.ex. <span className="font-medium text-ink">Gunbritt</span> → <span className="font-medium text-ink">Gunn-britt</span>. Det gäller hela boken, även med stor bokstav och genitiv-s.
              </p>

              {/* Befintliga regler */}
              {rules.length > 0 && (
                <ul className="divide-y divide-line rounded-2xl border border-line overflow-hidden">
                  {rules.map(rule => {
                    const found = usageFor(rule.word);
                    const saying = sayingKey === rule.word;
                    return (
                      <li key={rule.word} className="px-3 py-2.5">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                          <div className="min-w-0 flex-1 basis-40">
                            <p className="text-sm text-ink break-words">
                              <span className="font-semibold">{rule.word}</span>
                              <span className="text-ink/40"> → </span>
                              <span>{rule.sayAs}</span>
                            </p>
                            <p
                              className={`text-[11px] ${found && found.length === 0 ? 'text-amber-700' : 'text-ink/45'}`}
                              title={found?.map(c => c.label).join(', ') || undefined}
                            >
                              {!found ? '' : found.length === 0 ? 'Ordet finns inte i boken' : `i ${found.length} kapitel`}
                            </p>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              onClick={() => sayWord(rule.word, rule.word, rule.sayAs)}
                              disabled={sayingKey !== null}
                              className="btn-ghost !py-1.5 !px-2.5 !text-xs disabled:opacity-40"
                            >
                              {saying ? <span className="spinner !w-3.5 !h-3.5" /> : <Icon name="volume_up" size={15} />}
                              Hör
                            </button>
                            <button
                              onClick={() => editRule(rule)}
                              disabled={pronSaving}
                              className="btn-icon disabled:opacity-40"
                              title={`Ändra ${rule.word}`}
                              aria-label={`Ändra ${rule.word}`}
                            >
                              <Icon name="edit" size={18} />
                            </button>
                            <button
                              onClick={() => removeRule(rule.word)}
                              disabled={pronSaving}
                              className="btn-icon disabled:opacity-40"
                              title={`Ta bort ${rule.word}`}
                              aria-label={`Ta bort ${rule.word}`}
                            >
                              <Icon name="delete" size={18} />
                            </button>
                          </div>
                        </div>
                        {heard?.key === rule.word && heard.sentence && (
                          <p className="mt-1.5 text-xs text-ink/60 leading-relaxed">Läste: ”{heard.sentence}”</p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}

              {/* Ny regel */}
              <div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="block min-w-0">
                    <span className="text-xs font-medium text-ink/55">Ordet i boken</span>
                    <input
                      value={newWord}
                      onChange={e => setNewWord(e.target.value)}
                      placeholder="Gunbritt"
                      autoCapitalize="off"
                      autoCorrect="off"
                      spellCheck={false}
                      className="field !py-2 !text-sm mt-1"
                    />
                  </label>
                  <label className="block min-w-0">
                    <span className="text-xs font-medium text-ink/55">Säg som</span>
                    <input
                      value={newSayAs}
                      onChange={e => setNewSayAs(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') void addRule(); }}
                      placeholder="Gunn-britt"
                      autoCapitalize="off"
                      autoCorrect="off"
                      spellCheck={false}
                      className="field !py-2 !text-sm mt-1"
                    />
                  </label>
                </div>
                <div className="mt-2.5 flex flex-wrap gap-2">
                  <button
                    onClick={() => sayWord('ny', newWord, newSayAs)}
                    disabled={!newWord.trim() || sayingKey !== null}
                    className="btn-ghost !py-2 !text-sm disabled:opacity-40"
                  >
                    {sayingKey === 'ny' ? <span className="spinner !w-4 !h-4" /> : <Icon name="volume_up" size={17} />}
                    {sayingKey === 'ny' ? 'Läser upp...' : 'Hör hur det låter'}
                  </button>
                  <button
                    onClick={addRule}
                    disabled={pronSaving || !newWord.trim() || !newSayAs.trim()}
                    className="btn-action !py-2 !text-sm"
                  >
                    {pronSaving ? <span className="spinner !w-4 !h-4" /> : <Icon name="check" size={17} />}
                    {pronSaving ? 'Sparar...' : 'Spara'}
                  </button>
                </div>
                {heard?.key === 'ny' && heard.sentence && (
                  <p className="mt-2 text-xs text-ink/60 leading-relaxed">Läste: ”{heard.sentence}”</p>
                )}
                <p className="mt-2 text-[11px] text-ink/45 leading-snug">
                  Tips: bindestreck eller dubbla bokstäver brukar hjälpa (Plurrett), och du kan skriva ordet precis som det låter.
                  {' '}Hör kostar bara den mening som läses upp.
                </p>
              </div>

              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
              <audio ref={sayRef} className="hidden" />

              {pronSaved && !pronError && (
                staleChapters.length > 0 && !running ? (
                  <div className="note-warning flex flex-col gap-2 sm:flex-row sm:items-center">
                    <p className="flex-1 text-sm">
                      Sparat. {staleChapters.length === 1 ? 'Ett inläst kapitel' : `${staleChapters.length} inlästa kapitel`} läses fortfarande med det gamla uttalet.
                    </p>
                    {rereadStaleButton}
                  </div>
                ) : (
                  <p className="note-success text-sm">Uttalslistan är sparad och används nästa gång boken läses in.</p>
                )
              )}
              {pronError && <div className="note-error">{pronError}</div>}
            </div>
          )}
        </div>
      )}

      {/* ─── Röst, provlyssning och start ─── */}
      {showSetup && (
        <div className="mt-5 space-y-5">
          {!settingsOpen && (
            <button onClick={() => setShowVoice(true)} className="btn-ghost !py-2 !text-sm">
              <Icon name="tune" size={17} /> Byt röst eller läge
            </button>
          )}
          {settingsOpen && (
          <div>
            <h4 className="text-sm font-semibold text-ink">Välj uppläsning</h4>
            <div className="mt-2 flex flex-wrap gap-2">
              {([
                { id: 'best' as const, label: 'Naturlig', hint: 'lugn uppläsning · full kvot' },
                { id: 'expressive' as const, label: 'Levande', hint: 'mer inlevelse · full kvot' },
                { id: 'economy' as const, label: 'Snabb', hint: 'halva kvoten' },
              ]).map(option => (
                <button
                  key={option.id}
                  onClick={() => changeQuality(option.id)}
                  aria-pressed={quality === option.id}
                  className={`px-3 py-2 rounded-xl border text-xs font-medium transition-all ${
                    quality === option.id ? 'border-brand bg-brand/5 text-ink ring-2 ring-brand/15' : 'border-line bg-white text-ink/70 hover:border-ink/25'
                  }`}
                >
                  {option.label}
                  <span className="block text-[11px] font-normal text-ink/50">{option.hint}</span>
                </button>
              ))}
            </div>

            <h4 className="mt-5 text-sm font-semibold text-ink">Välj röst</h4>
            <p className="mt-0.5 text-xs text-ink/50">Klicka på en röst för att höra den. Byt läge ovanför och klicka igen, så hör du skillnaden på samma röst.</p>
            {([true, false]).map(native => (
            <div key={String(native)} className="mt-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink/40">
              {native ? 'Svenska röster' : 'Övriga röster (läser med brytning)'}
            </p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {NARRATOR_VOICES.filter(v => v.native === native).map(v => {
                const chosen = v.id === voiceId;
                return (
                  <button
                    key={v.id}
                    onClick={() => chooseVoice(v.id)}
                    aria-pressed={chosen}
                    className={`flex items-start gap-2.5 p-3 rounded-2xl border text-left transition-all active:scale-[0.99] ${
                      chosen ? 'border-brand bg-brand/5 ring-2 ring-brand/15' : 'border-line bg-white hover:border-ink/25'
                    }`}
                  >
                    <Icon
                      name={chosen ? 'check_circle' : 'graphic_eq'}
                      filled={chosen}
                      size={20}
                      className={chosen ? 'text-brand shrink-0 mt-0.5' : 'text-ink/35 shrink-0 mt-0.5'}
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-ink">{v.name}</span>
                      <span className="block text-xs text-ink/55 leading-snug">{v.description}</span>
                      <span className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-brand">
                        <Icon name={sampleId === v.id ? 'volume_up' : 'play_arrow'} size={13} />
                        {sampleId === v.id ? 'Spelar provet' : 'Hör rösten'}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
            </div>
            ))}

            <audio ref={sampleRef} onEnded={() => setSampleId('')} className="hidden" />

            <div className="mt-3 flex flex-col gap-1.5 sm:flex-row sm:items-center">
              <input
                value={customVoice}
                onChange={e => setCustomVoice(e.target.value.trim())}
                placeholder="Eget röst-id från ElevenLabs"
                aria-label="Eget röst-id från ElevenLabs"
                className="field !py-2 !text-sm sm:max-w-xs"
              />
              <button
                onClick={() => customVoice && chooseVoice(customVoice)}
                disabled={!customVoice}
                className="btn-ghost !py-2 !text-sm disabled:opacity-40"
              >
                <Icon name="play_arrow" size={16} /> Hör den rösten
              </button>
            </div>
            <p className="mt-1 text-[11px] text-ink/45 leading-snug">
              Hittar du en svensk röst i ElevenLabs röstbibliotek: lägg till den bland dina röster och klistra in dess röst-id här.
            </p>


          </div>
          )}

          <div className="flex flex-wrap gap-2">
            <button onClick={playPreview} disabled={previewing} className="btn-ghost">
              {previewing ? <span className="spinner !w-4 !h-4" /> : <Icon name="play_arrow" size={19} />}
              {previewing ? 'Läser in provet...' : 'Provlyssna första sidorna'}
            </button>
            {canCreate && bookId && (
              <button
                onClick={() => startJob(doneChapters.length > 0 ? leftChapters.map(c => c.index) : undefined)}
                disabled={starting}
                className="btn-action"
              >
                {starting ? <span className="spinner !w-4 !h-4" /> : <Icon name="headphones" size={19} />}
                {starting ? 'Startar...' : doneChapters.length > 0 ? 'Läs in resten av boken' : 'Skapa hela ljudboken'}
              </button>
            )}
          </div>

          {previewing && (
            <p className="text-xs text-ink/55">
              {voice ? `${voice.name} läser in provet` : 'Provet läses in'} - det tar ungefär en halv minut.
            </p>
          )}

          {previewUrl && (
            <div>
              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
              <audio controls autoPlay src={previewUrl} className="w-full">
                Din webbläsare kan inte spela upp ljud.
              </audio>
              <p className="mt-1.5 text-xs text-ink/55">
                Prov ur början av boken{previewVoice ? `, uppläst av ${previewVoice}` : ''}.
              </p>
            </div>
          )}

          {canCreate && bookId ? (
            estimate ? (
              doneChapters.length > 0 ? (
                <p className="text-xs text-ink/55 leading-relaxed">
                  {leftChapters.length} kapitel kvar att läsa in, cirka {thousands(leftCharacters)} tecken
                  {' '}({spokenDuration(leftSeconds)} uppläst text
                  {quality === 'economy'
                    ? `, cirka ${thousands(credits(leftCharacters))} krediter hos ElevenLabs i Snabb`
                    : ', lika många krediter hos ElevenLabs'}).
                  {' '}Uppläsningen görs i bakgrunden och du kan stänga sidan under tiden.
                </p>
              ) : (
                <p className="text-xs text-ink/55 leading-relaxed">
                  Hela boken blir ungefär {spokenDuration(estimate.seconds)} uppläst text
                  {' '}(cirka {thousands(credits(estimate.characters))} krediter hos ElevenLabs).
                  {' '}Uppläsningen görs i bakgrunden och du kan stänga sidan under tiden.
                </p>
              )
            ) : (
              <p className="text-xs text-ink/55">Boken behöver finnas i molnet för att hela ljudboken ska kunna läsas in.</p>
            )
          ) : (
            <p className="text-xs text-ink/55">
              Spara boken i molnet så går det att göra hela ljudboken. Provlyssning fungerar redan nu.
            </p>
          )}
        </div>
      )}

      {error && <div className="note-error mt-4">{error}</div>}
    </div>
  );
}
