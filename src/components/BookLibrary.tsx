'use client';

import { useState, useEffect } from 'react';
import { BookProject } from '@/lib/types';
import { listBooks, deleteBook } from '@/lib/storage';

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
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/15
                             backdrop-blur text-sm font-medium ring-1 ring-white/25">
              ✨ AI-drivet magiskt skapande
            </span>
            <h1 className="mt-4 text-4xl sm:text-5xl font-bold leading-[1.1] tracking-tight">
              Skapa din egen barnbok – på minuter
            </h1>
            <p className="mt-4 text-white/85 text-lg leading-relaxed max-w-lg">
              Förvandla godnattsagan till ett riktigt äventyr. Berätta din idé, så skriver
              och illustrerar AI:n en komplett bok med konsekventa karaktärer.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              {['Handbok för Superhjältar', 'Mamma Mu', 'Luna'].map((s) => (
                <span key={s} className="inline-flex items-center gap-1 px-3 py-1 rounded-full
                                         bg-white/15 backdrop-blur text-sm font-medium ring-1 ring-white/25">
                  ✨ {s}
                </span>
              ))}
            </div>
            <div className="mt-8 flex flex-wrap gap-3">
              <button
                onClick={onNewBook}
                className="inline-flex items-center gap-2 px-7 py-3.5 rounded-full bg-white text-brand
                           font-heading font-bold text-lg shadow-xl shadow-black/10 hover:-translate-y-0.5
                           hover:shadow-2xl active:translate-y-0 transition-all"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
                </svg>
                Börja skapa
              </button>
              <a
                href="#hur-magin-skapas"
                className="inline-flex items-center gap-2 px-6 py-3.5 rounded-full bg-white/10 backdrop-blur
                           text-white font-heading font-semibold ring-1 ring-white/30 hover:bg-white/20 transition-colors"
              >
                Se hur det går till
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
                <span className="text-sunset text-lg">★</span>
                <span className="font-heading font-bold text-sm">Magisk AI</span>
              </div>
              <div className="absolute bottom-6 -left-4 glass rounded-2xl px-3 py-2 text-gray-800">
                <span className="font-heading font-bold text-sm">3 bokstilar att välja på</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Hur magin skapas */}
      <section id="hur-magin-skapas" className="scroll-mt-24">
        <h2 className="text-center text-sm font-heading font-semibold text-brand/70 tracking-widest uppercase mb-6">
          Hur magin skapas
        </h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { n: '1', t: 'Din idé', d: 'Berätta tema, karaktärer och stil', icon: 'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13' },
            { n: '2', t: 'Karaktärer', d: 'AI skapar konsekventa figurer', icon: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z' },
            { n: '3', t: 'Generering', d: 'Text och bilder vävs ihop', icon: 'M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z' },
            { n: '4', t: 'Klar bok', d: 'Ladda ner som PDF', icon: 'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253' },
          ].map((step) => (
            <div key={step.n} className="glass rounded-4xl p-5 text-center">
              <div className="w-12 h-12 mx-auto mb-3 rounded-2xl bg-gradient-to-br from-brand to-magic
                              flex items-center justify-center text-white shadow-glow">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d={step.icon} />
                </svg>
              </div>
              <h3 className="font-heading font-bold text-gray-800">{step.t}</h3>
              <p className="text-xs text-gray-500 mt-1">{step.d}</p>
            </div>
          ))}
        </div>
      </section>

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
      <section className="relative overflow-hidden rounded-4xl px-6 sm:px-12 py-14 text-center
                          bg-gradient-to-br from-brand-dark via-brand to-magic text-white shadow-glow-lg mt-4">
        <div className="absolute -top-16 -left-16 w-64 h-64 rounded-full bg-magic/30 blur-3xl" />
        <div className="absolute -bottom-16 -right-16 w-64 h-64 rounded-full bg-trust/30 blur-3xl" />
        <div className="relative z-10 max-w-2xl mx-auto">
          <h2 className="text-3xl sm:text-4xl font-bold">Redo att skriva historia?</h2>
          <p className="mt-3 text-white/85 text-lg">
            Det tar bara några minuter att skapa den första versionen av din bok.
          </p>
          <button
            onClick={onNewBook}
            className="mt-7 inline-flex items-center gap-2 px-8 py-4 rounded-full bg-white text-brand
                       font-heading font-bold text-lg shadow-xl shadow-black/10 hover:-translate-y-0.5
                       hover:shadow-2xl transition-all"
          >
            Skapa din bok nu
          </button>
        </div>
      </section>

      {/* Footer */}
      <footer className="pt-6 pb-2 text-center">
        <div className="flex items-center justify-center gap-2 mb-3">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-brand to-magic" />
          <span className="font-heading font-bold brand-text">Bokverktyget</span>
        </div>
        <p className="text-sm text-gray-400 italic">Skapa barnböcker med AI · Magic included ✨</p>
      </footer>
    </div>
  );
}
