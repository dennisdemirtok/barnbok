'use client';

import { useEffect, useState } from 'react';
import { BookProject, Spread } from '@/lib/types';
import { listPublicBooks, loadPublicBook, PublicBookSummary } from '@/lib/supabase-db';
import Icon from './Icon';

interface Props {
  onBack: () => void;
}

const FORMAT_LABEL: Record<string, string> = {
  'bildbok-text-pa-bild': 'Bildbok',
  'bildbok-separat-text': 'Bildbok',
  'kapitelbok': 'Kapitelbok',
  'larobok': 'Lärobok',
};

export default function Bookstore({ onBack }: Props) {
  const [books, setBooks] = useState<PublicBookSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [reading, setReading] = useState<BookProject | null>(null);
  const [loadingRead, setLoadingRead] = useState(false);

  useEffect(() => {
    listPublicBooks()
      .then(setBooks)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const openBook = async (id: string) => {
    setLoadingRead(true);
    try {
      const book = await loadPublicBook(id);
      if (book) setReading(book);
    } finally {
      setLoadingRead(false);
    }
  };

  const filtered = books.filter(b =>
    !query ||
    b.title.toLowerCase().includes(query.toLowerCase()) ||
    (b.authorName || '').toLowerCase().includes(query.toLowerCase())
  );

  // ── Läsare ──
  if (reading) {
    const spreads = (reading.spreads as (Spread & { imageUrl?: string })[])
      .filter(s => s.imageUrl);
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-heading font-bold text-gray-800">{reading.title}</h2>
            <p className="text-sm text-gray-500">{spreads.length} uppslag</p>
          </div>
          <button onClick={() => setReading(null)} className="btn-ghost">← Tillbaka till bokhandeln</button>
        </div>
        <div className="space-y-6 max-w-3xl mx-auto">
          {spreads.map((s) => (
            <div key={s.id} className="card-glass overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={s.imageUrl} alt={`Uppslag ${s.pages}`} className="w-full h-auto" />
            </div>
          ))}
          {spreads.length === 0 && (
            <p className="text-center text-gray-400 py-10">Den här boken har inga bilder att visa.</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-4xl px-6 sm:px-12 py-10 text-white
                          bg-gradient-to-br from-trust via-brand to-magic shadow-glow-lg">
        <div className="absolute -top-16 -right-10 w-64 h-64 rounded-full bg-white/15 blur-3xl" />
        <div className="relative z-10 flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-3xl sm:text-4xl font-bold">Bokhandeln</h1>
            <p className="mt-2 text-white/85 text-lg">Upptäck och läs böcker som andra har skapat – helt gratis.</p>
          </div>
          <button onClick={onBack} className="px-5 py-2.5 rounded-full bg-white/15 backdrop-blur
                     ring-1 ring-white/30 font-heading font-semibold hover:bg-white/25 transition-colors">
            ← Till mitt bibliotek
          </button>
        </div>
      </section>

      {/* Sök */}
      <div className="max-w-md">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Sök på titel eller skapare..."
          className="field"
        />
      </div>

      {loading ? (
        <div className="text-center py-16 text-gray-400">Laddar böcker...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 glass rounded-4xl border-dashed border-2 border-brand/20">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-brand/10 flex items-center justify-center">
            <Icon name="storefront" filled size={32} className="text-brand" />
          </div>
          <h3 className="text-lg font-heading font-semibold text-gray-700 mb-1">
            {books.length === 0 ? 'Inga publicerade böcker än' : 'Inga träffar'}
          </h3>
          <p className="text-gray-400">
            {books.length === 0 ? 'Bli först att publicera en bok från granska-steget!' : 'Prova en annan sökning.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {filtered.map((b) => (
            <button
              key={b.id}
              onClick={() => openBook(b.id)}
              disabled={loadingRead}
              className="card-glass overflow-hidden text-left hover:-translate-y-1 group disabled:opacity-60"
            >
              <div className="aspect-[3/2] bg-brand/5 relative overflow-hidden">
                {b.coverUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={b.coverUrl} alt={b.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                ) : (
                  <div className="flex items-center justify-center h-full text-brand/30">
                    <Icon name="menu_book" size={48} />
                  </div>
                )}
                <span className="absolute top-3 left-3 px-3 py-1 rounded-full bg-white/90 backdrop-blur text-xs font-bold text-brand shadow-glow">
                  {FORMAT_LABEL[b.bookFormat || ''] || 'Bok'}
                </span>
              </div>
              <div className="p-4">
                <h3 className="font-heading font-bold text-gray-800 group-hover:text-brand transition-colors">{b.title}</h3>
                <p className="text-sm text-gray-500 mt-0.5">
                  {b.authorName ? `av ${b.authorName}` : 'Anonym skapare'} · {b.numSpreads} uppslag
                </p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
