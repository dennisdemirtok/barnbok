'use client';

import { useState, useEffect } from 'react';
import { BookProject } from '@/lib/types';
import { listBooks, deleteBook } from '@/lib/storage';

interface Props {
  onLoadBook: (book: BookProject) => void;
  onNewBook: () => void;
}

export default function BookLibrary({ onLoadBook, onNewBook }: Props) {
  const [books, setBooks] = useState<BookProject[]>([]);
  const [loading, setLoading] = useState(true);

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
      console.error('Kunde inte ladda sparade bocker:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string, title: string) => {
    if (!confirm(`Vill du verkligen ta bort "${title}"?`)) return;
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
      case 'characters': return { text: 'Karaktarer', color: 'bg-purple-100 text-purple-600' };
      case 'generating': return { text: 'Genererar', color: 'bg-blue-100 text-blue-600' };
      case 'reviewing': return { text: 'Granskning', color: 'bg-green-100 text-green-600' };
      case 'done': return { text: 'Klar', color: 'bg-green-200 text-green-700' };
      default: return { text: 'Okand', color: 'bg-gray-100 text-gray-600' };
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-gray-500">Laddar sparade bocker...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-800 mb-1">Dina bocker</h2>
          <p className="text-gray-600">
            {books.length > 0
              ? `Du har ${books.length} sparad${books.length > 1 ? 'e' : ''} bok${books.length > 1 ? 'er' : ''}.`
              : 'Inga sparade bocker an. Skapa en ny!'}
          </p>
        </div>
        <button
          onClick={onNewBook}
          className="px-6 py-3 bg-blue-600 text-white font-semibold rounded-lg
                     hover:bg-blue-700 transition-colors flex items-center gap-2"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Ny bok
        </button>
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
                className="border-2 border-gray-200 rounded-xl overflow-hidden hover:border-blue-400
                           hover:shadow-lg transition-all cursor-pointer group"
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
                  <h3 className="font-bold text-gray-800 mb-1 group-hover:text-blue-600 transition-colors">
                    {book.title}
                  </h3>
                  {book.subtitle && (
                    <p className="text-sm text-gray-500 mb-2">{book.subtitle}</p>
                  )}
                  <div className="flex gap-3 text-xs text-gray-400">
                    <span>{stats.totalSpreads} uppslag</span>
                    <span>{stats.generatedImages} bilder</span>
                    <span>{book.characters.length} karaktarer</span>
                  </div>
                  <div className="flex items-center justify-between mt-3">
                    <span className="text-xs text-gray-400">
                      {new Date((book as any).updatedAt || book.createdAt).toLocaleDateString('sv-SE')}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(book.id, book.title);
                      }}
                      className="text-xs text-red-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      Ta bort
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {books.length === 0 && (
        <div className="text-center py-16 bg-gray-50 rounded-xl">
          <svg className="w-20 h-20 text-gray-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1}
              d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
          </svg>
          <h3 className="text-lg font-semibold text-gray-500 mb-2">Inga bocker an</h3>
          <p className="text-gray-400 mb-6">Klicka pa "Ny bok" for att borja skapa din forsta bok!</p>
          <button
            onClick={onNewBook}
            className="px-8 py-3 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition-colors"
          >
            Skapa ny bok
          </button>
        </div>
      )}
    </div>
  );
}
