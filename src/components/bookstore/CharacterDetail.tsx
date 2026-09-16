'use client';

import { useEffect, useState } from 'react';
import { CharacterAppearance, downloadImageAsBase64, findCharacterAppearances, PublicCharacter } from '@/lib/supabase-db';
import { saveCharacter } from '@/lib/storage';
import { SavedCharacter } from '@/lib/types';
import Icon from '../Icon';
import { initials } from './shared';

interface Props {
  character: PublicCharacter;
  bookId: string;
  bookTitle: string;
  // Bok som användaren kom ifrån - används i tillbakaknappen
  onBack: () => void;
  onOpenBook: (id: string) => void;
  openingId: string | null;
}

// En karaktärs egen sida i bokhandeln: karaktärsbladet, fakta, andra böcker
// figuren finns i, och en knapp för att ta med den till sitt eget bibliotek.
export default function CharacterDetail({ character, bookId, bookTitle, onBack, onOpenBook, openingId }: Props) {
  const [appearances, setAppearances] = useState<CharacterAppearance[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setAppearances(null);
    findCharacterAppearances(character.name, bookId)
      .then(list => { if (!cancelled) setAppearances(list); })
      .catch(() => { if (!cancelled) setAppearances([]); });
    return () => { cancelled = true; };
  }, [character.name, bookId]);

  const saveToLibrary = async () => {
    setSaving(true);
    setSaveError('');
    try {
      // Referensbilden ligger i molnet som adress - biblioteket sparar base64
      let referenceImage: string | undefined;
      if (character.imageUrl) {
        referenceImage = (await downloadImageAsBase64(character.imageUrl)) || undefined;
      }
      const toSave: SavedCharacter = {
        id: crypto.randomUUID(),
        name: character.name,
        heroName: character.heroName,
        age: character.age,
        appearance: character.appearance || '',
        normalClothes: character.normalClothes,
        personality: character.personality,
        role: character.role,
        referenceImage,
        faceNotes: character.faceNotes,
        savedAt: new Date().toISOString(),
        fromBookId: bookId,
        fromBookTitle: bookTitle,
      };
      await saveCharacter(toSave);
      setSaved(true);
    } catch (err) {
      console.error('Kunde inte spara karaktären:', err);
      setSaveError('Karaktären kunde inte sparas. Försök igen.');
    } finally {
      setSaving(false);
    }
  };

  const facts: { label: string; value: string }[] = [
    { label: 'Roll i boken', value: character.role === 'main' ? 'Huvudperson' : 'Biroll' },
    { label: 'Ålder', value: character.age || '' },
    { label: 'Hjältenamn', value: character.heroName || '' },
    { label: 'Utseende', value: character.appearance || '' },
    { label: 'Kläder', value: character.normalClothes || '' },
    { label: 'Personlighet', value: character.personality || '' },
  ].filter(f => f.value.trim());

  return (
    <div className="space-y-8">
      <button onClick={onBack} className="inline-flex items-center gap-1 -ml-1 px-1 text-sm font-medium text-ink/55 hover:text-ink transition-colors">
        <Icon name="arrow_back" size={18} /> {bookTitle}
      </button>

      <div className="grid gap-6 sm:gap-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] items-start">
        {/* Karaktärsbladet - ett modellark med flera vyer, visas i sin helhet */}
        <div className="glass rounded-4xl p-3 sm:p-5">
          <div className="relative aspect-[4/3] rounded-3xl overflow-hidden bg-paper border border-line">
            {character.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={character.imageUrl}
                alt={`Karaktärsblad för ${character.name}`}
                className="absolute inset-0 w-full h-full object-contain"
              />
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
                <span className="w-20 h-20 rounded-full bg-brand/10 text-brand font-semibold text-2xl flex items-center justify-center">
                  {initials(character.name)}
                </span>
                <p className="text-sm text-ink/50">Den här karaktären har inget karaktärsblad.</p>
              </div>
            )}
          </div>
        </div>

        {/* Fakta */}
        <div className="min-w-0">
          <p className="eyebrow">{character.role === 'main' ? 'Huvudperson' : 'Biroll'}</p>
          <h2 className="mt-2 text-3xl sm:text-4xl font-heading font-bold tracking-tight text-ink leading-tight break-words">
            {character.name}
          </h2>
          <p className="mt-2 text-ink/60">
            ur <span className="font-semibold text-ink">{bookTitle}</span>
          </p>

          {facts.length > 0 && (
            <dl className="mt-6 space-y-4">
              {facts.map(f => (
                <div key={f.label}>
                  <dt className="text-xs font-semibold uppercase tracking-[0.1em] text-ink/45">{f.label}</dt>
                  <dd className="mt-1 text-[15px] leading-relaxed text-ink/85 break-words">{f.value}</dd>
                </div>
              ))}
            </dl>
          )}

          <div className="mt-7">
            <button onClick={saveToLibrary} disabled={saving || saved} className="btn-action">
              {saving ? <span className="spinner !w-4 !h-4" /> : <Icon name={saved ? 'check' : 'person_add'} size={19} />}
              {saving ? 'Sparar...' : saved ? 'Sparad i dina karaktärer' : 'Använd i en egen bok'}
            </button>
            {saved && (
              <p className="mt-3 text-sm text-ink/60">
                {character.name} finns nu under <span className="font-semibold text-ink">Karaktärer</span> i menyn och kan väljas när du skapar en bok.
              </p>
            )}
            {saveError && <div className="note-error mt-3">{saveError}</div>}
          </div>
        </div>
      </div>

      {/* Finns även i */}
      <section className="space-y-4">
        <h3 className="text-xl font-heading font-bold text-ink">Finns även i</h3>
        {appearances === null ? (
          <div className="flex flex-wrap gap-3">
            {[0, 1].map(i => <div key={i} className="skeleton h-20 w-full sm:w-64 !rounded-3xl" />)}
          </div>
        ) : appearances.length === 0 ? (
          <p className="text-ink/60">
            {character.name} finns än så länge bara i {bookTitle}.
          </p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {appearances.map(a => (
              <li key={a.bookId}>
                <button
                  onClick={() => onOpenBook(a.bookId)}
                  disabled={!!openingId}
                  className="card-glass w-full flex items-center gap-3 p-3 text-left active:scale-[0.99] transition-transform disabled:opacity-60"
                >
                  <span className="relative w-14 h-[4.6rem] shrink-0 rounded-xl overflow-hidden bg-paper border border-line">
                    {a.coverUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={a.coverUrl} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
                    ) : (
                      <span className="absolute inset-0 flex items-center justify-center text-ink/30">
                        <Icon name="auto_stories" size={22} />
                      </span>
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold text-ink leading-snug line-clamp-2">{a.title}</span>
                    {a.authorName && <span className="block mt-0.5 text-sm text-ink/55 truncate">av {a.authorName}</span>}
                  </span>
                  {openingId === a.bookId ? (
                    <span className="spinner !w-4 !h-4 text-ink/40 shrink-0" />
                  ) : (
                    <Icon name="chevron_right" size={20} className="text-ink/35 shrink-0" />
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
