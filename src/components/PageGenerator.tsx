'use client';

import { useState, useRef, useEffect } from 'react';
import { BookProject, Spread } from '@/lib/types';
import Icon from './Icon';
import StepHeader from './StepHeader';
import { resolveBookShape } from '@/lib/book-layout';

const BATCH_SIZE = 3; // Generate 3 images in parallel

interface Props {
  book: BookProject;
  onPagesGenerated: (spreads: Spread[]) => void;
  onSpreadsProgress?: (spreads: Spread[]) => void;
  onBack: () => void;
}

export default function PageGenerator({ book, onPagesGenerated, onSpreadsProgress, onBack }: Props) {
  const [spreads, setSpreads] = useState<Spread[]>(book.spreads);

  // Push every spread update to the parent so generated images are auto-saved
  // even if the user never clicks "Granska boken"
  useEffect(() => {
    onSpreadsProgress?.(spreads);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spreads]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState('');
  const abortRef = useRef(false);

  const totalSpreads = spreads.length;
  const completedSpreads = spreads.filter(s => s.status === 'done').length;
  const failedCount = spreads.filter(s => s.status === 'error').length;
  const pendingCount = spreads.filter(s => s.status === 'pending').length;
  const generatingCount = spreads.filter(s => s.status === 'generating').length;
  const progress = totalSpreads > 0 ? (completedSpreads / totalSpreads) * 100 : 0;

  const canProceedToReview = completedSpreads > 0 && !isGenerating && pendingCount === 0;
  const allDone = completedSpreads === totalSpreads;
  // Helsidesbilder visas stående i ett tätare rutnät, uppslag liggande
  const portrait = resolveBookShape(book) === 'page';

  // Rough time estimate: ~45s per batch of 3 (generation + quality check + possible auto-fix)
  const remainingSpreads = pendingCount + generatingCount;
  const estimatedMinutes = Math.max(1, Math.ceil((Math.ceil(remainingSpreads / BATCH_SIZE) * 45) / 60));

  const generateAllPages = async () => {
    setIsGenerating(true);
    setError('');
    abortRef.current = false;

    const pendingSpreads = spreads.filter(s => s.status !== 'done');

    // Process in batches of BATCH_SIZE
    for (let i = 0; i < pendingSpreads.length; i += BATCH_SIZE) {
      if (abortRef.current) break;

      const batch = pendingSpreads.slice(i, i + BATCH_SIZE);
      const batchIds = batch.map(s => s.id);

      // Mark all in batch as generating
      setSpreads(prev => prev.map(s =>
        batchIds.includes(s.id) ? { ...s, status: 'generating' as const } : s
      ));

      try {
        const res = await fetch('/api/generate-page', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            batch: true,
            spreads: batch,
            characters: book.characters,
            styleGuide: book.styleGuide,
            bookFormat: book.bookFormat,
            illustrationShape: book.illustrationShape,
          }),
        });

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || 'Batch-generering misslyckades');
        }

        const { results } = await res.json() as {
          results: Array<{
            id: string;
            image?: string;
            error?: string;
            check?: { passed: boolean; summary: string; issues?: { character: string; issue: string; severity: 'minor' | 'major' }[] };
            autoFixed?: boolean;
          }>;
        };

        // Update each spread with its result
        setSpreads(prev => prev.map(s => {
          const result = results.find(r => r.id === s.id);
          if (!result) return s;

          if (result.image) {
            return {
              ...s,
              generatedImage: result.image,
              status: 'done' as const,
              error: undefined,
              qualityCheck: result.check ? {
                passed: result.check.passed,
                summary: result.check.summary,
                issues: result.check.issues,
                autoFixed: !!result.autoFixed,
              } : undefined,
            };
          } else {
            return { ...s, status: 'error' as const, error: result.error || 'Okänt fel' };
          }
        }));
      } catch (err) {
        // If the whole batch fails, mark all as error
        const message = err instanceof Error ? err.message : 'Okänt fel';
        setSpreads(prev => prev.map(s =>
          batchIds.includes(s.id) && s.status === 'generating'
            ? { ...s, status: 'error' as const, error: message }
            : s
        ));
      }
    }

    setIsGenerating(false);
  };

  const stopGeneration = () => {
    abortRef.current = true;
  };

  const retryFailed = async () => {
    setSpreads(prev => prev.map(s =>
      s.status === 'error' ? { ...s, status: 'pending' as const, error: undefined } : s
    ));
    setTimeout(() => generateAllPages(), 100);
  };

  const retrySingle = async (spreadId: string) => {
    const spread = spreads.find(s => s.id === spreadId);
    if (!spread) return;

    setIsGenerating(true);
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
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Generering misslyckades');
      }

      const { image, check, autoFixed } = await res.json();

      setSpreads(prev => prev.map(s =>
        s.id === spreadId
          ? {
              ...s,
              generatedImage: image,
              status: 'done' as const,
              error: undefined,
              qualityCheck: check ? {
                passed: check.passed,
                summary: check.summary,
                issues: check.issues,
                autoFixed: !!autoFixed,
              } : undefined,
            }
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
      setIsGenerating(false);
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
              {isGenerating
                ? <span className="spinner !w-6 !h-6" />
                : <Icon name={allDone ? 'celebration' : 'auto_fix_high'} filled size={26} />}
            </div>
            <div>
              <p className="font-heading font-semibold text-ink">
                {allDone
                  ? 'Alla uppslag är klara! 🎉'
                  : isGenerating
                  ? `Genererar ${generatingCount} ${generatingCount === 1 ? 'bild' : 'bilder'} parallellt...`
                  : 'Redo att generera'}
              </p>
              <p className="text-sm text-ink/55">
                {completedSpreads} av {totalSpreads} uppslag klara
                {isGenerating && remainingSpreads > 0 && ` · ~${estimatedMinutes} min kvar`}
              </p>
            </div>
          </div>
          <span className="text-2xl font-heading font-bold text-brand">{Math.round(progress)}%</span>
        </div>

        <div className="bg-ink/10 rounded-full h-3 overflow-hidden">
          <div
            className="bg-brand animate-shimmer h-full rounded-full transition-all duration-500 ease-out"
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
              <span className="spinner !w-3.5 !h-3.5" /> {generatingCount} genereras
            </span>
          )}
          {pendingCount > 0 && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-ink/[0.05] text-ink/55">
              <Icon name="schedule" size={15} /> {pendingCount} väntar
            </span>
          )}
          {failedCount > 0 && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-red-100 text-red-600">
              <Icon name="error" filled size={15} /> {failedCount} misslyckade
            </span>
          )}
        </div>

        {/* Controls */}
        <div className="flex flex-col sm:flex-row sm:flex-wrap gap-3 pt-1">
          {!isGenerating ? (
            <>
              <button
                onClick={generateAllPages}
                disabled={allDone}
                className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Icon name="auto_fix_high" filled size={19} />
                {completedSpreads > 0 ? 'Fortsätt generera' : 'Starta generering'}
              </button>
              {failedCount > 0 && (
                <button onClick={retryFailed} className="btn-action">
                  <Icon name="refresh" size={19} /> Försök igen ({failedCount} misslyckade)
                </button>
              )}
            </>
          ) : (
            <button onClick={stopGeneration} className="btn-danger">
              <Icon name="stop_circle" filled size={19} /> Stoppa
            </button>
          )}

          {canProceedToReview && (
            <button onClick={() => onPagesGenerated(spreads)} className="btn-action">
              {allDone
                ? <>Granska boken <Icon name="arrow_forward" size={19} /></>
                : `Granska boken (${failedCount} saknas)`}
            </button>
          )}
        </div>
      </div>

      {canProceedToReview && !allDone && (
        <div className="note-warning">
          <strong>{failedCount} sidor</strong> kunde inte genereras. Du kan fortsätta till granskning ändå
          - misslyckade sidor visas som tomma och kan regenereras därifrån.
        </div>
      )}

      {error && <div className="note-error">{error}</div>}

      {/* Spread grid */}
      <div className={`grid gap-3 sm:gap-4 ${portrait ? 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'}`}>
        {spreads.map((spread) => (
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
              ) : spread.generatedImage ? (
                <img
                  src={`data:image/png;base64,${spread.generatedImage}`}
                  alt={`Sida ${spread.pages}`}
                  className="w-full h-full object-contain"
                />
              ) : spread.status === 'error' ? (
                <div className="text-center p-4">
                  <Icon name="broken_image" size={28} className="text-red-300 mb-1" />
                  <p className="text-xs text-ink/55 mb-2">{spread.error}</p>
                  {!isGenerating && (
                    <button
                      onClick={() => retrySingle(spread.id)}
                      className="px-3 py-1 bg-brand text-white text-xs rounded-full font-medium
                                 hover:opacity-90 transition-opacity"
                    >
                      Försök igen
                    </button>
                  )}
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
                <span className="font-medium text-sm text-ink/80 truncate">
                  {spread.pages === 'omslag' ? 'Omslag' :
                   spread.pages === 'slutsida' ? 'Slutsida' :
                   `Sida ${spread.pages}`}
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
                <p className={`text-xs mt-1 ${
                  spread.qualityCheck.passed ? 'text-emerald-600' : 'text-amber-600'
                }`}>
                  {spread.qualityCheck.passed
                    ? `✓ Kvalitetskontrollerad${spread.qualityCheck.autoFixed ? ' (auto-förbättrad)' : ''}`
                    : '⚠ Granska manuellt - kontrollen hittade avvikelser'}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
