'use client';

import { useState, useEffect, useCallback } from 'react';
import { BookProject, Character, Spread, BookFormat } from '@/lib/types';
import { saveBook } from '@/lib/storage';
import BookLibrary from '@/components/BookLibrary';
import BookImporter from '@/components/BookImporter';
import CharacterApproval from '@/components/CharacterApproval';
import PageGenerator from '@/components/PageGenerator';
import BookPreview from '@/components/BookPreview';

type Step = 'library' | 'import' | 'characters' | 'generate' | 'review';
type ImportMode = 'choose' | 'import' | 'create' | 'savedTexts';

export default function Home() {
  const [step, setStep] = useState<Step>('library');
  const [book, setBook] = useState<BookProject | null>(null);
  const [autoSaveTimer, setAutoSaveTimer] = useState<NodeJS.Timeout | null>(null);

  // Lifted state from BookImporter - persists across step navigation
  const [importRawText, setImportRawText] = useState('');
  const [importMode, setImportMode] = useState<ImportMode>('choose');
  const [importFormat, setImportFormat] = useState<BookFormat>('bildbok-text-pa-bild');
  const [importParsedBook, setImportParsedBook] = useState<BookProject | null>(null);
  const [isClonedBook, setIsClonedBook] = useState(false);

  // Auto-save whenever book changes (debounced)
  const autoSave = useCallback(async (bookToSave: BookProject) => {
    try {
      await saveBook(bookToSave);
      console.log('Auto-sparad:', new Date().toLocaleTimeString());
    } catch (err) {
      console.error('Auto-sparning misslyckades:', err);
    }
  }, []);

  useEffect(() => {
    if (!book || step === 'library' || step === 'import') return;

    // Debounce auto-save by 2 seconds
    if (autoSaveTimer) clearTimeout(autoSaveTimer);
    const timer = setTimeout(() => autoSave(book), 2000);
    setAutoSaveTimer(timer);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book]);

  const handleBookParsed = (parsedBook: BookProject) => {
    setBook(parsedBook);
    setImportParsedBook(parsedBook); // Keep copy for back navigation
    setStep('characters');
  };

  const handleLoadBook = (loadedBook: BookProject) => {
    setBook(loadedBook);
    setIsClonedBook(false);
    // Go to the appropriate step based on book status
    switch (loadedBook.status) {
      case 'importing':
        setStep('characters');
        break;
      case 'characters':
        setStep('characters');
        break;
      case 'generating':
        setStep('generate');
        break;
      case 'reviewing':
      case 'done':
        setStep('review');
        break;
      default:
        setStep('characters');
    }
  };

  const handleCharactersApproved = (characters: Character[]) => {
    if (!book) return;
    const updated = { ...book, characters, status: 'generating' as const };
    setBook(updated);
    setStep('generate');
  };

  const handlePagesGenerated = (spreads: Spread[]) => {
    if (!book) return;
    const updated = { ...book, spreads, status: 'reviewing' as const };
    setBook(updated);
    setStep('review');
  };

  const handleUpdateSpread = (updatedSpread: Spread) => {
    if (!book) return;
    setBook({
      ...book,
      spreads: book.spreads.map(s =>
        s.id === updatedSpread.id ? updatedSpread : s
      ),
    });
  };

  const handleSaveBook = (savedBook: BookProject) => {
    setBook(savedBook);
  };

  const handleNewBook = () => {
    setBook(null);
    setIsClonedBook(false);
    // Reset all import state for a fresh start
    setImportRawText('');
    setImportMode('choose');
    setImportFormat('bildbok-text-pa-bild');
    setImportParsedBook(null);
    setStep('import');
  };

  const handleReuseBook = (sourceBook: BookProject) => {
    const clonedBook: BookProject = {
      ...sourceBook,
      id: Math.random().toString(36).substring(2, 11),
      title: sourceBook.title + ' (kopia)',
      status: 'characters' as const,
      createdAt: new Date().toISOString(),
      updatedAt: undefined,
      // Keep characters with their reference images and approval status
      characters: sourceBook.characters.map(c => ({ ...c })),
      // Reset spreads: keep text and image prompts, clear generated images
      spreads: sourceBook.spreads.map(s => ({
        ...s,
        id: Math.random().toString(36).substring(2, 11),
        generatedImage: undefined,
        status: 'pending' as const,
        error: undefined,
      })),
    };

    setImportRawText('');
    setImportMode('choose');
    setImportFormat(sourceBook.bookFormat || 'bildbok-text-pa-bild');
    setImportParsedBook(null);
    setIsClonedBook(true);
    setBook(clonedBook);
    setStep('characters');
  };

  const handleBackToLibrary = () => {
    setBook(null);
    setIsClonedBook(false);
    setStep('library');
  };

  const steps: { key: Step; label: string; num: number }[] = [
    { key: 'import', label: 'Importera', num: 1 },
    { key: 'characters', label: 'Karaktarer', num: 2 },
    { key: 'generate', label: 'Generera', num: 3 },
    { key: 'review', label: 'Granska', num: 4 },
  ];

  const currentStepIndex = steps.findIndex(s => s.key === step);
  const showSteps = step !== 'library';

  return (
    <main className="min-h-screen">
      {/* Header */}
      <header className="bg-white border-b shadow-sm">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div
              className="cursor-pointer"
              onClick={handleBackToLibrary}
            >
              <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                Bokverktyget
              </h1>
              <p className="text-sm text-gray-500">Skapa barnbocker med AI-genererade illustrationer</p>
            </div>
            <div className="flex items-center gap-4">
              {book && step !== 'library' && (
                <>
                  <div className="text-right">
                    <p className="font-semibold text-gray-700">{book.title}</p>
                    {book.subtitle && <p className="text-sm text-gray-500">{book.subtitle}</p>}
                  </div>
                  <button
                    onClick={handleBackToLibrary}
                    className="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700 border border-gray-200
                               rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    Bibliotek
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Step indicator */}
      {showSteps && (
        <div className="bg-white border-b">
          <div className="max-w-7xl mx-auto px-6 py-3">
            <div className="flex items-center gap-2">
              {steps.map((s, idx) => (
                <div key={s.key} className="flex items-center">
                  {idx > 0 && (
                    <div className={`w-8 h-0.5 mx-1 ${
                      idx <= currentStepIndex ? 'bg-blue-400' : 'bg-gray-200'
                    }`} />
                  )}
                  <button
                    onClick={() => {
                      // Allow navigating back to completed steps
                      if (idx <= currentStepIndex && book) {
                        setStep(s.key);
                      }
                    }}
                    disabled={idx > currentStepIndex || !book}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm transition-colors ${
                      s.key === step
                        ? 'bg-blue-100 text-blue-700 font-semibold'
                        : idx < currentStepIndex
                        ? 'bg-green-100 text-green-700 hover:bg-green-200 cursor-pointer'
                        : 'bg-gray-100 text-gray-400 cursor-default'
                    }`}
                  >
                    <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                      s.key === step
                        ? 'bg-blue-600 text-white'
                        : idx < currentStepIndex
                        ? 'bg-green-600 text-white'
                        : 'bg-gray-300 text-white'
                    }`}>
                      {idx < currentStepIndex ? '\u2713' : s.num}
                    </span>
                    <span className="hidden sm:inline">{s.label}</span>
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Main content */}
      <div className="max-w-7xl mx-auto px-6 py-8">
        {step === 'library' && (
          <BookLibrary
            onLoadBook={handleLoadBook}
            onNewBook={handleNewBook}
            onReuseBook={handleReuseBook}
          />
        )}

        {step === 'import' && (
          <BookImporter
            onBookParsed={handleBookParsed}
            rawText={importRawText}
            onRawTextChange={setImportRawText}
            mode={importMode}
            onModeChange={setImportMode}
            importFormat={importFormat}
            onImportFormatChange={setImportFormat}
            parsedBook={importParsedBook}
            onParsedBookChange={setImportParsedBook}
          />
        )}

        {step === 'characters' && book && (
          <>
            {/* Format selector for cloned/reused books */}
            {isClonedBook && (
              <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <svg className="w-5 h-5 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  <span className="font-semibold text-yellow-800">Ateranvand bok</span>
                </div>
                <p className="text-sm text-yellow-700 mb-3">
                  Karaktarer och text fran originalboken behalles. Du kan byta bildformat innan du genererar nya bilder.
                </p>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Bokformat
                </label>
                <div className="flex flex-wrap gap-2">
                  {[
                    { value: 'bildbok-text-pa-bild' as BookFormat, label: 'Text pa bild (Handbok-stil)' },
                    { value: 'bildbok-separat-text' as BookFormat, label: 'Separat text (Luna-stil)' },
                    { value: 'kapitelbok' as BookFormat, label: 'Kapitelbok' },
                    { value: 'larobok' as BookFormat, label: 'Larobok' },
                  ].map((fmt) => (
                    <button
                      key={fmt.value}
                      onClick={() => setBook({ ...book, bookFormat: fmt.value })}
                      className={`px-4 py-2 rounded-lg text-sm transition-colors ${
                        book.bookFormat === fmt.value
                          ? 'bg-blue-600 text-white'
                          : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200'
                      }`}
                    >
                      {fmt.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <CharacterApproval
              characters={book.characters}
              styleGuide={book.styleGuide}
              bookId={book.id}
              bookTitle={book.title}
              onCharactersApproved={handleCharactersApproved}
              onBack={() => isClonedBook ? handleBackToLibrary() : setStep('import')}
            />
          </>
        )}

        {step === 'generate' && book && (
          <PageGenerator
            book={book}
            onPagesGenerated={handlePagesGenerated}
            onBack={() => setStep('characters')}
          />
        )}

        {step === 'review' && book && (
          <BookPreview
            book={book}
            onUpdateSpread={handleUpdateSpread}
            onSaveBook={handleSaveBook}
            onBack={() => setStep('generate')}
          />
        )}
      </div>
    </main>
  );
}
