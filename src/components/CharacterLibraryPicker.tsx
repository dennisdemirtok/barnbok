'use client';

import { useEffect, useState } from 'react';
import { SavedCharacter } from '@/lib/types';
import { listSavedCharacters } from '@/lib/storage';
import Icon from './Icon';

interface Props {
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  // Valfritt: länk till Karaktärer-menyn i tomläget
  onOpenStudio?: () => void;
}

// Kompakt flerval av sparade karaktärer (avatar + namn). Används i AI-bokskaparen
// och i steg 2 för att ta med färdiga figurer in i en bok.
export default function CharacterLibraryPicker({ selectedIds, onChange, onOpenStudio }: Props) {
  const [characters, setCharacters] = useState<SavedCharacter[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    listSavedCharacters()
      .then(saved => {
        if (cancelled) return;
        saved.sort((a, b) => new Date(b.savedAt || 0).getTime() - new Date(a.savedAt || 0).getTime());
        setCharacters(saved);
      })
      .catch(err => {
        console.error('Kunde inte ladda sparade karaktärer:', err);
        if (!cancelled) setError('Kunde inte ladda sparade karaktärer.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = (id: string) => {
    onChange(selectedIds.includes(id) ? selectedIds.filter(x => x !== id) : [...selectedIds, id]);
  };

  // Räkna bara val som fortfarande finns (en karaktär kan ha tagits bort)
  const selectedCount = characters.filter(c => selectedIds.includes(c.id)).length;

  if (loading) {
    return (
      <div className="flex flex-wrap gap-2" aria-busy="true">
        {[0, 1, 2].map(i => <div key={i} className="skeleton h-10 w-28 !rounded-full" />)}
      </div>
    );
  }

  if (error) return <div className="note-error">{error}</div>;

  if (characters.length === 0) {
    return (
      <div className="flex items-start gap-3 rounded-2xl border border-dashed border-ink/20 bg-white/60 px-4 py-3">
        <Icon name="groups" size={22} className="text-ink/40 mt-0.5 shrink-0" />
        <p className="text-sm text-ink/60 leading-snug">
          Du har inga sparade karaktärer än. Skapa och spara figurer under{' '}
          {onOpenStudio ? (
            <button type="button" onClick={onOpenStudio} className="font-semibold text-brand underline underline-offset-2">
              Karaktärer
            </button>
          ) : (
            <span className="font-semibold text-ink">Karaktärer</span>
          )}{' '}
          i menyn, så kan du välja dem här.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 text-xs text-ink/50">
        <span>
          {selectedCount > 0
            ? `${selectedCount} av ${characters.length} valda`
            : `${characters.length} sparade ${characters.length === 1 ? 'karaktär' : 'karaktärer'}`}
        </span>
        {selectedCount > 0 && (
          <button type="button" onClick={() => onChange([])} className="font-semibold text-ink/60 hover:text-ink">
            Rensa
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Sparade karaktärer">
        {characters.map(c => {
          const on = selectedIds.includes(c.id);
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => toggle(c.id)}
              aria-pressed={on}
              title={[c.name, c.age, c.fromBookTitle && `från ${c.fromBookTitle}`].filter(Boolean).join(' · ')}
              className={`inline-flex items-center gap-2 max-w-[14rem] pl-1 pr-3 py-1 rounded-full text-sm font-medium border transition-all active:scale-[0.98] ${
                on ? 'bg-ink text-white border-ink' : 'bg-white text-ink/80 border-line hover:border-ink/30'
              }`}
            >
              <span className={`relative w-8 h-8 shrink-0 rounded-full overflow-hidden bg-paper ${on ? 'ring-2 ring-white/70' : 'ring-1 ring-line'}`}>
                {c.referenceImage ? (
                  // Referensbladet visar framvyn till vänster - beskär mot den
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`data:image/png;base64,${c.referenceImage}`}
                    alt=""
                    className="absolute inset-0 w-full h-full object-cover object-[22%_20%]"
                  />
                ) : (
                  <span className="absolute inset-0 flex items-center justify-center text-xs font-semibold text-ink/50">
                    {c.name.trim().charAt(0).toUpperCase() || '?'}
                  </span>
                )}
                {on && (
                  <span className="absolute inset-0 flex items-center justify-center bg-ink/45 text-white">
                    <Icon name="check" size={18} />
                  </span>
                )}
              </span>
              <span className="truncate">{c.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
