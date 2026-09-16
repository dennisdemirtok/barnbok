'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  getLikeCounts, getMyLikedBookIds, listPublicBooks, loadPublicBookDetails, PublicBookDetails, PublicBookSummary, PublicCharacter, setBookLiked,
} from '@/lib/supabase-db';
import { useAuth } from '@/lib/auth';
import Icon from './Icon';
import StepHeader from './StepHeader';
import AuthorPage from './bookstore/AuthorPage';
import BookCard from './bookstore/BookCard';
import BookDetail from './bookstore/BookDetail';
import CharacterDetail from './bookstore/CharacterDetail';
import { FORMAT_LABEL, LikesState } from './bookstore/shared';

interface Props {
  onBack: () => void;
  // Bok-id från en delningslänk (/?bok=<id>) - öppnas direkt på bokens sida
  initialBookId?: string;
}

type SortKey = 'nyast' | 'gillade' | 'titel';

type View =
  | { kind: 'list' }
  | { kind: 'book'; details: PublicBookDetails }
  | { kind: 'author'; userId: string; name: string }
  | { kind: 'character'; character: PublicCharacter; bookId: string; bookTitle: string };

export default function Bookstore({ onBack, initialBookId }: Props) {
  const { user } = useAuth();
  const [books, setBooks] = useState<PublicBookSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [format, setFormat] = useState<string>('alla');
  const [sort, setSort] = useState<SortKey>('nyast');
  // Navigeringsstack: lista -> bok -> skapare -> bok ...
  const [stack, setStack] = useState<View[]>([{ kind: 'list' }]);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [openError, setOpenError] = useState('');

  // Hjärtan (döljs helt om migreringen inte körts)
  const [likesSupported, setLikesSupported] = useState(false);
  const [likeCounts, setLikeCounts] = useState<Record<string, number>>({});
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set());
  const [likeError, setLikeError] = useState('');
  const likePending = useRef(new Set<string>());

  const view = stack[stack.length - 1];

  useEffect(() => {
    listPublicBooks()
      .then(setBooks)
      .catch(() => {})
      .finally(() => setLoading(false));
    getLikeCounts()
      .then(counts => {
        if (!counts) return;
        setLikesSupported(true);
        setLikeCounts(counts);
      })
      .catch(() => {});
  }, []);

  // Mina hjärtan - hämtas om vid in-/utloggning (kontot ersätter enhets-id:t)
  const bookIdsKey = books.map(b => b.id).join(',');
  useEffect(() => {
    if (!likesSupported || books.length === 0) return;
    let cancelled = false;
    getMyLikedBookIds(books.map(b => b.id))
      .then(ids => { if (!cancelled) setLikedIds(ids); })
      .catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [likesSupported, bookIdsKey, user?.id]);

  useEffect(() => {
    if (initialBookId) openBook(initialBookId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialBookId]);

  // Delningslänken speglar den bok som visas (rör inte URL:en vid första render,
  // då en ?bok=-länk fortfarande håller på att öppnas)
  const urlSynced = useRef(false);
  useEffect(() => {
    if (!urlSynced.current) {
      urlSynced.current = true;
      if (view.kind === 'list') return;
    }
    const path = window.location.pathname;
    if (view.kind === 'book') {
      window.history.replaceState(null, '', `${path}?bok=${view.details.book.id}`);
    } else if (view.kind === 'character') {
      // En karaktärssida hör till sin bok - behåll bokens länk
      window.history.replaceState(null, '', `${path}?bok=${view.bookId}`);
    } else if (window.location.search.includes('bok=')) {
      window.history.replaceState(null, '', path);
    }
  }, [view]);

  const openBook = async (id: string) => {
    setOpeningId(id);
    setOpenError('');
    try {
      const details = await loadPublicBookDetails(id);
      if (!details) throw new Error('Boken kunde inte hittas. Den kan ha tagits bort eller avpublicerats.');
      setStack(prev => {
        // Samma bok igen (t.ex. dubbelklick eller dubbelkörd effekt) ersätter i stället för att staplas
        const top = prev[prev.length - 1];
        const base = top.kind === 'book' && top.details.book.id === id ? prev.slice(0, -1) : prev;
        return [...base, { kind: 'book', details }];
      });
      window.scrollTo({ top: 0 });
    } catch (err) {
      setOpenError(err instanceof Error ? err.message : 'Kunde inte öppna boken');
    } finally {
      setOpeningId(null);
    }
  };

  const openCharacter = (character: PublicCharacter, bookId: string, bookTitle: string) => {
    setOpenError('');
    setStack(prev => [...prev, { kind: 'character', character, bookId, bookTitle }]);
    window.scrollTo({ top: 0 });
  };

  const openAuthor = (userId: string, name: string) => {
    setOpenError('');
    setStack(prev => [...prev, { kind: 'author', userId, name }]);
    window.scrollTo({ top: 0 });
  };

  const goBack = () => {
    setOpenError('');
    setStack(prev => (prev.length > 1 ? prev.slice(0, -1) : prev));
    window.scrollTo({ top: 0 });
  };

  const toggleLike = useCallback(async (bookId: string) => {
    if (likePending.current.has(bookId)) return;
    likePending.current.add(bookId);
    const next = !likedIds.has(bookId);
    const applyLiked = (liked: boolean) => setLikedIds(prev => {
      const s = new Set(prev);
      if (liked) s.add(bookId); else s.delete(bookId);
      return s;
    });

    // Optimistiskt: visa direkt, stäm av mot servern efteråt
    applyLiked(next);
    setLikeCounts(prev => ({ ...prev, [bookId]: Math.max(0, (prev[bookId] ?? 0) + (next ? 1 : -1)) }));
    setLikeError('');
    try {
      const total = await setBookLiked(bookId, next);
      setLikeCounts(prev => ({ ...prev, [bookId]: total }));
    } catch {
      applyLiked(!next);
      setLikeCounts(prev => ({ ...prev, [bookId]: Math.max(0, (prev[bookId] ?? 0) + (next ? -1 : 1)) }));
      setLikeError('Hjärtat kunde inte sparas. Försök igen.');
      setTimeout(() => setLikeError(''), 3500);
    } finally {
      likePending.current.delete(bookId);
    }
  }, [likedIds]);

  const likes: LikesState = useMemo(() => ({
    supported: likesSupported,
    counts: likeCounts,
    liked: likedIds,
    toggle: toggleLike,
  }), [likesSupported, likeCounts, likedIds, toggleLike]);

  const handleDescription = (bookId: string, description: string) => {
    setBooks(prev => prev.map(b => (b.id === bookId ? { ...b, description } : b)));
  };

  const likeToast = likeError && (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 w-[calc(100%-2rem)] max-w-sm note-error shadow-lift text-center" role="status">
      {likeError}
    </div>
  );

  const previous = stack[stack.length - 2];
  const backLabel = previous?.kind === 'book' ? previous.details.book.title : 'Bokhandeln';

  // ── Bokens sida ──
  if (view.kind === 'book') {
    const { details } = view;
    const authorId = details.summary.userId;
    const moreByAuthor = authorId ? books.filter(b => b.userId === authorId && b.id !== details.book.id) : [];
    return (
      <>
        {openError && <div className="note-error mb-4">{openError}</div>}
        <BookDetail
          key={details.book.id}
          details={details}
          likes={likes}
          moreByAuthor={moreByAuthor}
          openingId={openingId}
          onBack={goBack}
          onOpenAuthor={openAuthor}
          onOpenBook={openBook}
          onOpenCharacter={c => openCharacter(c, details.book.id, details.book.title)}
          onDescription={handleDescription}
        />
        {likeToast}
      </>
    );
  }

  // ── Karaktärens sida ──
  if (view.kind === 'character') {
    return (
      <>
        {openError && <div className="note-error mb-4">{openError}</div>}
        <CharacterDetail
          key={view.character.id}
          character={view.character}
          bookId={view.bookId}
          bookTitle={view.bookTitle}
          openingId={openingId}
          onBack={goBack}
          onOpenBook={openBook}
        />
        {likeToast}
      </>
    );
  }

  // ── Skaparens sida ──
  if (view.kind === 'author') {
    return (
      <>
        <AuthorPage
          key={view.userId}
          authorUserId={view.userId}
          authorName={view.name}
          likes={likes}
          openingId={openingId}
          openError={openError}
          backLabel={backLabel}
          onBack={goBack}
          onOpenBook={openBook}
        />
        {likeToast}
      </>
    );
  }

  // ── Listan ──
  const formats = Array.from(new Set(books.map(b => b.bookFormat).filter(Boolean))) as string[];
  const q = query.trim().toLowerCase();
  const activeSort: SortKey = sort === 'gillade' && !likesSupported ? 'nyast' : sort;
  const byNewest = (a: PublicBookSummary, b: PublicBookSummary) =>
    new Date(b.publishedAt || 0).getTime() - new Date(a.publishedAt || 0).getTime();
  const filtered = books
    .filter(b =>
      (format === 'alla' || b.bookFormat === format) &&
      (!q ||
        b.title.toLowerCase().includes(q) ||
        (b.authorName || '').toLowerCase().includes(q) ||
        (b.description || '').toLowerCase().includes(q))
    )
    .sort((a, b) => {
      if (activeSort === 'titel') return a.title.localeCompare(b.title, 'sv');
      if (activeSort === 'gillade') return (likeCounts[b.id] ?? 0) - (likeCounts[a.id] ?? 0) || byNewest(a, b);
      return byNewest(a, b);
    });

  return (
    <div className="space-y-8">
      <StepHeader
        eyebrow="Bokhandeln"
        title="Böcker från skaparna"
        description="Läs gratis, ge hjärtan till dina favoriter, ladda ner och dela med en länk."
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
            placeholder="Sök titel, skapare eller handling"
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
            value={activeSort}
            onChange={e => setSort(e.target.value as SortKey)}
            className="chip shrink-0 !pr-3 cursor-pointer"
            aria-label="Sortera"
          >
            <option value="nyast">Nyast</option>
            {likesSupported && <option value="gillade">Mest gillade</option>}
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
          <h3 className="mt-3 text-xl font-heading font-bold text-ink">
            {books.length === 0 ? 'Inga böcker ännu' : 'Inga träffar'}
          </h3>
          <p className="mt-1 text-ink/55">
            {books.length === 0 ? 'Böcker som sparas i molnet dyker upp här.' : 'Prova en annan sökning eller ett annat filter.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-x-5 gap-y-8">
          {filtered.map(b => (
            <BookCard
              key={b.id}
              book={b}
              likes={likes}
              opening={openingId === b.id}
              disabled={!!openingId}
              onOpen={() => openBook(b.id)}
            />
          ))}
        </div>
      )}
      {likeToast}
    </div>
  );
}
