'use client';

import { useEffect, useState } from 'react';
import { BookProject } from '@/lib/types';
import { listPublicBooks, loadPublicBook, PublicBookSummary } from '@/lib/supabase-db';
import BookReader from './BookReader';
import Icon from './Icon';
import StepHeader from './StepHeader';

interface Props {
  onBack: () => void;
  // Bok-id från en delningslänk (/?bok=<id>) - öppnas direkt i läsaren
  initialBookId?: string;
}

const FORMAT_LABEL: Record<string, string> = {
  'bildbok-text-pa-bild': 'Serieformat',
  'bildbok-separat-text': 'Bilderbok',
  'kapitelbok': 'Kapitelbok',
  'larobok': 'Lärobok',
};

type SortKey = 'nyast' | 'titel';

export default function Bookstore({ onBack, initialBookId }: Props) {
  const [books, setBooks] = useState<PublicBookSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [format, setFormat] = useState<string>('alla');
  const [sort, setSort] = useState<SortKey>('nyast');
  const [reading, setReading] = useState<BookProject | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [openError, setOpenError] = useState('');

  useEffect(() => {
    listPublicBooks()
      .then(setBooks)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (initialBookId) openBook(initialBookId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialBookId]);

  const openBook = async (id: string) => {
    setOpeningId(id);
    setOpenError('');
    try {
      const book = await loadPublicBook(id);
      if (!book) throw new Error('Boken kunde inte hittas. Den kan ha tagits bort eller avpublicerats.');
      setReading(book);
      window.history.replaceState(null, '', `${window.location.pathname}?bok=${id}`);
      window.scrollTo({ top: 0 });
    } catch (err) {
      setOpenError(err instanceof Error ? err.message : 'Kunde inte öppna boken');
    } finally {
      setOpeningId(null);
    }
  };

  const closeReader = () => {
    setReading(null);
    window.history.replaceState(null, '', window.location.pathname);
  };

  const shareBook = async (id: string, title: string) => {
    const url = `${window.location.origin}/?bok=${id}`;
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title, url });
        return;
      } catch {
        // Avbruten delning - kopiera i stället
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      window.prompt('Kopiera länken:', url);
    }
  };

  // ── Läsare ──
  if (reading) {
    return (
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div className="min-w-0">
            <button onClick={closeReader} className="inline-flex items-center gap-1 -ml-1 px-1 text-sm font-medium text-ink/55 hover:text-ink transition-colors">
              <Icon name="arrow_back" size={18} /> Bokhandeln
            </button>
            <h2 className="mt-2 text-3xl sm:text-4xl font-heading font-semibold text-ink truncate">{reading.title}</h2>
            {reading.author && <p className="mt-1 text-ink/55">av {reading.author}</p>}
          </div>
          <button onClick={() => shareBook(reading.id, reading.title)} className="btn-primary shrink-0">
            <Icon name={copied ? 'check' : 'ios_share'} size={19} />
            {copied ? 'Länken är kopierad' : 'Dela boken'}
          </button>
        </div>
        <div className="card-glass hover:!shadow-soft px-2 py-4 sm:p-8 -mx-2 sm:mx-0">
          <BookReader book={reading} />
        </div>
      </div>
    );
  }

  const formats = Array.from(new Set(books.map(b => b.bookFormat).filter(Boolean))) as string[];
  const filtered = books
    .filter(b =>
      (format === 'alla' || b.bookFormat === format) &&
      (!query ||
        b.title.toLowerCase().includes(query.toLowerCase()) ||
        (b.authorName || '').toLowerCase().includes(query.toLowerCase()))
    )
    .sort((a, b) => sort === 'titel'
      ? a.title.localeCompare(b.title, 'sv')
      : new Date(b.publishedAt || 0).getTime() - new Date(a.publishedAt || 0).getTime());

  return (
    <div className="space-y-8">
      <StepHeader
        eyebrow="Bokhandeln"
        title="Böcker från skaparna"
        description="Läs gratis, bläddra som i en riktig bok och dela med en länk."
        onBack={onBack}
        backLabel="Mina böcker"
        actions={!loading && <span className="text-sm text-ink/45">{books.length} {books.length === 1 ? 'bok' : 'böcker'}</span>}
      />

      {/* Sök och filter */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-md">
          <Icon name="search" size={20} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink/40" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Sök titel eller skapare"
            className="field !pl-11"
          />
        </div>
        <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-4 px-4 sm:mx-0 sm:px-0">
          {['alla', ...formats].map(f => (
            <button key={f} onClick={() => setFormat(f)} className={`${format === f ? 'chip-on' : 'chip'} shrink-0`}>
              {f === 'alla' ? 'Alla' : FORMAT_LABEL[f] || f}
            </button>
          ))}
          <select
            value={sort}
            onChange={e => setSort(e.target.value as SortKey)}
            className="chip shrink-0 !pr-3 cursor-pointer"
            aria-label="Sortera"
          >
            <option value="nyast">Nyast</option>
            <option value="titel">Titel A–Ö</option>
          </select>
        </div>
      </div>

      {openError && <div className="note-error">{openError}</div>}

      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-5">
          {[0, 1, 2, 3, 4].map(i => <div key={i} className="skeleton aspect-[3/4] rounded-2xl" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-ink/20 bg-white/60 px-6 py-14 text-center">
          <Icon name="storefront" size={32} className="text-ink/30" />
          <h3 className="mt-3 text-xl font-heading font-semibold text-ink">
            {books.length === 0 ? 'Inga böcker ännu' : 'Inga träffar'}
          </h3>
          <p className="mt-1 text-ink/55">
            {books.length === 0 ? 'Böcker som sparas i molnet dyker upp här.' : 'Prova en annan sökning eller ett annat filter.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-x-5 gap-y-8">
          {filtered.map(b => (
            <div key={b.id} className="group">
              <button
                onClick={() => openBook(b.id)}
                disabled={!!openingId}
                className="relative block w-full aspect-[3/4] rounded-2xl overflow-hidden bg-white border border-line shadow-soft
                           group-hover:shadow-lift group-hover:-translate-y-1 transition-all duration-200"
                title={`Läs ${b.title}`}
              >
                {b.coverUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={b.coverUrl} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
                ) : (
                  <div className="absolute inset-0 flex flex-col justify-between p-4 bg-gradient-to-b from-paper to-white text-left">
                    <Icon name="auto_stories" size={26} className="text-ink/25" />
                    <span className="font-heading text-lg font-semibold text-ink/80 leading-tight line-clamp-4 break-words hyphens-auto">{b.title}</span>
                  </div>
                )}
                <span className="absolute inset-y-0 left-0 w-2 bg-gradient-to-r from-black/15 to-transparent" />
                {openingId === b.id && (
                  <span className="absolute inset-0 bg-white/70 flex items-center justify-center text-ink">
                    <span className="spinner !w-7 !h-7" />
                  </span>
                )}
              </button>
              <div className="mt-3 flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="font-heading font-semibold text-ink leading-snug truncate" title={b.title}>{b.title}</h3>
                  <p className="text-xs text-ink/50 mt-0.5 truncate">
                    {b.authorName ? `${b.authorName} · ` : ''}{FORMAT_LABEL[b.bookFormat || ''] || 'Bok'}
                  </p>
                </div>
                <button
                  onClick={() => shareBook(b.id, b.title)}
                  title="Dela boken"
                  className="btn-icon !w-8 !h-8 shrink-0 -mr-1.5"
                >
                  <Icon name="ios_share" size={17} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
