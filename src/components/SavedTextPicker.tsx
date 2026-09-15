'use client';

import { useState, useEffect } from 'react';
import { SavedText, BookFormat } from '@/lib/types';
import { listSavedTexts, deleteSavedText } from '@/lib/storage';
import Icon from './Icon';
import StepHeader from './StepHeader';

const FORMAT_LABELS: Record<BookFormat, string> = {
  'bildbok-text-pa-bild': 'Text på bild',
  'bildbok-separat-text': 'Separat text',
  'kapitelbok': 'Kapitelbok',
  'larobok': 'Lärobok',
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
        <div className="text-ink/55 inline-flex items-center gap-2"><span className="spinner" /> Laddar sparade texter...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <StepHeader
        eyebrow="Steg 1 av 4 · Sparade texter"
        title="Välj en sparad text"
        description={texts.length > 0
          ? `Du har ${texts.length} sparad${texts.length > 1 ? 'e' : ''} text${texts.length > 1 ? 'er' : ''}. Välj en för att skapa en ny bok av den.`
          : undefined}
        onBack={onBack}
      />

      {texts.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {texts.map((text) => (
            <div
              key={text.id}
              onClick={() => onTextSelected(text)}
              className="card-glass p-5 hover:-translate-y-0.5 cursor-pointer group"
            >
              <div className="flex items-start justify-between mb-2">
                <h3 className="font-heading font-semibold text-ink leading-snug">
                  {text.title}
                </h3>
                {text.bookFormat && (
                  <span className="magic-chip shrink-0 ml-2">
                    {FORMAT_LABELS[text.bookFormat] || text.bookFormat}
                  </span>
                )}
              </div>

              <div className="flex gap-3 text-xs text-ink/40 mb-3">
                <span>{text.characterCount} karaktärer</span>
                <span>{text.spreadCount} uppslag</span>
              </div>

              <p className="text-xs text-ink/55 line-clamp-2 mb-3">
                {text.rawText.substring(0, 150)}...
              </p>

              <div className="flex items-center justify-between">
                <span className="text-xs text-ink/40">
                  {new Date(text.savedAt).toLocaleDateString('sv-SE')}
                </span>
                <button
                  onClick={(e) => handleDelete(e, text.id, text.title)}
                  className="text-xs font-medium text-red-500 hover:text-red-700 sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100 transition-opacity"
                >
                  Ta bort
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-3xl border border-dashed border-ink/20 bg-white/60 px-6 py-14 text-center">
          <Icon name="description" size={32} className="text-ink/30" />
          <h3 className="mt-3 text-xl font-heading font-semibold text-ink">Inga sparade texter</h3>
          <p className="mt-1 text-ink/55 max-w-sm mx-auto">
            När du skapar eller importerar en bok kan du spara texten för att återanvända den.
          </p>
        </div>
      )}
    </div>
  );
}
