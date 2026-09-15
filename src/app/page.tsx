'use client';

import { useState, useEffect, useCallback } from 'react';
import { BookProject, Character, Spread, BookFormat } from '@/lib/types';
import { saveBook } from '@/lib/storage';
import { useAuth } from '@/lib/auth';
import BookLibrary from '@/components/BookLibrary';
import BookImporter, { EMPTY_DRAFT, ImportMode, ManuscriptDraft } from '@/components/BookImporter';
import CharacterStudio from '@/components/CharacterStudio';
import FinishBook from '@/components/finish/FinishBook';
import CharacterApproval from '@/components/CharacterApproval';
import PageGenerator from '@/components/PageGenerator';
import BookPreview from '@/components/BookPreview';
import ReferenceManager from '@/components/ReferenceManager';
import LoginModal from '@/components/LoginModal';
import Bookstore from '@/components/Bookstore';
import Icon from '@/components/Icon';
import { SiteHeader, SiteFooter, MobileTabBar, NavTarget } from '@/components/AppNav';

type Step = 'library' | 'import' | 'characters' | 'generate' | 'review' | 'bookstore' | 'characterStudio' | 'finish';

export default function Home() {
  const [step, setStep] = useState<Step>('library');
  const [book, setBook] = useState<BookProject | null>(null);
  const [autoSaveTimer, setAutoSaveTimer] = useState<NodeJS.Timeout | null>(null);

  // Lifted state from BookImporter - persists across step navigation
  const [importDraft, setImportDraft] = useState<ManuscriptDraft>(EMPTY_DRAFT);
  const [importMode, setImportMode] = useState<ImportMode>('choose');
  const [importParsedBook, setImportParsedBook] = useState<BookProject | null>(null);
  const [isClonedBook, setIsClonedBook] = useState(false);
  const [showRefManager, setShowRefManager] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const [sharedBookId, setSharedBookId] = useState<string | null>(null);
  const { user, signOut, loading: authLoading } = useAuth();

  // Referensdatabasen är ett internt verktyg. Visas för e-postadresser i
  // NEXT_PUBLIC_ADMIN_EMAILS, eller på en enhet som öppnat /?admin=1 (av: /?admin=0).
  // Bara ett sätt att dölja menyn - behörigheten styrs av databasens regler.
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    let flag = false;
    try {
      const admin = new URLSearchParams(window.location.search).get('admin');
      if (admin === '1') localStorage.setItem('barnbok-admin', '1');
      if (admin === '0') localStorage.removeItem('barnbok-admin');
      flag = localStorage.getItem('barnbok-admin') === '1';
    } catch {
      // Lagring blockerad - bara e-postlistan gäller
    }
    const admins = (process.env.NEXT_PUBLIC_ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
    setIsAdmin(flag || (!!user?.email && admins.includes(user.email.toLowerCase())));
  }, [user]);

  // Börja överst på varje nytt steg
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [step]);

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
    // Tillbaka från ett senare steg utan att dela upp texten igen: behåll boken
    // med dess karaktärsbilder och illustrationer i stället för den gamla kopian
    setBook(prev => (prev && prev.id === parsedBook.id ? prev : parsedBook));
    setImportParsedBook(parsedBook);
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
    setBook(prev => prev && { ...prev, characters, status: 'generating' as const });
    setStep('generate');
  };

  // Karaktärsbilder sparas medan de skapas, inte först när man går vidare
  const handleCharactersChange = (characters: Character[]) => {
    setBook(prev => prev && { ...prev, characters });
  };

  const handlePagesGenerated = (spreads: Spread[]) => {
    setBook(prev => prev && { ...prev, spreads, status: 'reviewing' as const });
    setStep('review');
  };

  // Called continuously while pages generate, so finished images are auto-saved
  // even if the user leaves before clicking "Granska boken"
  const handleSpreadsProgress = (spreads: Spread[]) => {
    setBook(prev => prev && { ...prev, spreads });
  };

  const handleUpdateSpread = (updatedSpread: Spread) => {
    setBook(prev => prev && {
      ...prev,
      spreads: prev.spreads.map(s => (s.id === updatedSpread.id ? updatedSpread : s)),
    });
  };

  const handleSaveBook = (savedBook: BookProject) => {
    setBook(savedBook);
  };

  const handleNewBook = () => {
    setBook(null);
    setIsClonedBook(false);
    // Reset all import state for a fresh start
    setImportDraft(EMPTY_DRAFT);
    setImportMode('choose');
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

    setImportDraft(EMPTY_DRAFT);
    setImportMode('choose');
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

  const steps: { key: Step; label: string; icon: string }[] = [
    { key: 'import', label: 'Berättelsen', icon: 'edit_note' },
    { key: 'characters', label: 'Karaktärer', icon: 'diversity_3' },
    { key: 'generate', label: 'Illustrera', icon: 'palette' },
    { key: 'review', label: 'Färdig bok', icon: 'auto_stories' },
  ];

  const currentStepIndex = steps.findIndex(s => s.key === step);

  // Huvudmenyn: skapa-flödets steg räknas som "Skapa"
  const navActive: NavTarget =
    step === 'library' || step === 'bookstore' || step === 'characterStudio' ? step : 'create';

  const handleNavigate = (target: NavTarget) => {
    if (target === 'create') {
      // Redan i skapa-flödet: stanna kvar i stället för att börja om
      if (navActive !== 'create' || step === 'finish') handleNewBook();
      return;
    }
    if (target === 'library') return handleBackToLibrary();
    if (target === 'characterStudio') setBook(null);
    setStep(target);
  };
  const showSteps = step !== 'library' && step !== 'bookstore' && step !== 'characterStudio' && step !== 'finish';

  return (
    <main className="min-h-screen overflow-x-clip">
      <SiteHeader
        active={navActive}
        onNavigate={handleNavigate}
        userEmail={user?.email}
        authLoading={authLoading}
        onLogin={() => setShowLogin(true)}
        onLogout={signOut}
        onOpenReferences={isAdmin ? () => setShowRefManager(true) : undefined}
      />

      {/* Stegindikator */}
      {showSteps && (
        <div className="border-b border-line bg-white/60">
          <div className="max-w-4xl mx-auto px-4 sm:px-6">
            <ol className="flex items-center gap-1 sm:gap-2 py-3 overflow-x-auto no-scrollbar">
              {steps.map((s, idx) => {
                const isCurrent = s.key === step;
                const isDone = idx < currentStepIndex;
                const clickable = idx <= currentStepIndex && !!book;
                return (
                  <li key={s.key} className="flex items-center gap-1 sm:gap-2 shrink-0 flex-1 last:flex-none">
                    <button
                      onClick={() => clickable && setStep(s.key)}
                      disabled={!clickable}
                      className={`flex items-center gap-2 rounded-full pl-1 pr-3 py-1 transition-colors disabled:cursor-default ${
                        isCurrent ? 'bg-ink text-white' : isDone ? 'text-ink hover:bg-ink/5' : 'text-ink/40'
                      }`}
                    >
                      <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold ${
                        isCurrent ? 'bg-white/15' : isDone ? 'bg-emerald-600 text-white' : 'bg-ink/[0.06]'
                      }`}>
                        {isDone ? <Icon name="check" size={15} /> : idx + 1}
                      </span>
                      <span className={`text-sm font-medium whitespace-nowrap ${isCurrent ? '' : 'hidden sm:inline'}`}>{s.label}</span>
                    </button>
                    {idx < steps.length - 1 && <span className={`h-px flex-1 min-w-3 ${isDone ? 'bg-emerald-600/40' : 'bg-line'}`} />}
                  </li>
                );
              })}
            </ol>
          </div>
        </div>
      )}

      {/* Main content - key på step ger mjuk intoning vid stegbyte */}
      <div key={step} className="max-w-7xl mx-auto px-4 sm:px-6 pt-6 pb-12 sm:pt-10 sm:pb-16 animate-fade-up">
        {step === 'library' && (
          <BookLibrary
            onLoadBook={handleLoadBook}
            onNewBook={handleNewBook}
            onStyleTest={() => { handleNewBook(); setImportMode('styleTest'); }}
            onReuseBook={handleReuseBook}
            onFinishBook={() => { setBook(null); setStep('finish'); }}
          />
        )}

        {step === 'finish' && (
          <FinishBook
            onBack={() => setStep('library')}
            onCreateBook={({ rawText, title, author, targetAge }) => {
              // Den färdiga texten går vidare till manussteget där stil och bilder väljs
              setBook(null);
              setImportParsedBook(null);
              setImportDraft({ ...EMPTY_DRAFT, rawText, title, author, targetAge, notice: 'Texten från Slutför din bok är inläst. Välj stil och skapa boken.' });
              setImportMode('import');
              setStep('import');
            }}
          />
        )}

        {step === 'characterStudio' && (
          <CharacterStudio onBack={() => setStep('library')} />
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
            draft={importDraft}
            onDraftChange={setImportDraft}
            mode={importMode}
            onModeChange={setImportMode}
            parsedBook={importParsedBook}
            onParsedBookChange={setImportParsedBook}
          />
        )}

        {step === 'characters' && book && (
          <>
            {/* Återanvänd bok: välj format innan nya bilder skapas */}
            {isClonedBook && (
              <div className="mb-8 card-glass hover:!shadow-soft p-5 flex flex-col sm:flex-row sm:items-center gap-4">
                <div className="flex items-start gap-3 flex-1">
                  <span className="w-10 h-10 shrink-0 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center">
                    <Icon name="content_copy" size={20} />
                  </span>
                  <div>
                    <p className="font-semibold text-ink">Kopia av en tidigare bok</p>
                    <p className="text-sm text-ink/60">Karaktärer och text behålls. Välj bokformat innan du skapar nya bilder.</p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {[
                    { value: 'bildbok-separat-text' as BookFormat, label: 'Bilderbok' },
                    { value: 'kapitelbok' as BookFormat, label: 'Kapitelbok' },
                    { value: 'bildbok-text-pa-bild' as BookFormat, label: 'Serieformat' },
                  ].map((fmt) => (
                    <button
                      key={fmt.value}
                      onClick={() => setBook({
                        ...book,
                        bookFormat: fmt.value,
                        // Bildformen gäller bara format med separat text
                        illustrationShape: fmt.value === 'bildbok-text-pa-bild' ? undefined : book.illustrationShape,
                      })}
                      className={book.bookFormat === fmt.value ? 'chip-on' : 'chip'}
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
              onCharactersChange={handleCharactersChange}
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
      <SiteFooter
        onNavigate={handleNavigate}
        onStyleTest={() => { handleNewBook(); setImportMode('styleTest'); }}
      />

      <MobileTabBar active={navActive} onNavigate={handleNavigate} />

      {showLogin && (
        <LoginModal onClose={() => setShowLogin(false)} />
      )}
    </main>
  );
}
