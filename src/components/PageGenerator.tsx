'use client';

import { useState, useRef, useEffect } from 'react';
import { BookProject, Spread } from '@/lib/types';

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
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-heading text-2xl font-bold text-gray-800 mb-2">
            Steg 3: Generera sidor
          </h2>
          <p className="text-gray-600">
            Genererar {totalSpreads} uppslag med dina godkända karaktärer.
            {generatingCount > 0 && (
              <span className="text-brand ml-1 font-medium">
                ({generatingCount} bilder genereras parallellt)
              </span>
            )}
            {failedCount > 0 && (
              <span className="text-sunset ml-1">
                ({failedCount} misslyckade)
              </span>
            )}
          </p>
        </div>
        <button onClick={onBack} className="btn-ghost">
          Tillbaka
        </button>
      </div>

      {/* Progress bar */}
      <div className="bg-gray-200/70 rounded-full h-4 overflow-hidden">
        <div
          className="bg-gradient-to-r from-trust via-brand to-magic animate-shimmer h-full rounded-full transition-all duration-500 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>
      <div className="flex justify-between text-sm text-gray-600">
        <span>
          {completedSpreads} av {totalSpreads} uppslag klara
          {generatingCount > 0 && (
            <span className="text-brand ml-2">({generatingCount} genereras...)</span>
          )}
          {failedCount > 0 && (
            <span className="text-red-500 ml-2">({failedCount} misslyckade)</span>
          )}
        </span>
        <span>
          {isGenerating && remainingSpreads > 0 && (
            <span className="text-gray-500 mr-3">~{estimatedMinutes} min kvar</span>
          )}
          {Math.round(progress)}%
        </span>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap gap-3">
        {!isGenerating ? (
          <>
            <button
              onClick={generateAllPages}
              disabled={allDone}
              className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {completedSpreads > 0 ? 'Fortsätt generera' : 'Starta generering'}
            </button>
            {failedCount > 0 && (
              <button
                onClick={retryFailed}
                className="btn-action"
              >
                Försök igen alla ({failedCount} misslyckade)
              </button>
            )}
          </>
        ) : (
          <button
            onClick={stopGeneration}
            className="px-6 py-2 bg-red-500 text-white rounded-full font-semibold hover:bg-red-600 transition-colors"
          >
            Stoppa
          </button>
        )}

        {canProceedToReview && (
          <button
            onClick={() => onPagesGenerated(spreads)}
            className="btn-action"
          >
            {allDone
              ? 'Granska boken'
              : `Granska boken (${failedCount} saknas)`}
          </button>
        )}
      </div>

      {canProceedToReview && !allDone && (
        <div className="p-4 bg-amber-50/80 border border-amber-200 rounded-2xl text-amber-800 text-sm">
          <strong>{failedCount} sidor</strong> kunde inte genereras. Du kan fortsätta till granskning ändå
          - misslyckade sidor visas som tomma och kan regenereras därifrån.
        </div>
      )}

      {error && (
        <div className="p-4 bg-red-50/80 border border-red-200 rounded-2xl text-red-700">
          {error}
        </div>
      )}

      {/* Spread grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {spreads.map((spread) => (
          <div
            key={spread.id}
            className={`card-glass overflow-hidden ${
              spread.status === 'generating' ? 'ring-2 ring-brand/50' :
              spread.status === 'done' ? 'ring-2 ring-emerald-300' :
              spread.status === 'error' ? 'ring-2 ring-red-300' :
              ''
            }`}
          >
            <div className="bg-gray-100/70 aspect-[3/2] flex items-center justify-center">
              {spread.status === 'generating' ? (
                <div className="text-center">
                  <svg className="animate-spin h-8 w-8 text-brand mx-auto mb-2" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  <p className="text-sm text-gray-500">Genererar &amp; kvalitetskontrollerar...</p>
                </div>
              ) : spread.generatedImage ? (
                <img
                  src={`data:image/png;base64,${spread.generatedImage}`}
                  alt={`Sida ${spread.pages}`}
                  className="w-full h-full object-contain"
                />
              ) : spread.status === 'error' ? (
                <div className="text-center p-4">
                  <p className="text-red-500 text-sm mb-1">Fel</p>
                  <p className="text-xs text-gray-500 mb-2">{spread.error}</p>
                  {!isGenerating && (
                    <button
                      onClick={() => retrySingle(spread.id)}
                      className="px-3 py-1 bg-sunset text-white text-xs rounded-full font-medium
                                 hover:opacity-90 transition-opacity"
                    >
                      Försök igen
                    </button>
                  )}
                </div>
              ) : (
                <span className="text-gray-400 text-sm">Väntar...</span>
              )}
            </div>

            <div className="p-3">
              <div className="flex items-center justify-between">
                <span className="font-medium text-sm text-gray-700">
                  {spread.pages === 'omslag' ? 'Omslag' :
                   spread.pages === 'slutsida' ? 'Slutsida' :
                   `Sida ${spread.pages}`}
                </span>
                <span className={`text-xs px-3 py-1 rounded-full font-medium ${
                  spread.status === 'done' ? 'bg-emerald-100 text-emerald-700' :
                  spread.status === 'generating' ? 'bg-brand/10 text-brand' :
                  spread.status === 'error' ? 'bg-red-100 text-red-600' :
                  'bg-gray-100 text-gray-500'
                }`}>
                  {spread.status === 'done' ? 'Klar' :
                   spread.status === 'generating' ? 'Genererar' :
                   spread.status === 'error' ? 'Fel' : 'Väntar'}
                </span>
              </div>
              {spread.chapter && (
                <p className="text-xs text-gray-500 mt-1">{spread.chapter}</p>
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
