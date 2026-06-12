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
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-600 via-violet-600 to-fuchsia-500
                          px-6 sm:px-10 py-10 sm:py-12 text-white shadow-xl shadow-indigo-500/20">
        {/* Dekorativa former */}
        <div className="absolute -top-16 -right-10 w-64 h-64 rounded-full bg-white/10 blur-2xl" />
        <div className="absolute -bottom-20 -left-10 w-72 h-72 rounded-full bg-fuchsia-300/20 blur-3xl" />
        <div className="relative z-10 max-w-2xl">
          <h1 className="text-3xl sm:text-4xl font-extrabold leading-tight tracking-tight">
            Skapa din egen barnbok – på minuter
          </h1>
          <p className="mt-3 text-indigo-100 text-base sm:text-lg leading-relaxed">
            Berätta din idé, så skriver och illustrerar AI:n en komplett bok med
            konsekventa karaktärer – i din favoritstil.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            {['Handbok för Superhjältar', 'Mamma Mu', 'Luna'].map((s) => (
              <span key={s} className="inline-flex items-center gap-1 px-3 py-1 rounded-full
                                       bg-white/15 backdrop-blur text-sm font-medium ring-1 ring-white/20">
                ✨ {s}
              </span>
            ))}
          </div>
          <button
            onClick={onNewBook}
            className="mt-7 inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-white text-indigo-700
                       font-bold shadow-lg shadow-indigo-900/20 hover:-translate-y-0.5 hover:shadow-xl
                       active:translate-y-0 transition-all"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
            </svg>
            Skapa en bok
          </button>
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
                className="card-soft overflow-hidden hover:shadow-lg hover:shadow-indigo-200/50
                           hover:-translate-y-1 transition-all cursor-pointer group"
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
                  <h3 className="font-bold text-gray-800 mb-1 group-hover:text-indigo-600 transition-colors">
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
                        className="text-xs text-blue-400 hover:text-blue-600 opacity-0 group-hover:opacity-100 transition-opacity"
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
        <div className="text-center py-14 card-soft border-dashed border-2 border-gray-200">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-indigo-50 flex items-center justify-center">
            <svg className="w-8 h-8 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
    </div>
  );
}
