'use client';

import { useState, useEffect, useCallback } from 'react';
import { BookProject, Character, Spread, BookFormat } from '@/lib/types';
import { saveBook } from '@/lib/storage';
import { useAuth } from '@/lib/auth';
import BookLibrary from '@/components/BookLibrary';
import BookImporter from '@/components/BookImporter';
import CharacterApproval from '@/components/CharacterApproval';
import PageGenerator from '@/components/PageGenerator';
import BookPreview from '@/components/BookPreview';
import ReferenceManager from '@/components/ReferenceManager';
import LoginModal from '@/components/LoginModal';
import Bookstore from '@/components/Bookstore';
import Icon from '@/components/Icon';

type Step = 'library' | 'import' | 'characters' | 'generate' | 'review' | 'bookstore';
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
  const [showRefManager, setShowRefManager] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const [sharedBookId, setSharedBookId] = useState<string | null>(null);
  const { user, signOut, loading: authLoading } = useAuth();

  // Delningslänk: /?bok=<id> öppnar boken direkt i bokhandelns läsare
  useEffect(() => {
    const bokId = new URLSearchParams(window.location.search).get('bok');
    if (bokId) {
      setSharedBookId(bokId);
      setStep('bookstore');
    }
  }, []);

  // Auto-save whenever book changes (debounced)
  const autoSave = useCallback(async (bookToSave: BookProject) => {
    try {
      // Endast lokal sparning - molnsynk (med bilduppladdning) sker vid explicit "Spara bok"
      const result = await saveBook(bookToSave, { cloud: false });
      // Om gamla korta id:n migrerades till UUID: uppdatera state så att
      // fortsatt arbete (och molnsparning) använder de nya id:na
      if (result.idsMigrated) setBook(result.book);
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

  // Called continuously while pages generate, so finished images are auto-saved
  // even if the user leaves before clicking "Granska boken"
  const handleSpreadsProgress = (spreads: Spread[]) => {
    if (!book) return;
    setBook({ ...book, spreads });
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
      id: crypto.randomUUID(),
      title: sourceBook.title + ' (kopia)',
      status: 'characters' as const,
      createdAt: new Date().toISOString(),
      updatedAt: undefined,
      // Keep characters with their reference images and approval status
      characters: sourceBook.characters.map(c => ({ ...c })),
      // Reset spreads: keep text and image prompts, clear generated images
      spreads: sourceBook.spreads.map(s => ({
        ...s,
        id: crypto.randomUUID(),
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

  const steps: { key: Step; label: string; num: number; icon: string }[] = [
    { key: 'import', label: 'Importera', num: 1, icon: 'upload_file' },
    { key: 'characters', label: 'Karaktarer', num: 2, icon: 'diversity_3' },
    { key: 'generate', label: 'Generera', num: 3, icon: 'auto_fix_high' },
    { key: 'review', label: 'Granska', num: 4, icon: 'menu_book' },
  ];

  const currentStepIndex = steps.findIndex(s => s.key === step);
  const showSteps = step !== 'library' && step !== 'bookstore';

  return (
    <main className="min-h-screen">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-white/80 backdrop-blur-md border-b border-gray-100 shadow-sm">
        <div className="max-w-7xl mx-auto px-6 py-3">
          <div className="flex items-center justify-between">
            <div
              className="flex items-center gap-3 cursor-pointer group"
              onClick={handleBackToLibrary}
            >
              <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-brand to-magic
                              flex items-center justify-center shadow-glow
                              group-hover:scale-105 group-hover:rotate-3 transition-transform">
                <Icon name="auto_stories" filled size={24} className="text-white" />
              </div>
              <div>
                <h1 className="text-xl font-extrabold brand-text leading-none">Bokverktyget</h1>
                <p className="text-xs text-gray-400 mt-0.5">Skapa barnböcker med AI</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <button
                onClick={() => setStep('bookstore')}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 text-sm text-brand font-heading font-semibold
                           border border-brand/25 rounded-full hover:bg-brand/5 transition-colors"
              >
                <Icon name="storefront" filled size={18} /> Bokhandel
              </button>
              <button
                onClick={() => setShowRefManager(true)}
                className="hidden md:inline-flex items-center gap-1.5 px-4 py-1.5 text-sm text-brand font-heading font-semibold border border-brand/25
                           rounded-full hover:bg-brand/5 transition-colors"
              >
                <Icon name="photo_library" filled size={18} /> Referensdata
              </button>
              {!authLoading && (
                user ? (
                  <div className="flex items-center gap-2">
                    <Icon name="account_circle" filled size={26} className="text-brand/70" />
                    <span className="hidden sm:inline text-sm text-gray-500 max-w-[140px] truncate" title={user.email}>
                      {user.email}
                    </span>
                    <button
                      onClick={signOut}
                      className="px-4 py-1.5 text-sm text-gray-500 hover:text-gray-700 border border-gray-200
                                 rounded-full hover:bg-gray-50 transition-colors"
                    >
                      Logga ut
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowLogin(true)}
                    className="btn-primary !px-5 !py-2 text-sm"
                  >
                    Logga in
                  </button>
                )
              )}
              {book && step !== 'library' && (
                <>
                  <div className="text-right">
                    <p className="font-semibold text-gray-700">{book.title}</p>
                    {book.subtitle && <p className="text-sm text-gray-500">{book.subtitle}</p>}
                  </div>
                  <button
                    onClick={handleBackToLibrary}
                    className="px-4 py-1.5 text-sm text-gray-500 hover:text-gray-700 border border-gray-200
                               rounded-full hover:bg-gray-50 transition-colors"
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
        <div className="bg-white/70 backdrop-blur-md border-b border-white/60">
          <div className="max-w-3xl mx-auto px-6 py-4">
            <div className="flex items-center">
              {steps.map((s, idx) => {
                const isCurrent = s.key === step;
                const isDone = idx < currentStepIndex;
                const clickable = idx <= currentStepIndex && !!book;
                return (
                  <div key={s.key} className="flex items-center flex-1 last:flex-none">
                    <button
                      onClick={() => clickable && setStep(s.key)}
                      disabled={!clickable}
                      className="group flex items-center gap-2.5 disabled:cursor-default"
                    >
                      <span className={`relative w-9 h-9 shrink-0 rounded-full flex items-center justify-center transition-all duration-300 ${
                        isCurrent
                          ? 'bg-gradient-to-br from-brand to-magic text-white shadow-glow ring-4 ring-brand/15'
                          : isDone
                          ? 'bg-emerald-500 text-white group-hover:scale-110'
                          : 'bg-gray-200 text-gray-400'
                      }`}>
                        {isDone
                          ? <Icon name="check" size={20} />
                          : <Icon name={s.icon} filled={isCurrent} size={19} />}
                      </span>
                      <span className={`hidden sm:block text-sm font-heading font-semibold transition-colors ${
                        isCurrent ? 'text-brand' : isDone ? 'text-emerald-600' : 'text-gray-400'
                      }`}>
                        {s.label}
                      </span>
                    </button>
                    {idx < steps.length - 1 && (
                      <div className="flex-1 h-1 mx-3 rounded-full bg-gray-200/80 overflow-hidden">
                        <div className={`h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-500 transition-all duration-500 ${
                          isDone ? 'w-full' : 'w-0'
                        }`} />
                      </div>
                    )}
                  </div>
                );
              })}
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

        {step === 'bookstore' && (
          <Bookstore
            onBack={() => setStep('library')}
            initialBookId={sharedBookId || undefined}
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
            onSpreadsProgress={handleSpreadsProgress}
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

      {/* Reference Manager Modal */}
      {showRefManager && (
        <ReferenceManager onClose={() => setShowRefManager(false)} />
      )}

      {/* Login Modal */}
      {showLogin && (
        <LoginModal onClose={() => setShowLogin(false)} />
      )}
    </main>
  );
}
