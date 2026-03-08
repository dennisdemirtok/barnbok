'use client';

import { useState } from 'react';
import { Character, Spread, TextBlock, BookFormat } from '@/lib/types';

interface Props {
  spread: Spread;
  characters: Character[];
  styleGuide: string;
  bookFormat?: BookFormat;
  onSave: (updatedSpread: Spread) => void;
  onClose: () => void;
}

export default function PageEditor({ spread, characters, styleGuide, bookFormat, onSave, onClose }: Props) {
  const [editedSpread, setEditedSpread] = useState<Spread>({ ...spread });
  const [customInstructions, setCustomInstructions] = useState('');
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [error, setError] = useState('');
  const [previewImage, setPreviewImage] = useState(spread.generatedImage);

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
          customInstructions: customInstructions || undefined,
          isRegenerate: true,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Regenerering misslyckades');
      }

      const { image } = await res.json();
      setPreviewImage(image);
      setEditedSpread(prev => ({ ...prev, generatedImage: image, status: 'done' }));
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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl max-w-6xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b p-4 flex items-center justify-between z-10">
          <h3 className="text-lg font-bold text-gray-800">
            Redigera {spread.pages === 'omslag' ? 'Omslag' : `Sida ${spread.pages}`}
            {spread.chapter && <span className="text-sm text-gray-500 ml-2">({spread.chapter})</span>}
          </h3>
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
            >
              Spara
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
            >
              Stäng
            </button>
          </div>
        </div>

        <div className="p-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left: Image */}
          <div>
            <h4 className="font-semibold text-gray-700 mb-2">Bild</h4>
            <div className="bg-gray-100 rounded-lg overflow-hidden mb-4">
              {isRegenerating ? (
                <div className="flex items-center justify-center h-64">
                  <div className="text-center">
                    <svg className="animate-spin h-10 w-10 text-blue-600 mx-auto mb-3" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    <p className="text-gray-500">Regenererar bild...</p>
                  </div>
                </div>
              ) : previewImage ? (
                <img
                  src={`data:image/png;base64,${previewImage}`}
                  alt={`Sida ${spread.pages}`}
                  className="w-full object-contain"
                />
              ) : (
                <div className="flex items-center justify-center h-64 text-gray-400">
                  Ingen bild
                </div>
              )}
            </div>

            {/* Quick edit instructions */}
            <div className="space-y-3">
              <h4 className="font-semibold text-gray-700">Snabbredigering</h4>
              <p className="text-xs text-gray-500">
                Beskriv vad du vill ändra utan att ändra karaktärerna.
                T.ex. &quot;Gör det mer dramatiskt&quot; eller &quot;Ändra bakgrunden till natt&quot;
              </p>
              <textarea
                value={customInstructions}
                onChange={(e) => setCustomInstructions(e.target.value)}
                placeholder='T.ex. "Gör scenen mörkare", "Lägg till snö", "Zooma in på ansiktena"...'
                className="w-full h-20 p-3 border rounded-lg text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-200"
              />
              <button
                onClick={regenerateImage}
                disabled={isRegenerating}
                className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700
                           disabled:bg-gray-400 transition-colors"
              >
                {isRegenerating ? 'Genererar...' : 'Regenerera bild'}
              </button>
            </div>

            {error && (
              <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                {error}
              </div>
            )}
          </div>

          {/* Right: Text and prompt */}
          <div className="space-y-4">
            {/* Text blocks */}
            <div>
              <h4 className="font-semibold text-gray-700 mb-2">Sidtext</h4>
              {editedSpread.textBlocks.map((block, idx) => (
                <div key={idx} className="mb-3">
                  <label className="text-xs text-gray-500 mb-1 block">
                    {block.position}
                  </label>
                  <textarea
                    value={block.text}
                    onChange={(e) => updateTextBlock(idx, e.target.value)}
                    className="w-full h-24 p-3 border rounded-lg text-sm focus:border-blue-500
                               focus:ring-1 focus:ring-blue-200 resize-y"
                  />
                </div>
              ))}
            </div>

            {/* Image prompt */}
            <div>
              <h4 className="font-semibold text-gray-700 mb-2">Bildprompt</h4>
              <textarea
                value={editedSpread.imagePrompt}
                onChange={(e) => updateImagePrompt(e.target.value)}
                className="w-full h-48 p-3 border rounded-lg text-sm font-mono
                           focus:border-blue-500 focus:ring-1 focus:ring-blue-200 resize-y"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
