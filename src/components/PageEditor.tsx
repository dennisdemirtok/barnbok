'use client';

import { useState, useEffect } from 'react';
import { Character, Spread, TextBlock, BookFormat, IllustrationShape } from '@/lib/types';

interface Props {
  spread: Spread;
  characters: Character[];
  styleGuide: string;
  bookFormat?: BookFormat;
  illustrationShape?: IllustrationShape;
  onSave: (updatedSpread: Spread) => void;
  onClose: () => void;
}

export default function PageEditor({ spread, characters, styleGuide, bookFormat, illustrationShape, onSave, onClose }: Props) {
  const [editedSpread, setEditedSpread] = useState<Spread>({ ...spread });
  const [customInstructions, setCustomInstructions] = useState('');
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [error, setError] = useState('');
  const [previewImage, setPreviewImage] = useState(spread.generatedImage);
  const [confirmClose, setConfirmClose] = useState(false);

  // Osparade ändringar: ny (betald) bild, ändrad text eller prompt
  const isDirty =
    previewImage !== spread.generatedImage ||
    editedSpread.imagePrompt !== spread.imagePrompt ||
    editedSpread.textBlocks.some((b, i) => b.text !== spread.textBlocks[i]?.text);

  // Tvåstegsbekräftelsen återställs efter en stund
  useEffect(() => {
    if (!confirmClose) return;
    const t = setTimeout(() => setConfirmClose(false), 4000);
    return () => clearTimeout(t);
  }, [confirmClose]);

  const handleClose = () => {
    if (isDirty && !confirmClose) {
      setConfirmClose(true);
      return;
    }
    onClose();
  };

  const updateTextBlock = (index: number, newText: string) => {
    const newBlocks = [...editedSpread.textBlocks];
    newBlocks[index] = { ...newBlocks[index], text: newText };
    setEditedSpread({ ...editedSpread, textBlocks: newBlocks });
  };

  const updateImagePrompt = (newPrompt: string) => {
    setEditedSpread({ ...editedSpread, imagePrompt: newPrompt });
  };

  const regenerateImage = async () => {
    setIsRegenerating(true);
    setError('');

    try {
      const res = await fetch('/api/generate-page', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          spread: editedSpread,
          characters,
          styleGuide,
          bookFormat,
          illustrationShape,
          customInstructions: customInstructions || undefined,
          isRegenerate: true,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Regenerering misslyckades');
      }

      const { image, qualityCheck } = await res.json();
      setPreviewImage(image);
      setEditedSpread(prev => ({ ...prev, generatedImage: image, status: 'done', qualityCheck }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Något gick fel');
    } finally {
      setIsRegenerating(false);
    }
  };

  const handleSave = () => {
    onSave({
      ...editedSpread,
      generatedImage: previewImage,
    });
  };

  return (
    <div className="fixed inset-0 !m-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="glass-strong rounded-4xl max-w-6xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 glass-strong rounded-t-4xl border-b border-line p-4 flex flex-wrap items-center justify-between gap-2 z-10">
          <h3 className="text-lg font-heading font-semibold text-ink">
            Redigera {spread.pages === 'omslag' ? 'Omslag' : `Sida ${spread.pages}`}
            {spread.chapter && <span className="text-sm text-ink/55 ml-2">({spread.chapter})</span>}
          </h3>
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              className="btn-primary"
            >
              Spara
            </button>
            <button
              onClick={handleClose}
              className={confirmClose
                ? 'px-3 py-2 rounded-full text-sm font-semibold text-red-700 bg-red-50 border border-red-200 hover:bg-red-100 transition-colors'
                : 'px-3 py-2 text-ink/40 hover:text-ink/80 transition-colors'}
            >
              {confirmClose ? 'Stäng utan att spara?' : 'Stäng'}
            </button>
          </div>
        </div>

        {confirmClose && (
          <div role="alert" className="note-warning mx-4 mt-4">
            Du har osparade ändringar{previewImage !== spread.generatedImage ? ' – bland annat en ny bild' : ''}.
            Klicka på Spara för att behålla dem, eller Stäng igen för att kasta dem.
          </div>
        )}

        <div className="p-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left: Image */}
          <div>
            <h4 className="font-heading font-semibold text-ink/80 mb-2">Bild</h4>
            <div className="bg-white/50 rounded-2xl overflow-hidden mb-4">
              {isRegenerating ? (
                <div className="flex items-center justify-center h-64">
                  <div className="text-center">
                    <svg className="animate-spin h-10 w-10 text-brand mx-auto mb-3" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    <p className="text-ink/55">Regenererar bild...</p>
                  </div>
                </div>
              ) : previewImage ? (
                <img
                  src={`data:image/png;base64,${previewImage}`}
                  alt={`Sida ${spread.pages}`}
                  className="w-full object-contain"
                />
              ) : (
                <div className="flex items-center justify-center h-64 text-ink/40">
                  Ingen bild
                </div>
              )}
            </div>

            {/* Quick edit instructions */}
            <div className="space-y-3">
              <h4 className="font-heading font-semibold text-ink/80">Snabbredigering</h4>
              <p className="text-xs text-ink/55">
                Beskriv vad du vill ändra utan att ändra karaktärerna.
                T.ex. &quot;Gör det mer dramatiskt&quot; eller &quot;Ändra bakgrunden till natt&quot;
              </p>
              <textarea
                value={customInstructions}
                onChange={(e) => setCustomInstructions(e.target.value)}
                placeholder='T.ex. "Gör scenen mörkare", "Lägg till snö", "Zooma in på ansiktena"...'
                className="field h-20 text-sm"
              />
              <button
                onClick={regenerateImage}
                disabled={isRegenerating}
                className="btn-action w-full"
              >
                {isRegenerating ? 'Genererar...' : 'Regenerera bild'}
              </button>
            </div>

            {error && (
              <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-2xl text-red-700 text-sm">
                {error}
              </div>
            )}
          </div>

          {/* Right: Text and prompt */}
          <div className="space-y-4">
            {/* Text blocks */}
            <div>
              <h4 className="font-heading font-semibold text-ink/80 mb-2">Sidtext</h4>
              {editedSpread.textBlocks.map((block, idx) => (
                <div key={idx} className="mb-3">
                  <label className="text-xs text-ink/55 mb-1 block">
                    {block.position}
                  </label>
                  <textarea
                    value={block.text}
                    onChange={(e) => updateTextBlock(idx, e.target.value)}
                    className="field h-24 text-sm resize-y"
                  />
                </div>
              ))}
            </div>

            {/* Image prompt */}
            <div>
              <h4 className="font-heading font-semibold text-ink/80 mb-2">Bildprompt</h4>
              <textarea
                value={editedSpread.imagePrompt}
                onChange={(e) => updateImagePrompt(e.target.value)}
                className="field h-48 text-sm leading-relaxed resize-y"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
