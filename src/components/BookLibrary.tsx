'use client';

import { useState, useEffect } from 'react';
import { BookProject } from '@/lib/types';
import { listBooks, deleteBook } from '@/lib/storage';
import Icon from './Icon';
import Reveal from './Reveal';

interface Props {
  onLoadBook: (book: BookProject) => void;
  onNewBook: () => void;
  onReuseBook: (book: BookProject) => void;
}

export default function BookLibrary({ onLoadBook, onNewBook, onReuseBook }: Props) {
  const [books, setBooks] = useState<BookProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  useEffect(() => {
    loadSavedBooks();
  }, []);

  const loadSavedBooks = async () => {
    try {
      const savedBooks = await listBooks();
      // Sort by most recently updated
      savedBooks.sort((a, b) => {
        const aDate = (a as any).updatedAt || a.createdAt;
        const bDate = (b as any).updatedAt || b.createdAt;
        return new Date(bDate).getTime() - new Date(aDate).getTime();
      });
      setBooks(savedBooks);
    } catch (err) {
      console.error('Kunde inte ladda sparade böcker:', err);
    } finally {
      setLoading(false);
    }
  };

  // Two-step inline confirm instead of window.confirm (which blocks rendering)
  const handleDelete = async (id: string) => {
    if (confirmDeleteId !== id) {
      setConfirmDeleteId(id);
      // Reset confirmation after a few seconds if the user doesn't follow through
      setTimeout(() => setConfirmDeleteId(prev => (prev === id ? null : prev)), 4000);
      return;
    }
    setConfirmDeleteId(null);
    try {
      await deleteBook(id);
      setBooks(prev => prev.filter(b => b.id !== id));
    } catch (err) {
      console.error('Kunde inte ta bort boken:', err);
    }
  };

  const getBookStats = (book: BookProject) => {
    const totalSpreads = book.spreads.length;
    const generatedImages = book.spreads.filter(s => s.generatedImage).length;
    const approvedChars = book.characters.filter(c => c.approved).length;
    return { totalSpreads, generatedImages, approvedChars };
  };

  const getStatusLabel = (book: BookProject) => {
    switch (book.status) {
      case 'importing': return { text: 'Importerad', color: 'bg-gray-100 text-gray-600' };
      case 'characters': return { text: 'Karaktärer', color: 'bg-purple-100 text-purple-600' };
      case 'generating': return { text: 'Genererar', color: 'bg-blue-100 text-blue-600' };
      case 'reviewing': return { text: 'Granskning', color: 'bg-green-100 text-green-600' };
      case 'done': return { text: 'Klar', color: 'bg-green-200 text-green-700' };
      default: return { text: 'Okänd', color: 'bg-gray-100 text-gray-600' };
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-gray-500">Laddar sparade böcker...</div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Hero / landningssektion */}
      <section className="relative overflow-hidden rounded-4xl px-6 sm:px-12 py-10 sm:py-14
                          bg-gradient-to-br from-brand via-magic to-trust shadow-glow-lg text-white">
        {/* Dekorativa blobbar (Level 1) */}
        <div className="absolute -top-20 -right-10 w-72 h-72 rounded-full bg-white/15 blur-3xl" />
        <div className="absolute -bottom-24 -left-10 w-80 h-80 rounded-full bg-sunset/20 blur-3xl" />
        <div className="relative z-10 grid lg:grid-cols-2 gap-8 items-center">
          {/* Text */}
          <div>
            <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-white/15
                             backdrop-blur text-sm font-medium ring-1 ring-white/25">
              <Icon name="auto_awesome" filled size={16} className="text-sunset" /> AI-drivet magiskt skapande
            </span>
            <h1 className="mt-5 text-4xl sm:text-5xl font-bold leading-[1.08] tracking-tight">
              Skapa din egen barnbok – på minuter
            </h1>
            <p className="mt-4 text-white/85 text-lg leading-relaxed max-w-lg">
              Förvandla godnattsagan till ett riktigt äventyr. Berätta din idé, så skriver
              och illustrerar AI:n en komplett bok med konsekventa karaktärer.
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              {['Handbok för Superhjältar', 'Mamma Mu', 'Luna'].map((s) => (
                <span key={s} className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full
                                         bg-white/15 backdrop-blur text-sm font-medium ring-1 ring-white/25">
                  <Icon name="auto_awesome" filled size={14} className="text-sunset" /> {s}
                </span>
              ))}
            </div>
            <div className="mt-8 flex flex-wrap gap-3">
              <button
                onClick={onNewBook}
                className="group inline-flex items-center gap-2 px-7 py-3.5 rounded-full bg-white text-brand
                           font-heading font-bold text-lg shadow-xl shadow-black/10 hover:-translate-y-0.5
                           hover:shadow-2xl active:translate-y-0 active:scale-[0.98] transition-all duration-200"
              >
                Börja skapa
                <Icon name="arrow_forward" size={22} className="group-hover:translate-x-1 transition-transform" />
              </button>
              <a
                href="#hur-magin-skapas"
                className="inline-flex items-center gap-2 px-6 py-3.5 rounded-full bg-white/10 backdrop-blur
                           text-white font-heading font-semibold ring-1 ring-white/30 hover:bg-white/20 transition-colors"
              >
                <Icon name="play_circle" size={22} /> Se hur det går till
              </a>
            </div>
          </div>
          {/* Illustration med floating chips */}
          <div className="relative hidden lg:flex justify-center items-center">
            <div className="absolute inset-0 bg-white/10 blur-3xl rounded-full" />
            <div className="relative w-full max-w-md animate-float">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/hero-book.png" alt="Magisk barnbok" className="w-full h-auto rounded-3xl drop-shadow-2xl" />
              <div className="absolute top-3 -right-3 glass rounded-2xl px-3 py-2 flex items-center gap-2 text-gray-800">
                <Icon name="star" filled size={20} className="text-sunset" />
                <span className="font-heading font-bold text-sm">Magisk AI</span>
              </div>
              <div className="absolute bottom-6 -left-4 glass rounded-2xl px-3 py-2 flex items-center gap-2 text-gray-800">
                <Icon name="palette" filled size={18} className="text-brand" />
                <span className="font-heading font-bold text-sm">3 bokstilar att välja på</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Hur magin skapas */}
      <Reveal as="section">
        <div id="hur-magin-skapas" className="scroll-mt-24 text-center mb-8">
          <h2 className="text-2xl sm:text-3xl font-heading font-bold text-gray-800">Hur magin skapas</h2>
          <p className="text-gray-500 mt-2">Från en flyktig idé till en färdig bok på rekordtid.</p>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
          {[
            { t: 'Din idé', d: 'Berätta tema, karaktärer och stil', icon: 'lightbulb' },
            { t: 'Karaktärer', d: 'AI skapar konsekventa figurer', icon: 'diversity_3' },
            { t: 'Generering', d: 'Text och bilder vävs ihop', icon: 'auto_fix_high' },
            { t: 'Klar bok', d: 'Läs, dela eller ladda ner', icon: 'menu_book' },
          ].map((step, i) => (
            <div key={step.t} className="glass rounded-4xl p-6 text-center hover:-translate-y-1 transition-all">
              <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-brand to-magic
                              flex items-center justify-center text-white shadow-glow">
                <Icon name={step.icon} filled size={28} />
              </div>
              <span className="text-xs font-heading font-bold text-brand/50">STEG {i + 1}</span>
              <h3 className="font-heading font-bold text-gray-800 mt-0.5">{step.t}</h3>
              <p className="text-sm text-gray-500 mt-1">{step.d}</p>
            </div>
          ))}
        </div>
      </Reveal>

      {/* Dina böcker */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-800">Dina böcker</h2>
          <p className="text-sm text-gray-500">
            {books.length > 0
              ? `Du har ${books.length} sparad${books.length > 1 ? 'e' : ''} bok${books.length > 1 ? 'er' : ''}.`
              : 'Inga sparade böcker än.'}
          </p>
        </div>
        {books.length > 0 && (
          <button onClick={onNewBook} className="btn-primary">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Ny bok
          </button>
        )}
      </div>

      {books.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {books.map((book) => {
            const stats = getBookStats(book);
            const status = getStatusLabel(book);
            // Find a spread with an image for thumbnail
            const thumbnailSpread = book.spreads.find(s => s.generatedImage);

            return (
              <div
                key={book.id}
                className="card-glass overflow-hidden hover:-translate-y-1 cursor-pointer group"
                onClick={() => onLoadBook(book)}
              >
                {/* Thumbnail */}
                <div className="bg-gray-100 aspect-[3/2] relative">
                  {thumbnailSpread?.generatedImage ? (
                    <img
                      src={`data:image/png;base64,${thumbnailSpread.generatedImage}`}
                      alt={book.title}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="flex items-center justify-center h-full">
                      <svg className="w-16 h-16 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1}
                          d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                      </svg>
                    </div>
                  )}
                  {/* Status badge */}
                  <div className={`absolute top-2 right-2 px-2 py-1 rounded-full text-xs font-medium ${status.color}`}>
                    {status.text}
                  </div>
                </div>

                {/* Info */}
                <div className="p-4">
                  <h3 className="font-heading font-bold text-gray-800 mb-1 group-hover:text-brand transition-colors">
                    {book.title}
                  </h3>
                  {book.subtitle && (
                    <p className="text-sm text-gray-500 mb-2">{book.subtitle}</p>
                  )}
                  <div className="flex gap-3 text-xs text-gray-400">
                    <span>{stats.totalSpreads} uppslag</span>
                    <span>{stats.generatedImages} bilder</span>
                    <span>{book.characters.length} karaktärer</span>
                  </div>
                  <div className="flex items-center justify-between mt-3">
                    <span className="text-xs text-gray-400">
                      {new Date((book as any).updatedAt || book.createdAt).toLocaleDateString('sv-SE')}
                    </span>
                    <div className="flex items-center gap-3">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onReuseBook(book);
                        }}
                        className="text-xs text-brand/60 hover:text-brand opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        Återanvänd
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(book.id);
                        }}
                        className={`text-xs transition-all ${
                          confirmDeleteId === book.id
                            ? 'px-2 py-0.5 bg-red-600 text-white rounded font-semibold opacity-100'
                            : 'text-red-400 hover:text-red-600 opacity-0 group-hover:opacity-100'
                        }`}
                      >
                        {confirmDeleteId === book.id ? 'Klicka igen för att ta bort' : 'Ta bort'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {books.length === 0 && (
        <div className="text-center py-14 glass rounded-4xl border-dashed border-2 border-brand/20">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-brand/10 flex items-center justify-center">
            <svg className="w-8 h-8 text-brand" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-gray-700 mb-1">Inga böcker än</h3>
          <p className="text-gray-400 mb-6">Skapa din första bok med hjälp av knappen ovan ✨</p>
          <button onClick={onNewBook} className="btn-primary mx-auto">
            Skapa ny bok
          </button>
        </div>
      )}

      {/* Konverterings-CTA */}
      <Reveal as="section" className="relative overflow-hidden rounded-4xl px-6 sm:px-12 py-16 text-center
                          bg-gradient-to-br from-brand-dark via-brand to-magic text-white shadow-glow-lg mt-6">
        <div className="absolute -top-16 -left-16 w-64 h-64 rounded-full bg-magic/30 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-16 -right-16 w-64 h-64 rounded-full bg-trust/30 blur-3xl pointer-events-none" />
        <div className="relative z-10 max-w-2xl mx-auto">
          <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-white/15 backdrop-blur flex items-center justify-center ring-1 ring-white/25">
            <Icon name="auto_stories" filled size={30} className="text-white" />
          </div>
          <h2 className="text-3xl sm:text-4xl font-bold">Redo att skriva historia?</h2>
          <p className="mt-3 text-white/85 text-lg">
            Det tar bara några minuter att skapa den första versionen av din bok.
          </p>
          <button
            onClick={onNewBook}
            className="group mt-8 inline-flex items-center gap-2 px-8 py-4 rounded-full bg-white text-brand
                       font-heading font-bold text-lg shadow-xl shadow-black/10 hover:-translate-y-0.5
                       hover:shadow-2xl active:scale-[0.98] transition-all duration-200"
          >
            Skapa din bok nu
            <Icon name="arrow_forward" size={22} className="group-hover:translate-x-1 transition-transform" />
          </button>
        </div>
      </Reveal>

      {/* Footer */}
      <footer className="pt-8 pb-2">
        <div className="border-t border-gray-200/70 pt-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-brand to-magic flex items-center justify-center">
              <Icon name="auto_stories" filled size={18} className="text-white" />
            </div>
            <span className="font-heading font-bold brand-text">Bokverktyget</span>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-gray-500">
            <a href="#hur-magin-skapas" className="hover:text-brand transition-colors">Hur det fungerar</a>
            <button onClick={onNewBook} className="hover:text-brand transition-colors">Skapa bok</button>
            <span className="text-gray-300">·</span>
            <span className="italic text-gray-400">Magic included ✨</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
