'use client';

import { useEffect, useRef, useState } from 'react';
import { ensureBookDescription, isDescriptionSupported, PublicBookDetails, PublicBookSummary } from '@/lib/supabase-db';
import { exportBookToPDF } from '@/lib/pdf-export';
import BookReader from '../BookReader';
import Icon from '../Icon';
import BookCard from './BookCard';
import LikeButton from './LikeButton';
import PrintOrderModal from './PrintOrderModal';
import { formatAge, formatDate, formatLabel, initials, LikesState, shareBookLink } from './shared';

interface Props {
  details: PublicBookDetails;
  likes: LikesState;
  // Andra publicerade böcker av samma skapare (från bokhandelns lista)
  moreByAuthor: PublicBookSummary[];
  openingId: string | null;
  onBack: () => void;
  onOpenAuthor: (userId: string, name: string) => void;
  onOpenBook: (id: string) => void;
  onDescription: (bookId: string, description: string) => void;
}

export default function BookDetail({ details, likes, moreByAuthor, openingId, onBack, onOpenAuthor, onOpenBook, onDescription }: Props) {
  const { book, summary, characters } = details;
  const readerRef = useRef<HTMLDivElement>(null);
  const [description, setDescription] = useState(summary.description || '');
  const [writingBlurb, setWritingBlurb] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState('');
  const [copied, setCopied] = useState(false);
  const [showPrint, setShowPrint] = useState(false);

  // Baksidestext skapas första gången någon öppnar en bok som saknar en
  useEffect(() => {
    setDescription(summary.description || '');
    if (summary.description || isDescriptionSupported() === false) return;
    let cancelled = false;
    setWritingBlurb(true);
    ensureBookDescription(book.id, book)
      .then(text => {
        if (cancelled || !text) return;
        setDescription(text);
        onDescription(book.id, text);
      })
      .finally(() => { if (!cancelled) setWritingBlurb(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.id]);

  const download = async () => {
    setDownloading(true);
    setDownloadError('');
    try {
      await exportBookToPDF(book);
    } catch (err) {
      setDownloadError(err instanceof Error ? `Kunde inte skapa PDF: ${err.message}` : 'Kunde inte skapa PDF');
    } finally {
      setDownloading(false);
    }
  };

  const share = async () => {
    const result = await shareBookLink(book.id, book.title);
    if (result === 'copied') {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  const authorName = summary.authorName || book.author;
  const published = formatDate(summary.publishedAt || book.createdAt);
  const age = formatAge(summary.targetAge || book.targetAge);
  const mainCharacters = characters.filter(c => c.role === 'main');
  const shownCharacters = (mainCharacters.length > 0 ? mainCharacters : characters).slice(0, 8);

  return (
    <div className="space-y-10">
      <div className="space-y-5">
        <button onClick={onBack} className="inline-flex items-center gap-1 -ml-1 px-1 text-sm font-medium text-ink/55 hover:text-ink transition-colors">
          <Icon name="arrow_back" size={18} /> Bokhandeln
        </button>

        <div className="grid gap-6 sm:gap-10 sm:grid-cols-[minmax(0,15rem)_1fr] lg:grid-cols-[minmax(0,17rem)_1fr] items-start">
          {/* Omslag */}
          <div className="relative w-44 sm:w-full mx-auto aspect-[3/4] rounded-2xl overflow-hidden bg-white border border-line shadow-lift">
            {summary.coverUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={summary.coverUrl} alt={`Omslag till ${book.title}`} className="absolute inset-0 w-full h-full object-cover" />
            ) : (
              <div className="absolute inset-0 flex flex-col justify-between p-5 bg-gradient-to-b from-paper to-white">
                <Icon name="auto_stories" size={30} className="text-ink/25" />
                <span className="font-heading text-xl font-semibold text-ink/80 leading-tight line-clamp-5 break-words hyphens-auto">{book.title}</span>
              </div>
            )}
            <span className="absolute inset-y-0 left-0 w-2.5 bg-gradient-to-r from-black/15 to-transparent" />
          </div>

          {/* Info */}
          <div className="min-w-0">
            <p className="eyebrow">{formatLabel(summary.bookFormat || book.bookFormat)}</p>
            <h2 className="mt-2 text-3xl sm:text-4xl font-heading font-bold tracking-tight text-ink leading-tight break-words">{book.title}</h2>

            {authorName && (
              <p className="mt-2 text-ink/60">
                av{' '}
                {summary.userId ? (
                  <button
                    onClick={() => onOpenAuthor(summary.userId!, authorName)}
                    className="font-semibold text-ink underline decoration-ink/25 underline-offset-4 hover:decoration-brand hover:text-brand transition-colors"
                  >
                    {authorName}
                  </button>
                ) : (
                  <span className="font-semibold text-ink">{authorName}</span>
                )}
              </p>
            )}

            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-sm text-ink/55">
              {published && (
                <span className="inline-flex items-center gap-1.5"><Icon name="calendar_today" size={16} /> {published}</span>
              )}
              {age && (
                <span className="inline-flex items-center gap-1.5"><Icon name="child_care" size={16} /> {age}</span>
              )}
              {book.spreads.length > 0 && (
                <span className="inline-flex items-center gap-1.5"><Icon name="menu_book" size={16} /> {summary.numSpreads || book.spreads.length} uppslag</span>
              )}
            </div>

            {description ? (
              <p className="mt-5 text-[15px] sm:text-base leading-relaxed text-ink/80 max-w-2xl">{description}</p>
            ) : writingBlurb ? (
              <div className="mt-5 space-y-2 max-w-2xl" aria-label="Skriver baksidestext">
                <div className="skeleton h-4 w-full !rounded-md" />
                <div className="skeleton h-4 w-11/12 !rounded-md" />
                <div className="skeleton h-4 w-2/3 !rounded-md" />
              </div>
            ) : null}

            <div className="mt-6 flex flex-wrap items-center gap-2.5">
              {likes.supported && (
                <LikeButton
                  size="lg"
                  count={likes.counts[book.id] ?? 0}
                  liked={likes.liked.has(book.id)}
                  onToggle={() => likes.toggle(book.id)}
                />
              )}
              <button
                onClick={() => readerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                className="btn-action"
              >
                <Icon name="auto_stories" size={19} /> Läs boken
              </button>
              <button onClick={download} disabled={downloading} className="btn-ghost">
                {downloading ? <span className="spinner !w-4 !h-4" /> : <Icon name="download" size={19} />}
                {downloading ? 'Skapar PDF...' : 'Ladda ner PDF'}
              </button>
              <button onClick={share} className="btn-ghost">
                <Icon name={copied ? 'check' : 'ios_share'} size={19} />
                {copied ? 'Länken är kopierad' : 'Dela'}
              </button>
              <button onClick={() => setShowPrint(true)} className="btn-ghost">
                <Icon name="print" size={19} /> Beställ tryckt bok
              </button>
            </div>
            {downloadError && <div className="note-error mt-3">{downloadError}</div>}

            {shownCharacters.length > 0 && (
              <div className="mt-7">
                <h3 className="text-sm font-semibold text-ink">{mainCharacters.length > 0 ? 'Huvudpersoner' : 'Personer i boken'}</h3>
                <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-3">
                  {shownCharacters.map(c => (
                    <li key={c.id} className="flex items-center gap-2.5 min-w-0">
                      {c.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={c.imageUrl} alt="" loading="lazy" className="w-10 h-10 rounded-full object-cover border border-line bg-white" />
                      ) : (
                        <span className="w-10 h-10 rounded-full bg-brand/10 text-brand font-semibold text-sm flex items-center justify-center shrink-0">
                          {initials(c.name)}
                        </span>
                      )}
                      <span className="text-sm font-medium text-ink truncate max-w-[10rem]">{c.name}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Läsaren */}
      <div ref={readerRef} className="scroll-mt-6">
        <div className="card-glass hover:!shadow-soft px-2 py-4 sm:p-8 -mx-2 sm:mx-0">
          <BookReader book={book} showDownload={false} />
        </div>
      </div>

      {/* Fler av samma skapare */}
      {authorName && summary.userId && moreByAuthor.length > 0 && (
        <section className="space-y-4">
          <div className="flex items-end justify-between gap-3">
            <h3 className="text-xl font-heading font-bold text-ink">Fler böcker av {authorName}</h3>
            <button
              onClick={() => onOpenAuthor(summary.userId!, authorName)}
              className="shrink-0 text-sm font-semibold text-brand hover:text-brand-dark inline-flex items-center gap-0.5"
            >
              Visa alla <Icon name="chevron_right" size={18} />
            </button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-x-5 gap-y-8">
            {moreByAuthor.slice(0, 5).map(b => (
              <BookCard
                key={b.id}
                book={b}
                likes={likes}
                opening={openingId === b.id}
                disabled={!!openingId}
                onOpen={() => onOpenBook(b.id)}
                showAuthor={false}
              />
            ))}
          </div>
        </section>
      )}

      {showPrint && (
        <PrintOrderModal book={book} onDownload={download} downloading={downloading} onClose={() => setShowPrint(false)} />
      )}
    </div>
  );
}
