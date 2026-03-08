'use client';

import { useState, useEffect } from 'react';
import { SavedText, BookFormat } from '@/lib/types';
import { listSavedTexts, deleteSavedText } from '@/lib/storage';

const FORMAT_LABELS: Record<BookFormat, string> = {
  'bildbok-text-pa-bild': 'Text pa bild',
  'bildbok-separat-text': 'Separat text',
  'kapitelbok': 'Kapitelbok',
  'larobok': 'Larobok',
};

interface Props {
  onTextSelected: (text: SavedText) => void;
  onBack: () => void;
}

export default function SavedTextPicker({ onTextSelected, onBack }: Props) {
  const [texts, setTexts] = useState<SavedText[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadTexts();
  }, []);

  const loadTexts = async () => {
    try {
      const saved = await listSavedTexts();
      saved.sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime());
      setTexts(saved);
    } catch (err) {
      console.error('Kunde inte ladda sparade texter:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (e: React.MouseEvent, id: string, title: string) => {
    e.stopPropagation();
    if (!confirm(`Vill du ta bort "${title}"?`)) return;
    try {
      await deleteSavedText(id);
      setTexts(prev => prev.filter(t => t.id !== id));
    } catch (err) {
      console.error('Kunde inte ta bort texten:', err);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-gray-500">Laddar sparade texter...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-800 mb-2">Sparade texter</h2>
          <p className="text-gray-600">
            {texts.length > 0
              ? `Du har ${texts.length} sparad${texts.length > 1 ? 'e' : ''} text${texts.length > 1 ? 'er' : ''}.`
              : 'Inga sparade texter an. Skapa en bok och spara texten for att borja.'}
          </p>
        </div>
        <button
          onClick={onBack}
          className="px-4 py-2 text-gray-500 hover:text-gray-700"
        >
          Tillbaka
        </button>
      </div>

      {texts.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {texts.map((text) => (
            <div
              key={text.id}
              onClick={() => onTextSelected(text)}
              className="border-2 border-gray-200 rounded-xl p-4 hover:border-green-400
                         hover:shadow-lg transition-all cursor-pointer group"
            >
              <div className="flex items-start justify-between mb-2">
                <h3 className="font-bold text-gray-800 group-hover:text-green-600 transition-colors">
                  {text.title}
                </h3>
                {text.bookFormat && (
                  <span className="text-xs bg-blue-100 text-blue-600 px-2 py-0.5 rounded-full shrink-0 ml-2">
                    {FORMAT_LABELS[text.bookFormat] || text.bookFormat}
                  </span>
                )}
              </div>

              <div className="flex gap-3 text-xs text-gray-400 mb-3">
                <span>{text.characterCount} karaktarer</span>
                <span>{text.spreadCount} uppslag</span>
              </div>

              <p className="text-xs text-gray-500 line-clamp-2 mb-3">
                {text.rawText.substring(0, 150)}...
              </p>

              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-400">
                  {new Date(text.savedAt).toLocaleDateString('sv-SE')}
                </span>
                <button
                  onClick={(e) => handleDelete(e, text.id, text.title)}
                  className="text-xs text-red-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  Ta bort
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-16 bg-gray-50 rounded-xl">
          <div className="text-5xl mb-4">📝</div>
          <h3 className="text-lg font-semibold text-gray-500 mb-2">Inga sparade texter</h3>
          <p className="text-gray-400">
            Nar du skapar eller importerar en bok kan du spara texten for att ateranvanda den.
          </p>
        </div>
      )}
    </div>
  );
}
