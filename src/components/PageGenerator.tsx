'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { BookProject, Spread, SpreadQualityCheck } from '@/lib/types';
import Icon from './Icon';
import StepHeader from './StepHeader';
import { resolveBookShape } from '@/lib/book-layout';
import { COMPOSITION_LABEL } from '@/lib/compositions';
import {
  IllustrationJob,
  JobItem,
  askNotificationPermission,
  cancelJob,
  clearJobRef,
  estimateMinutesLeft,
  fetchBookJob,
  fetchJob,
  publishJob,
  startIllustrationJob,
  writeJobRef,
  IllustrationMode,
  readIllustrationMode,
  writeIllustrationMode,
  ImageQuality,
  readImageQuality,
  writeImageQuality,
} from '@/lib/job-client';

// Uppslag kan ha bilden antingen som base64 (nygenererad i webbläsaren) eller
// som en URL i molnet (bakgrundsjobbet lägger den där)
type SpreadWithUrl = Spread & { imageUrl?: string };

const POLL_MS = 4000;

interface Props {
  book: BookProject;
  onPagesGenerated: (spreads: Spread[]) => void;
  onSpreadsProgress?: (spreads: Spread[]) => void;
  // Sparar boken i molnet innan jobbet startar. Servern läser text, karaktärer
  // och stil därifrån, så utan en lyckad sparning kan den inte rita.
  onEnsureSaved?: () => Promise<boolean>;
  onBack: () => void;
}

// Väger in vad servern rapporterat om ett uppslag i den lokala kopian
function mergeItem(spread: Spread, item: JobItem): Spread {
  const current = spread as SpreadWithUrl;
  const hasImage = !!current.imageUrl || !!spread.generatedImage;

  if (item.status === 'done' && item.imageUrl) {
    if (current.imageUrl === item.imageUrl && spread.status === 'done') return spread;
    // Bilden har gjorts om här efter jobbet - den nya bilden får inte bytas tillbaka
    if (spread.generatedImage && spread.status === 'done') return spread;
    return {
      ...spread,
      imageUrl: item.imageUrl,
      generatedImage: undefined,
      status: 'done' as const,
      error: undefined,
      qualityCheck: item.quality ?? spread.qualityCheck,
    } as Spread;
  }

  if (item.status === 'error') {
    const message = item.error || 'Okänt fel';
    if (spread.status === 'error' && spread.error === message) return spread;
    return { ...spread, status: 'error' as const, error: message };
  }

  if (item.status === 'running') {
    return spread.status === 'generating' ? spread : { ...spread, status: 'generating' as const, error: undefined };
  }

  // 'queued' - ligger i kö. Ett uppslag som redan har en bild rörs inte.
  if (hasImage || spread.status === 'pending') return spread;
  return { ...spread, status: 'pending' as const, error: undefined };
}

export default function PageGenerator({ book, onPagesGenerated, onSpreadsProgress, onEnsureSaved, onBack }: Props) {
  // Uppslag som sparats mitt i en generering (t.ex. vid omladdning) har ingen
  // pågående förfrågan längre – återställ dem till 'pending' så de inte snurrar för evigt
  const [spreads, setSpreads] = useState<Spread[]>(() =>
    book.spreads.map(s => (s.status === 'generating' ? { ...s, status: 'pending' as const } : s))
  );
  const startedRef = useRef(false);

  // Push every spread update to the parent so generated images are auto-saved
  // even if the user never clicks "Granska boken"
  useEffect(() => {
    onSpreadsProgress?.(spreads);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spreads]);

  const [job, setJob] = useState<IllustrationJob | null>(null);
  const [pollingId, setPollingId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  // Snabbt eller sparläge (Googles batchkö, halva priset på bilderna)
  const [mode, setMode] = useState<IllustrationMode>('fast');
  // Bildkvalitet: bäst (tryckkvalitet) eller enkel (halva priset, bäst för skärm)
  const [quality, setQuality] = useState<ImageQuality>('standard');
  const [showExamples, setShowExamples] = useState(false);
  useEffect(() => { setMode(readIllustrationMode()); setQuality(readImageQuality()); }, []);

  const jobRunning = job?.status === 'running';
  const isBusy = jobRunning || starting || !!regeneratingId;

  const totalSpreads = spreads.length;
  const completedSpreads = spreads.filter(s => s.status === 'done').length;
  const failedCount = spreads.filter(s => s.status === 'error').length;
  const pendingCount = spreads.filter(s => s.status === 'pending').length;
  const generatingCount = spreads.filter(s => s.status === 'generating').length;
  const progress = totalSpreads > 0 ? (completedSpreads / totalSpreads) * 100 : 0;

  // Går att granska även efter "Stoppa" – saknade sidor kan regenereras i granskningen
  const canProceedToReview = completedSpreads > 0 && !isBusy;
  const allDone = totalSpreads > 0 && completedSpreads === totalSpreads;
  const missingCount = pendingCount + failedCount;
  // Helsidesbilder visas stående i ett tätare rutnät, uppslag liggande
  const portrait = resolveBookShape(book) === 'page';

  const remainingSpreads = pendingCount + generatingCount;
  const estimatedMinutes = estimateMinutesLeft(remainingSpreads);
  // Uppslag vars bild ligger hos Google i sparläget
  const batchedIds = new Set((job?.items || []).filter(i => i.status === 'batched').map(i => i.spreadId));
  const batchMode = (job?.mode ?? mode) === 'batch';

  const applyJob = useCallback((fresh: IllustrationJob) => {
    setSpreads(prev => {
      let changed = false;
      const next = prev.map(s => {
        const item = fresh.items.find(i => i.spreadId === s.id);
        if (!item) return s;
        const merged = mergeItem(s, item);
        if (merged !== s) changed = true;
        return merged;
      });
      return changed ? next : prev;
    });
  }, []);

  // ── Polla jobbet medan det kör ──
  useEffect(() => {
    if (!pollingId) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      try {
        const fresh = await fetchJob(pollingId);
        if (stopped) return;
        if (fresh) {
          setJob(fresh);
          publishJob(fresh);
          applyJob(fresh);
          if (fresh.status !== 'running') {
            if (fresh.status === 'failed' && fresh.message) setError(fresh.message);
            setPollingId(null);
            return;
          }
        }
      } catch {
        // Nätverksglapp (t.ex. mobilen somnade) - försök igen vid nästa varv
      }
      if (!stopped) timer = setTimeout(tick, POLL_MS);
    };

    tick();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [pollingId, applyJob]);

  const startJob = useCallback(async () => {
    setError('');
    setStarting(true);
    // Fråga om notiser direkt i klicket - vissa webbläsare kräver det
    askNotificationPermission();
    try {
      if (onEnsureSaved) {
        const saved = await onEnsureSaved();
        if (!saved) {
          setError('Boken kunde inte sparas i molnet, så servern kan inte hämta text och karaktärer. Kontrollera att du är inloggad och försök igen.');
          return;
        }
      }

      writeIllustrationMode(mode);
      writeImageQuality(quality);
      const started = await startIllustrationJob(book.id, mode, quality);
      writeJobRef({ jobId: started.jobId, bookId: book.id, title: book.title });
      setSpreads(prev => prev.map(s => (s.status === 'error' ? { ...s, status: 'pending' as const, error: undefined } : s)));
      setJob(prev =>
        prev && prev.id === started.jobId
          ? { ...prev, status: 'running' as const }
          : {
              id: started.jobId,
              bookId: book.id,
              mode,
              status: 'running' as const,
              total: started.total,
              done: 0,
              failed: 0,
              updatedAt: new Date().toISOString(),
              items: [],
            }
      );
      setPollingId(started.jobId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kunde inte starta illustreringen');
    } finally {
      setStarting(false);
    }
  }, [book.id, book.title, onEnsureSaved, mode, quality]);

  // ── Vid start: haka på ett pågående jobb, annars starta en helt ny bok ──
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    let cancelled = false;

    (async () => {
      let existing: IllustrationJob | null = null;
      try {
        existing = await fetchBookJob(book.id);
      } catch {
        // Jobb-API:t svarade inte - användaren får starta manuellt
      }
      if (cancelled) return;

      if (existing) {
        setJob(existing);
        publishJob(existing);
        applyJob(existing);
        if (existing.status === 'running') {
          writeJobRef({ jobId: existing.id, bookId: book.id, title: book.title });
          setPollingId(existing.id);
          return;
        }
      }

      // Ingen autostart: man väljer först snabbt eller sparläge
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stopJob = async () => {
    const id = pollingId || job?.id;
    setPollingId(null);
    setJob(prev => (prev ? { ...prev, status: 'canceled' as const } : prev));
    setSpreads(prev => prev.map(s => (s.status === 'generating' ? { ...s, status: 'pending' as const } : s)));
    clearJobRef();
    if (!id) return;
    try {
      await cancelJob(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kunde inte stoppa illustreringen');
    }
  };

  // Enstaka omgenerering görs direkt mot bildmotorn - den är snabb nog att vänta på
  // Behåll bilden som den är - anteckningen försvinner
  const keepImage = (spreadId: string) => {
    setSpreads(prev => prev.map(s =>
      s.id === spreadId && s.qualityCheck ? { ...s, qualityCheck: { ...s.qualityCheck, accepted: true } } : s
    ));
  };

  const retrySingle = async (spreadId: string, fixInstructions?: string) => {
    const spread = spreads.find(s => s.id === spreadId);
    if (!spread) return;

    setRegeneratingId(spreadId);
    setSpreads(prev => prev.map(s =>
      s.id === spreadId ? { ...s, status: 'generating' as const, error: undefined } : s
    ));

    try {
      const res = await fetch('/api/generate-page', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          spread,
          characters: book.characters,
          styleGuide: book.styleGuide,
          bookFormat: book.bookFormat,
          illustrationShape: book.illustrationShape,
          isRegenerate: true,
          // Med en rättelse görs en enda ny bild enligt den - utan ny granskningsloop
          ...(fixInstructions ? { customInstructions: fixInstructions } : {}),
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Generering misslyckades');
      }

      const { image, qualityCheck } = await res.json() as { image: string; qualityCheck?: SpreadQualityCheck };

      setSpreads(prev => prev.map(s =>
        s.id === spreadId
          ? {
              ...s,
              generatedImage: image,
              imageUrl: undefined,
              status: 'done' as const,
              error: undefined,
              // En rättad bild har författaren själv beställt - ingen ny anteckning
              qualityCheck: fixInstructions ? undefined : qualityCheck,
            } as Spread
          : s
      ));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Okänt fel';
      setSpreads(prev => prev.map(s =>
        s.id === spreadId
          ? { ...s, status: 'error' as const, error: message }
          : s
      ));
    } finally {
      setRegeneratingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <StepHeader
        eyebrow="Steg 3 av 4 · Illustrera"
        title="Nu illustreras din bok"
        description={`${totalSpreads} bilder skapas med dina godkända karaktärer, och varje bild kvalitetskontrolleras automatiskt.`}
        onBack={onBack}
      />

      {/* Progress-panel */}
      <div className="glass rounded-4xl p-5 space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className={`w-12 h-12 shrink-0 rounded-2xl flex items-center justify-center transition-colors ${
              allDone ? 'bg-emerald-500 text-white shadow-soft' : 'bg-ink text-white shadow-soft'
            }`}>
              {isBusy
                ? <span className="spinner !w-6 !h-6" />
                : <Icon name={allDone ? 'celebration' : 'auto_fix_high'} filled size={26} />}
            </div>
            <div>
              <p className="font-heading font-semibold text-ink">
                {allDone
                  ? 'Alla uppslag är klara! 🎉'
                  : starting
                  ? 'Startar illustreringen...'
                  : jobRunning
                  ? batchMode ? 'Sparläge: bilderna görs hos Google' : 'Servern illustrerar din bok'
                  : 'Redo att illustrera'}
              </p>
              <p className="text-sm text-ink/55">
                {completedSpreads} av {totalSpreads} klara
                {jobRunning && remainingSpreads > 0 && (batchMode
                  ? ' · brukar ta några minuter, som längst ett dygn'
                  : ` · ungefär ${estimatedMinutes} min kvar`)}
              </p>
            </div>
          </div>
          <span className="text-2xl font-heading font-bold text-brand">{Math.round(progress)}%</span>
        </div>

        <div className="bg-ink/10 rounded-full h-3 overflow-hidden">
          <div
            className={`bg-brand h-full rounded-full transition-all duration-500 ease-out ${jobRunning ? 'animate-shimmer' : ''}`}
            style={{ width: `${progress}%` }}
          />
        </div>

        {/* Statuschips */}
        <div className="flex flex-wrap gap-2 text-xs font-semibold">
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-100 text-emerald-700">
            <Icon name="check_circle" filled size={15} /> {completedSpreads} klara
          </span>
          {generatingCount > 0 && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-brand/10 text-brand">
              <span className="spinner !w-3.5 !h-3.5" /> {generatingCount} ritas nu
            </span>
          )}
          {batchedIds.size > 0 && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-100 text-amber-800">
              <Icon name="savings" size={15} /> {batchedIds.size} i sparkön hos Google
            </span>
          )}
          {pendingCount - batchedIds.size > 0 && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-ink/[0.05] text-ink/55">
              <Icon name="schedule" size={15} /> {pendingCount - batchedIds.size} i kö
            </span>
          )}
          {failedCount > 0 && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-red-100 text-red-600">
              <Icon name="error" filled size={15} /> {failedCount} misslyckade
            </span>
          )}
        </div>

        {/* Jobbet kör på servern - sidan behöver inte vara öppen */}
        {(jobRunning || starting) && (
          <div className="flex items-start gap-2.5 p-3 rounded-2xl bg-brand/[0.07] border border-brand/15 text-sm text-ink/70">
            <Icon name="cloud_done" filled size={18} className="text-brand mt-px shrink-0" />
            <p>
              <strong className="text-ink font-semibold">Du kan stänga sidan</strong> - bilderna görs klart i bakgrunden.
              Kom tillbaka när du vill, även från en annan enhet, så fortsätter du där boken är.
            </p>
          </div>
        )}

        {/* Snabbt eller sparläge */}
        {!jobRunning && !starting && !allDone && (
          <div>
            <p className="text-sm font-semibold text-ink">Hur ska bilderna göras?</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {([
                {
                  id: 'fast' as const,
                  icon: 'bolt',
                  title: 'Snabbt',
                  text: (() => {
                    const minutes = estimateMinutesLeft(missingCount || totalSpreads);
                    return `Klart på ungefär ${minutes} ${minutes === 1 ? 'minut' : 'minuter'}.`;
                  })(),
                },
                {
                  id: 'batch' as const,
                  icon: 'savings',
                  title: 'Sparläge',
                  text: 'Halva priset på bilderna. Google gör dem när det finns plats: oftast inom några minuter, som längst ett dygn.',
                },
              ]).map(option => (
                <button
                  key={option.id}
                  onClick={() => setMode(option.id)}
                  aria-pressed={mode === option.id}
                  className={`flex items-start gap-2.5 p-3 rounded-2xl border text-left transition-all ${
                    mode === option.id ? 'border-brand bg-brand/5 ring-2 ring-brand/15' : 'border-line bg-white hover:border-ink/25'
                  }`}
                >
                  <Icon name={option.icon} filled={mode === option.id} size={20} className={mode === option.id ? 'text-brand shrink-0 mt-0.5' : 'text-ink/40 shrink-0 mt-0.5'} />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-ink">{option.title}</span>
                    <span className="block text-xs text-ink/55 leading-snug">{option.text}</span>
                  </span>
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-ink/45">Kvaliteten är densamma. Du kan stänga sidan i båda lägena och får besked här när boken är klar.</p>

            <p className="mt-4 text-sm font-semibold text-ink">Bildkvalitet</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {([
                {
                  id: 'standard' as const,
                  icon: 'high_quality',
                  title: 'Bäst',
                  text: 'Skarpast på stora bilder och scener med många personer. Tryckkvalitet.',
                },
                {
                  id: 'budget' as const,
                  icon: 'eco',
                  title: 'Enkel',
                  text: 'Halva priset och dubbelt så snabbt. Nästan lika bra på figurer och enkla bilder, enklare på stora scener. Räcker för att läsa på skärm, inte för tryck av helsidor.',
                },
              ]).map(option => (
                <button
                  key={option.id}
                  onClick={() => setQuality(option.id)}
                  aria-pressed={quality === option.id}
                  className={`flex items-start gap-2.5 p-3 rounded-2xl border text-left transition-all ${
                    quality === option.id ? 'border-brand bg-brand/5 ring-2 ring-brand/15' : 'border-line bg-white hover:border-ink/25'
                  }`}
                >
                  <Icon name={option.icon} filled={quality === option.id} size={20} className={quality === option.id ? 'text-brand shrink-0 mt-0.5' : 'text-ink/40 shrink-0 mt-0.5'} />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-ink">{option.title}</span>
                    <span className="block text-xs text-ink/55 leading-snug">{option.text}</span>
                  </span>
                </button>
              ))}
            </div>
            <button
              onClick={() => setShowExamples(v => !v)}
              className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline"
            >
              <Icon name={showExamples ? 'expand_less' : 'compare'} size={15} />
              {showExamples ? 'Dölj exemplen' : 'Se skillnaden med exempel'}
            </button>
            {showExamples && (
              <div className="mt-3 space-y-3 max-w-xl">
                {([
                  { key: 'helsida', label: 'Helsida med många personer - här syns skillnaden' },
                  { key: 'band', label: 'Band över sidan' },
                  { key: 'figur', label: 'Figur på vitt papper - nästan ingen skillnad' },
                ]).map(example => (
                  <div key={example.key}>
                    <p className="text-xs text-ink/55 mb-1.5">{example.label}</p>
                    <div className="grid grid-cols-2 gap-2">
                      {(['bast', 'enkel'] as const).map(level => (
                        <figure key={level} className="rounded-xl overflow-hidden border border-line bg-white">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={`/kvalitet/${example.key}-${level}.jpg`} alt="" loading="lazy" className="w-full h-auto" />
                          <figcaption className="px-2 py-1 text-[11px] font-medium text-ink/60">{level === 'bast' ? 'Bäst' : 'Enkel'}</figcaption>
                        </figure>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Controls */}
        <div className="flex flex-col sm:flex-row sm:flex-wrap gap-3 pt-1">
          {!jobRunning ? (
            <button
              onClick={() => void startJob()}
              disabled={allDone || starting || !!regeneratingId}
              className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Icon name="auto_fix_high" filled size={19} />
              {starting
                ? 'Startar...'
                : completedSpreads > 0
                ? `Illustrera resten${missingCount > 0 ? ` (${missingCount})` : ''}`
                : 'Illustrera boken'}
            </button>
          ) : (
            <button onClick={stopJob} className="btn-danger">
              <Icon name="stop_circle" filled size={19} /> Stoppa
            </button>
          )}

          {canProceedToReview && (
            <button onClick={() => onPagesGenerated(spreads)} className="btn-action">
              {allDone
                ? <>Granska boken <Icon name="arrow_forward" size={19} /></>
                : `Granska boken (${missingCount} saknas)`}
            </button>
          )}
        </div>
      </div>

      {canProceedToReview && !allDone && missingCount > 0 && (
        <div className="note-warning">
          <strong>{missingCount} {missingCount === 1 ? 'sida' : 'sidor'}</strong> saknar bild
          {failedCount > 0 && pendingCount > 0
            ? ` (${failedCount} misslyckades, ${pendingCount} ej genererade)`
            : failedCount > 0 ? ' (kunde inte genereras)' : ' (ej genererade än)'}
          . Du kan fortsätta till granskning ändå - sidor utan bild visas som tomma och kan regenereras därifrån.
        </div>
      )}

      {error && <div className="note-error">{error}</div>}

      {/* Spread grid */}
      <div className={`grid gap-3 sm:gap-4 ${portrait ? 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'}`}>
        {spreads.map((spread) => {
          const imageUrl = (spread as SpreadWithUrl).imageUrl;
          return (
            <div
              key={spread.id}
              className={`card-glass overflow-hidden ${
                spread.status === 'generating' ? 'ring-2 ring-brand/50' :
                spread.status === 'error' ? 'ring-2 ring-red-300' :
                ''
              }`}
            >
              <div className={`bg-paper flex items-center justify-center ${portrait ? 'aspect-[3/4]' : 'aspect-[3/2]'}`}>
                {spread.status === 'generating' ? (
                  <div className="text-center text-brand">
                    <span className="spinner !w-8 !h-8 mb-2" />
                    <p className="text-xs sm:text-sm text-ink/55 px-2">Målar och kontrollerar...</p>
                  </div>
                ) : imageUrl || spread.generatedImage ? (
                  <img
                    src={imageUrl || `data:image/png;base64,${spread.generatedImage}`}
                    alt={`Sida ${spread.pages}`}
                    className="w-full h-full object-contain"
                  />
                ) : spread.status === 'error' ? (
                  <div className="text-center p-4">
                    <Icon name="broken_image" size={28} className="text-red-300 mb-1" />
                    <p className="text-xs text-ink/55 mb-2">{spread.error}</p>
                    {!isBusy && (
                      <button
                        onClick={() => retrySingle(spread.id)}
                        className="px-3 py-1 bg-brand text-white text-xs rounded-full font-medium
                                   hover:opacity-90 transition-opacity"
                      >
                        Försök igen
                      </button>
                    )}
                  </div>
                ) : batchedIds.has(spread.id) ? (
                  <div className="text-center text-amber-700/80 px-2">
                    <Icon name="savings" size={26} className="mb-1" />
                    <p className="text-sm">I sparkön hos Google</p>
                  </div>
                ) : (
                  <div className="text-center text-ink/40">
                    <Icon name="hourglass_empty" size={26} className="mb-1" />
                    <p className="text-sm">Väntar...</p>
                  </div>
                )}
              </div>

              <div className="p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-sm text-ink/80 truncate" title={spread.composition ? COMPOSITION_LABEL[spread.composition] : undefined}>
                    {spread.pages === 'omslag' ? 'Omslag' :
                     spread.pages === 'slutsida' ? 'Slutsida' :
                     `Sida ${spread.pages}`}
                    {spread.composition && <span className="ml-1 text-ink/40 font-normal">· {COMPOSITION_LABEL[spread.composition]}</span>}
                  </span>
                  <span className={`shrink-0 text-xs px-2.5 py-0.5 rounded-full font-medium ${
                    spread.status === 'done' ? 'bg-emerald-100 text-emerald-700' :
                    spread.status === 'generating' ? 'bg-brand/10 text-brand' :
                    spread.status === 'error' ? 'bg-red-100 text-red-600' :
                    'bg-ink/[0.05] text-ink/55'
                  }`}>
                    {spread.status === 'done' ? 'Klar' :
                     spread.status === 'generating' ? 'Genererar' :
                     spread.status === 'error' ? 'Fel' : 'Väntar'}
                  </span>
                </div>
                {spread.chapter && (
                  <p className="text-xs text-ink/55 mt-1">{spread.chapter}</p>
                )}
                {spread.status === 'done' && spread.qualityCheck && (
                  <QualityNote
                    check={spread.qualityCheck}
                    busy={isBusy}
                    onRedo={fix => retrySingle(spread.id, fix)}
                    onKeep={() => keepImage(spread.id)}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Resultatet av den automatiska granskningen: godkänd, rättad eller behöver ses över
// Fel som är värda att visa. Äldre granskningar kunde kalla småsaker (saknad
// rekvisita, en statist i bakgrunden) för allvarliga - de visas inte längre.
const WORTH_A_LOOK = new Set(['missing_character', 'duplicate_character', 'wrong_appearance', 'anatomy', 'unwanted_text', 'cropped_character']);

// Visas bara när det finns något värt att titta på - och då går det att göra något åt
function QualityNote({ check, busy, onRedo, onKeep }: {
  check: SpreadQualityCheck;
  busy: boolean;
  onRedo: (fix: string) => void;
  onKeep: () => void;
}) {
  if (check.accepted || check.reviewed === false || check.passed) return null;
  const notes = (check.issues ?? []).filter(i => i.severity === 'major' && (!i.category || WORTH_A_LOOK.has(i.category)));
  if (notes.length === 0) return null;

  const fix = notes
    .map(i => i.correction || `Rätta detta: ${i.issue}`)
    .join('\n');

  return (
    <div className="mt-2 rounded-2xl border border-amber-200/80 bg-amber-50/70 p-2.5">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-800">
        <Icon name="visibility" size={14} className="shrink-0" /> Värt att kolla
      </p>
      <p className="mt-0.5 text-xs leading-snug text-ink/70">
        {notes[0].issue}
        {notes.length > 1 && <span className="text-ink/45"> och {notes.length - 1} sak till</span>}
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <button
          onClick={() => onRedo(fix)}
          disabled={busy}
          className="inline-flex items-center gap-1 rounded-full bg-ink px-3 py-1 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          <Icon name="refresh" size={14} /> Gör om bilden
        </button>
        <button
          onClick={onKeep}
          className="inline-flex items-center gap-1 rounded-full border border-line bg-white px-3 py-1 text-xs font-medium text-ink/70 transition-colors hover:border-ink/25"
        >
          <Icon name="check" size={14} /> Den är bra
        </button>
      </div>
    </div>
  );
}
