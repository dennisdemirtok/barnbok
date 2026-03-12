'use client';

import { useState, useRef } from 'react';
import { BookProject, Spread } from '@/lib/types';

const BATCH_SIZE = 3; // Generate 3 images in parallel

interface Props {
  book: BookProject;
  onPagesGenerated: (spreads: Spread[]) => void;
  onBack: () => void;
}

export default function PageGenerator({ book, onPagesGenerated, onBack }: Props) {
  const [spreads, setSpreads] = useState<Spread[]>(book.spreads);
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
          results: Array<{ id: string; image?: string; error?: string }>;
        };

        // Update each spread with its result
        setSpreads(prev => prev.map(s => {
          const result = results.find(r => r.id === s.id);
          if (!result) return s;

          if (result.image) {
            return { ...s, generatedImage: result.image, status: 'done' as const, error: undefined };
          } else {
            return { ...s, status: 'error' as const, error: result.error || 'Okant fel' };
          }
        }));
      } catch (err) {
        // If the whole batch fails, mark all as error
        const message = err instanceof Error ? err.message : 'Okant fel';
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

      const { image } = await res.json();

      setSpreads(prev => prev.map(s =>
        s.id === spreadId
          ? { ...s, generatedImage: image, status: 'done' as const, error: undefined }
          : s
      ));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Okant fel';
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
          <h2 className="text-2xl font-bold text-gray-800 mb-2">
            Steg 3: Generera sidor
          </h2>
          <p className="text-gray-600">
            Genererar {totalSpreads} uppslag med dina godkanda karaktarer.
            {generatingCount > 0 && (
              <span className="text-blue-600 ml-1 font-medium">
                ({generatingCount} bilder genereras parallellt)
              </span>
            )}
            {failedCount > 0 && (
              <span className="text-orange-600 ml-1">
                ({failedCount} misslyckade)
              </span>
            )}
          </p>
        </div>
        <button onClick={onBack} className="text-gray-500 hover:text-gray-700">
          Tillbaka
        </button>
      </div>

      {/* Progress bar */}
      <div className="bg-gray-200 rounded-full h-4 overflow-hidden">
        <div
          className="bg-blue-600 h-full transition-all duration-500 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>
      <div className="flex justify-between text-sm text-gray-600">
        <span>
          {completedSpreads} av {totalSpreads} uppslag klara
          {generatingCount > 0 && (
            <span className="text-blue-500 ml-2">({generatingCount} genereras...)</span>
          )}
          {failedCount > 0 && (
            <span className="text-red-500 ml-2">({failedCount} misslyckade)</span>
          )}
        </span>
        <span>{Math.round(progress)}%</span>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap gap-3">
        {!isGenerating ? (
          <>
            <button
              onClick={generateAllPages}
              disabled={allDone}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700
                         disabled:bg-gray-400 transition-colors"
            >
              {completedSpreads > 0 ? 'Fortsatt generera' : 'Starta generering'}
            </button>
            {failedCount > 0 && (
              <button
                onClick={retryFailed}
                className="px-6 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700
                           transition-colors"
              >
                Forsok igen alla ({failedCount} misslyckade)
              </button>
            )}
          </>
        ) : (
          <button
            onClick={stopGeneration}
            className="px-6 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700
                       transition-colors"
          >
            Stoppa
          </button>
        )}

        {canProceedToReview && (
          <button
            onClick={() => onPagesGenerated(spreads)}
            className={`px-8 py-2 font-semibold rounded-lg transition-colors ${
              allDone
                ? 'bg-green-600 text-white hover:bg-green-700'
                : 'bg-yellow-500 text-white hover:bg-yellow-600'
            }`}
          >
            {allDone
              ? 'Granska boken'
              : `Granska boken (${failedCount} saknas)`}
          </button>
        )}
      </div>

      {canProceedToReview && !allDone && (
        <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-yellow-800 text-sm">
          <strong>{failedCount} sidor</strong> kunde inte genereras. Du kan fortsatta till granskning anda
          - misslyckade sidor visas som tomma och kan regenereras darifran.
        </div>
      )}

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
          {error}
        </div>
      )}

      {/* Spread grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {spreads.map((spread) => (
          <div
            key={spread.id}
            className={`border rounded-lg overflow-hidden ${
              spread.status === 'generating' ? 'border-blue-400 ring-2 ring-blue-200' :
              spread.status === 'done' ? 'border-green-300' :
              spread.status === 'error' ? 'border-red-300' :
              'border-gray-200'
            }`}
          >
            <div className="bg-gray-100 aspect-[3/2] flex items-center justify-center">
              {spread.status === 'generating' ? (
                <div className="text-center">
                  <svg className="animate-spin h-8 w-8 text-blue-600 mx-auto mb-2" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  <p className="text-sm text-gray-500">Genererar...</p>
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
                      className="px-3 py-1 bg-orange-500 text-white text-xs rounded-lg
                                 hover:bg-orange-600 transition-colors"
                    >
                      Forsok igen
                    </button>
                  )}
                </div>
              ) : (
                <span className="text-gray-400 text-sm">Vantar...</span>
              )}
            </div>

            <div className="p-3">
              <div className="flex items-center justify-between">
                <span className="font-medium text-sm text-gray-700">
                  {spread.pages === 'omslag' ? 'Omslag' :
                   spread.pages === 'slutsida' ? 'Slutsida' :
                   `Sida ${spread.pages}`}
                </span>
                <span className={`text-xs px-2 py-0.5 rounded-full ${
                  spread.status === 'done' ? 'bg-green-100 text-green-700' :
                  spread.status === 'generating' ? 'bg-blue-100 text-blue-700' :
                  spread.status === 'error' ? 'bg-red-100 text-red-700' :
                  'bg-gray-100 text-gray-500'
                }`}>
                  {spread.status === 'done' ? 'Klar' :
                   spread.status === 'generating' ? 'Genererar' :
                   spread.status === 'error' ? 'Fel' : 'Vantar'}
                </span>
              </div>
              {spread.chapter && (
                <p className="text-xs text-gray-500 mt-1">{spread.chapter}</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
