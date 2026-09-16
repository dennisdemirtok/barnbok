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
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState('');

  const [voiceId, setVoiceId] = useState(DEFAULT_VOICE_ID);
  // 'best' = bästa uttalet, 'economy' = halva kvoten hos ElevenLabs
  const [quality, setQuality] = useState<'best' | 'economy'>('best');
  const [previewing, setPreviewing] = useState(false);
  const [previewUrl, setPreviewUrl] = useState('');
  const [previewVoice, setPreviewVoice] = useState('');

  const [starting, setStarting] = useState(false);
  const [job, setJob] = useState<IllustrationJob | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);

  const [partIndex, setPartIndex] = useState(0);
  const playerRef = useRef<HTMLAudioElement>(null);
  // Sant när nästa del ska börja spela av sig själv (klick i listan eller slutet på förra delen)
  const autoPlay = useRef(false);

  // Städa bort provlyssningens blob-adress när panelen stängs
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  const loadAudiobook = useCallback(async (): Promise<Audiobook | null> => {
    if (!bookId) return null;
    const res = await fetch(`/api/audio/book?bookId=${encodeURIComponent(bookId)}`, { cache: 'no-store' });
    if (!res.ok) throw new Error('Kunde inte hämta ljudboken just nu');
    const data = await res.json() as { audiobook: Audiobook | null; estimate: Estimate | null };
    setAudiobook(data.audiobook);
    setEstimate(data.estimate);
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
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl('');
    }
    try {
      const body: Record<string, unknown> = { voiceId, quality };
      if (bookId) body.bookId = bookId;
      else if (book) body.book = bookForPreview(book);
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

  // ── Starta hela ljudboken ──
  const createAudiobook = async () => {
    if (!bookId) return;
    setError('');
    setStarting(true);
    try {
      const res = await fetch('/api/audio/book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookId, voiceId, quality }),
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
      try { localStorage.setItem(jobKey(bookId), data.jobId); } catch { /* lagring blockerad */ }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kunde inte starta ljudboken');
    } finally {
      setStarting(false);
    }
  };

  // ── Delar att spela: den färdiga ljudboken, annars det jobbet hunnit läsa in ──
  const liveParts: AudioPart[] = (job?.items || [])
    .filter(i => i.status === 'done' && i.imageUrl)
    .map(i => ({ label: i.label || `Del ${i.spreadNumber + 1}`, url: i.imageUrl as string, seconds: itemSeconds(i.quality) }));

  const parts: AudioPart[] = audiobook?.parts?.length ? audiobook.parts : liveParts;
  const current = parts[Math.min(partIndex, parts.length - 1)];
  const totalSeconds = audiobook?.seconds ?? parts.reduce((n, p) => n + p.seconds, 0);
  const running = job?.status === 'running';

  const selectPart = (index: number) => {
    autoPlay.current = true;
    setPartIndex(index);
  };

  // Byt ljudfil och starta den när man valt en del själv eller förra delen tog slut
  useEffect(() => {
    const el = playerRef.current;
    if (!el || !autoPlay.current) return;
    autoPlay.current = false;
    el.play().catch(() => { /* webbläsaren kan kräva ett klick - spelaren står redo */ });
  }, [partIndex, current?.url]);

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
            Läser upp kapitel {Math.min((job?.done || 0) + 1, job?.total || 1)} av {job?.total || 0}
          </div>
          <div className="mt-2.5 h-1.5 w-full rounded-full bg-ink/10 overflow-hidden">
            <div
              className="h-full rounded-full bg-brand transition-all duration-500"
              style={{ width: `${job?.total ? Math.round(((job.done || 0) / job.total) * 100) : 0}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-ink/55">Du kan stänga sidan - ljudboken görs klart i bakgrunden.</p>
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

      {/* ─── Inget ljud än: röst, provlyssning och start ─── */}
      {parts.length === 0 && !running && (
        <div className="mt-5 space-y-5">
          <div>
            <h4 className="text-sm font-semibold text-ink">Välj röst</h4>
            <div className="mt-2.5 grid gap-2 sm:grid-cols-2">
              {NARRATOR_VOICES.map(v => {
                const chosen = v.id === voiceId;
                return (
                  <button
                    key={v.id}
                    onClick={() => setVoiceId(v.id)}
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
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {([
                { id: 'best' as const, label: 'Bästa uttalet', hint: 'full kvot' },
                { id: 'economy' as const, label: 'Räcker dubbelt så långt', hint: 'halva kvoten, något enklare uttal' },
              ]).map(option => (
                <button
                  key={option.id}
                  onClick={() => setQuality(option.id)}
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
          </div>

          <div className="flex flex-wrap gap-2">
            <button onClick={playPreview} disabled={previewing} className="btn-ghost">
              {previewing ? <span className="spinner !w-4 !h-4" /> : <Icon name="play_arrow" size={19} />}
              {previewing ? 'Läser in provet...' : 'Provlyssna första sidorna'}
            </button>
            {canCreate && bookId && (
              <button onClick={createAudiobook} disabled={starting} className="btn-action">
                {starting ? <span className="spinner !w-4 !h-4" /> : <Icon name="headphones" size={19} />}
                {starting ? 'Startar...' : 'Skapa hela ljudboken'}
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
              <p className="text-xs text-ink/55 leading-relaxed">
                Hela boken blir ungefär {spokenDuration(estimate.seconds)} uppläst text
                {' '}(cirka {thousands(quality === 'economy' ? Math.round(estimate.characters / 2) : estimate.characters)} krediter hos ElevenLabs).
                {' '}Uppläsningen görs i bakgrunden och du kan stänga sidan under tiden.
              </p>
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
