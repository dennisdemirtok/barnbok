'use client';

import { useState, useEffect } from 'react';
import { BookProject, Spread, Character, BookFormat } from '@/lib/types';
import Icon from './Icon';

interface Props {
  book: BookProject;
  onUpdateSpread: (updatedSpread: Spread) => void;
}

const AI_SUGGESTIONS = [
  'Gör scenen mer dramatisk',
  'Ljusare, gladare färger',
  'Mer mysig stämning',
  'Zooma in på ansiktena',
  'Lägg till mer detaljer i bakgrunden',
  'Mer action och rörelse',
];

const spreadLabel = (s: Spread) =>
  s.pages === 'omslag' ? 'Omslag' : s.pages === 'slutsida' ? 'Slutsida' : `Sida ${s.pages}`;

export default function Workshop({ book, onUpdateSpread }: Props) {
  const characters: Character[] = book.characters;
  const styleGuide = book.styleGuide;
  const bookFormat = book.bookFormat as BookFormat | undefined;

  const [selectedId, setSelectedId] = useState<string>(book.spreads[0]?.id ?? '');
  const [draft, setDraft] = useState<Spread | null>(null);
  const [customInstruction, setCustomInstruction] = useState('');
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState('');
  const [flash, setFlash] = useState('');

  const selected = book.spreads.find(s => s.id === selectedId) || book.spreads[0];

  // Ladda arbetskopia när valt uppslag byts
  useEffect(() => {
    if (selected) setDraft({ ...selected, textBlocks: selected.textBlocks.map(b => ({ ...b })) });
    setCustomInstruction('');
    setError('');
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!selected || !draft) {
    return <p className="text-center text-gray-400 py-10">Inga uppslag att redigera.</p>;
  }

  const doneCount = book.spreads.filter(s => s.generatedImage).length;
  const progress = book.spreads.length ? Math.round((doneCount / book.spreads.length) * 100) : 0;

  const updateText = (idx: number, text: string) => {
    const blocks = [...draft.textBlocks];
    blocks[idx] = { ...blocks[idx], text };
    setDraft({ ...draft, textBlocks: blocks });
  };

  const saveText = () => {
    onUpdateSpread(draft);
    setFlash('Ändringar sparade ✓');
    setTimeout(() => setFlash(''), 2500);
  };

  const regenerate = async () => {
    setRegenerating(true);
    setError('');
    try {
      const res = await fetch('/api/generate-page', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          spread: draft,
          characters,
          styleGuide,
          bookFormat,
          customInstructions: customInstruction || undefined,
          isRegenerate: true,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Regenerering misslyckades');
      }
      const { image } = await res.json();
      const updated = { ...draft, generatedImage: image, status: 'done' as const };
      setDraft(updated);
      onUpdateSpread(updated); // spara direkt
      setFlash('Ny bild genererad och sparad ✓');
      setTimeout(() => setFlash(''), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Något gick fel');
    } finally {
      setRegenerating(false);
    }
  };

  const addSuggestion = (s: string) => {
    setCustomInstruction(prev => (prev ? `${prev}. ${s}` : s));
  };

  return (
    <div className="space-y-5">
      {/* Uppslags-flikar */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {book.spreads.map((s) => (
          <button
            key={s.id}
            onClick={() => setSelectedId(s.id)}
            className={`shrink-0 px-4 py-2 rounded-full text-sm font-heading font-semibold transition-all ${
              s.id === selectedId
                ? 'bg-gradient-to-r from-brand to-magic text-white shadow-glow'
                : 'glass text-gray-600 hover:text-brand'
            }`}
          >
            {spreadLabel(s)}
            {!s.generatedImage && <span className="ml-1 opacity-60">○</span>}
          </button>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Vänster: text + AI-förslag */}
        <div className="glass rounded-4xl p-5 space-y-4">
          <div>
            <h3 className="font-heading font-bold text-lg text-gray-800">{spreadLabel(selected)}</h3>
            {selected.chapter && <p className="text-sm text-gray-500">{selected.chapter}</p>}
          </div>

          <div className="space-y-3">
            <h4 className="font-heading font-semibold text-gray-700 text-sm">Text</h4>
            {draft.textBlocks.length === 0 && (
              <p className="text-sm text-gray-400 italic">Det här uppslaget har ingen text.</p>
            )}
            {draft.textBlocks.map((block, idx) => (
              <textarea
                key={idx}
                value={block.text}
                onChange={(e) => updateText(idx, e.target.value)}
                className="field h-24 text-sm resize-y"
              />
            ))}
          </div>

          <div className="space-y-2">
            <h4 className="font-heading font-semibold text-gray-700 text-sm flex items-center gap-1.5">
              <Icon name="auto_awesome" filled size={18} className="text-magic" /> AI-förslag
            </h4>
            <div className="flex flex-wrap gap-2">
              {AI_SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => addSuggestion(s)} className="magic-chip hover:ring-brand/40 transition-all">
                  {s}
                </button>
              ))}
            </div>
            <textarea
              value={customInstruction}
              onChange={(e) => setCustomInstruction(e.target.value)}
              placeholder="...eller skriv egna instruktioner för bilden"
              className="field h-20 text-sm resize-y"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <button onClick={regenerate} disabled={regenerating} className="btn-action inline-flex items-center gap-1.5">
              {regenerating ? 'Genererar...' : <><Icon name="auto_fix_high" filled size={18} /> Regenerera bild</>}
            </button>
            <button onClick={saveText} className="btn-primary">Spara ändringar</button>
          </div>

          {flash && <p className="text-sm text-emerald-600 font-medium">{flash}</p>}
          {error && <div className="p-3 bg-red-50 border border-red-200 rounded-2xl text-red-700 text-sm">{error}</div>}
        </div>

        {/* Höger: stor bild + förlopp */}
        <div className="glass rounded-4xl p-5 flex flex-col">
          <div className="flex-1 rounded-2xl overflow-hidden bg-white/40 flex items-center justify-center min-h-[300px]">
            {regenerating ? (
              <div className="text-center">
                <svg className="animate-spin h-10 w-10 text-brand mx-auto mb-3" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                <p className="text-gray-500">Genererar &amp; kvalitetskontrollerar...</p>
              </div>
            ) : draft.generatedImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`data:image/png;base64,${draft.generatedImage}`} alt={spreadLabel(selected)} className="w-full h-auto" />
            ) : (
              <p className="text-gray-400">Ingen bild än – tryck "Regenerera bild"</p>
            )}
          </div>

          {/* Bokförlopp */}
          <div className="mt-4">
            <div className="flex justify-between text-xs text-gray-500 mb-1">
              <span className="font-heading font-semibold">Bokförlopp</span>
              <span>{doneCount} / {book.spreads.length} bilder · {progress}%</span>
            </div>
            <div className="h-2.5 rounded-full bg-brand/10 overflow-hidden">
              <div className="h-full rounded-full bg-gradient-to-r from-trust via-brand to-magic transition-all duration-500"
                   style={{ width: `${progress}%` }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
