'use client';

import { useState } from 'react';
import { BookProject, Spread } from '@/lib/types';
import { saveBook } from '@/lib/storage';
import { exportBookToPDF } from '@/lib/pdf-export';
import PageEditor from './PageEditor';

interface Props {
  book: BookProject;
  onUpdateSpread: (updatedSpread: Spread) => void;
  onSaveBook: (book: BookProject) => void;
  onBack: () => void;
}

export default function BookPreview({ book, onUpdateSpread, onSaveBook, onBack }: Props) {
  const [selectedSpread, setSelectedSpread] = useState<Spread | null>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'book'>('grid');
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  const [exporting, setExporting] = useState(false);

  const handleSaveSpread = (updatedSpread: Spread) => {
    onUpdateSpread(updatedSpread);
    setSelectedSpread(null);
  };

  const handleSaveBook = async () => {
    setSaving(true);
    setSaveMessage('');
    try {
      const bookToSave = { ...book, status: 'reviewing' as const };
      await saveBook(bookToSave);
      onSaveBook(bookToSave);
      setSaveMessage('Boken har sparats!');
      setTimeout(() => setSaveMessage(''), 3000);
    } catch (err) {
      setSaveMessage('Kunde inte spara boken');
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const handleExportPDF = async () => {
    setExporting(true);
    try {
      await exportBookToPDF(book);
    } catch (err) {
      console.error('PDF-export misslyckades:', err);
      alert('PDF-export misslyckades. Kontrollera konsolen for detaljer.');
    } finally {
      setExporting(false);
    }
  };

  const handleMarkDone = async () => {
    const doneBook = { ...book, status: 'done' as const };
    await saveBook(doneBook);
    onSaveBook(doneBook);
    setSaveMessage('Boken ar markerad som klar!');
    setTimeout(() => setSaveMessage(''), 3000);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-800 mb-1">
            Steg 4: Granska & redigera
          </h2>
          <p className="text-gray-600">
            Klicka pa ett uppslag for att redigera text eller regenerera bilden.
          </p>
        </div>
        <button onClick={onBack} className="px-4 py-2 text-gray-500 hover:text-gray-700">
          Tillbaka
        </button>
      </div>

      {/* Book info + Action buttons */}
      <div className="bg-gradient-to-r from-blue-50 to-purple-50 rounded-xl p-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h3 className="text-xl font-bold text-gray-800">{book.title}</h3>
            {book.subtitle && <p className="text-gray-600">{book.subtitle}</p>}
            <div className="flex gap-4 mt-2 text-sm text-gray-500">
              <span>{book.spreads.length} uppslag</span>
              <span>{book.characters.length} karaktarer</span>
              <span>{book.spreads.filter(s => s.status === 'done').length} bilder klara</span>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex flex-wrap gap-2">
            <button
              onClick={handleSaveBook}
              disabled={saving}
              className="px-5 py-2.5 bg-green-600 text-white font-semibold rounded-lg
                         hover:bg-green-700 disabled:bg-gray-400 transition-colors
                         flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
              </svg>
              {saving ? 'Sparar...' : 'Spara bok'}
            </button>

            <button
              onClick={handleExportPDF}
              disabled={exporting}
              className="px-5 py-2.5 bg-purple-600 text-white font-semibold rounded-lg
                         hover:bg-purple-700 disabled:bg-gray-400 transition-colors
                         flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              {exporting ? 'Exporterar...' : 'Ladda ner PDF'}
            </button>

            <button
              onClick={handleMarkDone}
              className="px-5 py-2.5 bg-yellow-500 text-white font-semibold rounded-lg
                         hover:bg-yellow-600 transition-colors flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Markera klar
            </button>
          </div>
        </div>

        {/* Save message */}
        {saveMessage && (
          <div className={`mt-3 p-2 rounded-lg text-sm font-medium text-center ${
            saveMessage.includes('sparats') || saveMessage.includes('klar')
              ? 'bg-green-100 text-green-700'
              : 'bg-red-100 text-red-700'
          }`}>
            {saveMessage}
          </div>
        )}
      </div>

      {/* View controls */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => setViewMode(viewMode === 'grid' ? 'book' : 'grid')}
          className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
        >
          {viewMode === 'grid' ? 'Bokvy' : 'Rutnat'}
        </button>
      </div>

      {viewMode === 'grid' ? (
        /* Grid view - images only, text is baked into the illustrations */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {book.spreads.map((spread) => (
            <div
              key={spread.id}
              onClick={() => setSelectedSpread(spread)}
              className="border-2 border-gray-200 rounded-xl overflow-hidden cursor-pointer
                         hover:border-blue-400 hover:shadow-lg transition-all group"
            >
              {/* Image */}
              <div className="bg-gray-100 aspect-[3/2]">
                {spread.generatedImage ? (
                  <img
                    src={`data:image/png;base64,${spread.generatedImage}`}
                    alt={`Sida ${spread.pages}`}
                    className="w-full h-full object-contain"
                  />
                ) : (
                  <div className="flex items-center justify-center h-full text-gray-400">
                    Ingen bild
                  </div>
                )}
              </div>

              {/* Info */}
              <div className="p-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-semibold text-gray-700">
                    {spread.pages === 'omslag' ? 'Omslag' :
                     spread.pages === 'slutsida' ? 'Slutsida' :
                     `Sida ${spread.pages}`}
                  </span>
                  <span className="text-xs text-blue-600 opacity-0 group-hover:opacity-100 transition-opacity">
                    Klicka for att redigera
                  </span>
                </div>
                {spread.chapter && (
                  <p className="text-xs text-gray-500">{spread.chapter}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* Book view - full page images */
        <div className="space-y-8">
          {book.spreads.map((spread) => (
            <div
              key={spread.id}
              className="border rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-shadow"
            >
              {/* Chapter heading */}
              {spread.chapter && (
                <div className="bg-gray-800 text-white px-6 py-2 text-sm font-semibold">
                  {spread.chapter}
                </div>
              )}

              {/* Full image - text is already in the image */}
              <div className="relative bg-gray-50">
                {spread.generatedImage ? (
                  <img
                    src={`data:image/png;base64,${spread.generatedImage}`}
                    alt={`Sida ${spread.pages}`}
                    className="w-full object-contain"
                  />
                ) : (
                  <div className="flex items-center justify-center h-48 text-gray-400">
                    Ingen bild
                  </div>
                )}

                {/* Edit button overlay */}
                <div className="absolute top-4 right-4">
                  <button
                    onClick={() => setSelectedSpread(spread)}
                    className="px-3 py-1.5 bg-white/90 backdrop-blur-sm text-blue-600 rounded-lg
                               text-sm font-medium hover:bg-blue-50 transition-colors shadow-sm"
                  >
                    Redigera
                  </button>
                </div>
              </div>

              {/* Page label */}
              <div className="px-6 py-2 bg-gray-50 text-center border-t">
                <span className="text-sm font-medium text-gray-500">
                  {spread.pages === 'omslag' ? 'Omslag' :
                   spread.pages === 'slutsida' ? 'Slutsida' :
                   `Sida ${spread.pages}`}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Page Editor Modal */}
      {selectedSpread && (
        <PageEditor
          spread={selectedSpread}
          characters={book.characters}
          styleGuide={book.styleGuide}
          bookFormat={book.bookFormat}
          onSave={handleSaveSpread}
          onClose={() => setSelectedSpread(null)}
        />
      )}
    </div>
  );
}
