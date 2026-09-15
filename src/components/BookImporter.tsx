'use client';

import { useState } from 'react';
import { BookProject, BookFormat, SavedText } from '@/lib/types';
import { saveText } from '@/lib/storage';
import BookCreator from './BookCreator';
import SavedTextPicker from './SavedTextPicker';
import StyleTester from './StyleTester';
import Icon from './Icon';
import StepHeader from './StepHeader';

type Mode = 'choose' | 'import' | 'create' | 'savedTexts' | 'styleTest';

interface Props {
  onBookParsed: (book: BookProject) => void;
  // Lifted state - controlled by parent (page.tsx) for persistence across steps
  rawText: string;
  onRawTextChange: (text: string) => void;
  mode: Mode;
  onModeChange: (mode: Mode) => void;
  importFormat: BookFormat;
  onImportFormatChange: (format: BookFormat) => void;
  parsedBook: BookProject | null;
  onParsedBookChange: (book: BookProject | null) => void;
}

const FORMAT_CHOICES: { value: BookFormat; label: string; comingSoon?: boolean }[] = [
  { value: 'bildbok-text-pa-bild', label: 'Bildbok med text på bild (Handbok-stil)' },
  { value: 'bildbok-separat-text', label: 'Bildbok med separat text' },
  { value: 'kapitelbok', label: 'Kapitelbok' },
  { value: 'larobok', label: 'Lärobok / Aktivitetsbok', comingSoon: true },
];

export default function BookImporter({
  onBookParsed,
  rawText,
  onRawTextChange,
  mode,
  onModeChange,
  importFormat,
  onImportFormatChange,
  parsedBook,
  onParsedBookChange,
}: Props) {
  // Only transient UI state stays local
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [textSaved, setTextSaved] = useState(false);

  const handleSaveText = async () => {
    if (!parsedBook || !rawText) return;
    try {
      const savedTextEntry: SavedText = {
        id: `text-${Date.now()}`,
        title: parsedBook.title || 'Namnlös text',
        rawText,
        bookFormat: importFormat,
        characterCount: parsedBook.characters.length,
        spreadCount: parsedBook.spreads.length,
        savedAt: new Date().toISOString(),
      };
      await saveText(savedTextEntry);
      setTextSaved(true);
      setTimeout(() => setTextSaved(false), 3000);
    } catch (err) {
      setError('Kunde inte spara texten');
    }
  };

  const handleTextSelected = (text: SavedText) => {
    onRawTextChange(text.rawText);
    if (text.bookFormat) onImportFormatChange(text.bookFormat);
    onModeChange('import');
  };

  const handleParse = async () => {
    if (!rawText.trim()) {
      setError('Klistra in boktext först');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/parse-book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rawText }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Parsning misslyckades');
      }

      const book: BookProject = await res.json();
      book.bookFormat = importFormat;
      onParsedBookChange(book);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Något gick fel');
    } finally {
      setLoading(false);
    }
  };

  const handleBookCreated = (book: BookProject, generatedRawText: string) => {
    onParsedBookChange(book);
    onRawTextChange(generatedRawText);
    onModeChange('import');
  };

  // Choose mode screen
  if (mode === 'choose') {
    return (
      <div className="space-y-7">
        <StepHeader
          eyebrow="Steg 1 av 4 · Berättelsen"
          title="Hur vill du börja?"
          description="Låt AI:n skriva en ny bok, använd en text du redan har, eller prova stilar på början av ditt manus."
        />

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {([
            {
              mode: 'create' as const,
              icon: 'auto_awesome',
              title: 'Låt AI:n skriva boken',
              text: 'Beskriv idén, karaktärerna och stilen. AI:n skriver hela berättelsen och delar upp den i sidor.',
              cta: 'Kom igång',
              accent: true,
            },
            {
              mode: 'import' as const,
              icon: 'content_paste',
              title: 'Använd en färdig text',
              text: 'Har du redan text med karaktärer, sidor och bildbeskrivningar? Klistra in den så delas den upp automatiskt.',
              cta: 'Klistra in text',
            },
            {
              mode: 'savedTexts' as const,
              icon: 'bookmarks',
              title: 'Sparade texter',
              text: 'Återanvänd en text du sparat tidigare – till exempel för att prova nya karaktärer eller ett annat format.',
              cta: 'Bläddra',
            },
          ]).map(opt => (
            <button
              key={opt.mode}
              onClick={() => onModeChange(opt.mode)}
              className="card-glass p-6 text-left flex flex-col group hover:-translate-y-0.5"
            >
              <span className={`w-12 h-12 rounded-2xl flex items-center justify-center ${
                opt.accent ? 'bg-brand text-white' : 'bg-paper border border-line text-ink'
              }`}>
                <Icon name={opt.icon} size={24} />
              </span>
              <h3 className="mt-5 text-xl font-heading font-bold text-ink">{opt.title}</h3>
              <p className="mt-2 text-sm text-ink/60 leading-relaxed flex-1">{opt.text}</p>
              <span className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-ink group-hover:gap-2.5 transition-all">
                {opt.cta} <Icon name="arrow_forward" size={18} />
              </span>
            </button>
          ))}
        </div>

        {/* Stilprovning */}
        <button
          onClick={() => onModeChange('styleTest')}
          className="w-full rounded-3xl bg-ink text-white p-6 sm:p-7 text-left group hover:bg-ink/95 transition-colors"
        >
          <div className="flex flex-col md:flex-row md:items-center gap-5">
            <span className="w-12 h-12 shrink-0 rounded-2xl bg-white/10 flex items-center justify-center">
              <Icon name="palette" size={24} />
            </span>
            <div className="flex-1">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-white/50">Osäker på stilen?</p>
              <h3 className="mt-1 text-xl sm:text-2xl font-heading font-bold">Prova stilar på början av din text</h3>
              <p className="mt-1.5 text-white/65 text-sm leading-relaxed max-w-2xl">
                Klistra in en start och ett första kapitel. Du får omslag och testsidor i flera stilar – Luna,
                Familjen Knyckertz, Handbok för Superhjältar m.fl. – och väljer sedan vilken väg boken ska ta.
              </p>
            </div>
            <span className="shrink-0 inline-flex items-center gap-1.5 px-5 py-2.5 rounded-full bg-white text-ink font-semibold text-sm group-hover:gap-2.5 transition-all">
              Starta provning <Icon name="arrow_forward" size={18} />
            </span>
          </div>
        </button>
      </div>
    );
  }

  // Style test mode
  if (mode === 'styleTest') {
    return (
      <StyleTester
        onContinue={onBookParsed}
        onBack={() => onModeChange('choose')}
      />
    );
  }

  // Saved texts mode
  if (mode === 'savedTexts') {
    return (
      <SavedTextPicker
        onTextSelected={handleTextSelected}
        onBack={() => onModeChange('choose')}
      />
    );
  }

  // Create mode
  if (mode === 'create' && !parsedBook) {
    return (
      <BookCreator
        onBookCreated={handleBookCreated}
        onBack={() => onModeChange('choose')}
      />
    );
  }

  // Import mode (also shows results after AI creation)
  return (
    <div className="space-y-6">
      <StepHeader
        eyebrow="Steg 1 av 4 · Berättelsen"
        title={parsedBook ? 'Texten är klar' : 'Importera en färdig text'}
        description={parsedBook
          ? 'Kontrollera att karaktärer och sidor hittades rätt, och fortsätt sedan till karaktärerna.'
          : 'Klistra in text i bokverktygets format med karaktärer, sidtexter och bildbeskrivningar.'}
        onBack={() => { onModeChange('choose'); onParsedBookChange(null); }}
      />

      {!parsedBook && (
        <>
          {/* Book format selector for import */}
          <div>
            <label className="block text-sm font-semibold text-ink/80 mb-2">
              Bokformat (viktigt för bildgenerering)
            </label>
            <div className="flex flex-wrap gap-2">
              {FORMAT_CHOICES.map((fmt) => (
                <button
                  key={fmt.value}
                  onClick={() => !fmt.comingSoon && onImportFormatChange(fmt.value)}
                  disabled={fmt.comingSoon}
                  className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
                    fmt.comingSoon
                      ? 'bg-white text-ink/40 cursor-not-allowed ring-1 ring-line'
                      : importFormat === fmt.value
                      ? 'bg-ink text-white shadow-soft'
                      : 'bg-white text-ink/75 ring-1 ring-line hover:ring-ink/30'
                  }`}
                >
                  {fmt.label}
                  {fmt.comingSoon && <span className="ml-1.5 text-xs text-amber-600 font-semibold">(kommer snart)</span>}
                </button>
              ))}
            </div>
          </div>

          <textarea
            value={rawText}
            onChange={(e) => onRawTextChange(e.target.value)}
            placeholder={`Klistra in din bokdata har...

Exempel:
KARAKTERER
* Ella (Blixten) - 11 ar, brunt lockigt har...

SIDA 6-7 (Uppslag 1)
Text (sida 6):
Det hade gatt tre manader sedan...

BILDPROMPT - SIDA 6-7:
Double page spread, Swedish children's book...`}
            className="field h-96 text-sm leading-relaxed resize-y"
          />

          <div className="flex items-center gap-4">
            <button
              onClick={handleParse}
              disabled={loading || !rawText.trim()}
              className="btn-action inline-flex items-center gap-2"
            >
              {loading ? (
                <><span className="spinner" /> Parsar...</>
              ) : (
                <><Icon name="auto_fix_high" filled size={19} /> Parsa bokdata</>
              )}
            </button>

            <span className="text-ink/55 text-sm">
              {rawText.length > 0 && `${rawText.length.toLocaleString()} tecken`}
            </span>
          </div>
        </>
      )}

      {error && (
        <div className="p-4 glass border-red-200/70 rounded-2xl text-red-600">
          {error}
        </div>
      )}

      {/* Parsing results summary */}
      {parsedBook && (
        <div className={`card-glass p-6 space-y-4 ${
          parsedBook.spreads.length === 0 || parsedBook.characters.length === 0
            ? 'ring-1 ring-amber-200'
            : 'ring-1 ring-line'
        }`}>
          {/* Warning if parsing found nothing */}
          {(parsedBook.spreads.length === 0 || parsedBook.characters.length === 0) && (
            <div className="p-3 bg-amber-50 ring-1 ring-amber-200 rounded-2xl text-amber-700 text-sm">
              <strong>Parsningen hittade {parsedBook.spreads.length === 0 ? 'inga uppslag' : ''}{parsedBook.spreads.length === 0 && parsedBook.characters.length === 0 ? ' och ' : ''}{parsedBook.characters.length === 0 ? 'inga karaktärer' : ''}.</strong>
              <br />
              Klicka &quot;Redigera text&quot; för att se och redigera den genererade texten, och försök parsa igen.
              AI-texten kan ibland använda ett format som parsern inte känner igen.
            </div>
          )}
          <h3 className={`text-lg font-heading font-semibold ${
            parsedBook.spreads.length === 0 ? 'text-amber-700' : 'text-brand'
          }`}>
            {parsedBook.title || 'Parsning klar!'}
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="glass rounded-2xl p-3 text-center">
              <p className="text-2xl font-heading font-bold text-brand">{parsedBook.spreads.length}</p>
              <p className="text-xs text-ink/55">Uppslag</p>
            </div>
            <div className="glass rounded-2xl p-3 text-center">
              <p className="text-2xl font-heading font-bold text-brand">{parsedBook.characters.length}</p>
              <p className="text-xs text-ink/55">Karaktärer</p>
            </div>
            <div className="glass rounded-2xl p-3 text-center">
              <p className="text-2xl font-heading font-bold text-brand">
                {parsedBook.spreads.filter(s => s.pages === 'omslag').length > 0 ? 'Ja' : 'Nej'}
              </p>
              <p className="text-xs text-ink/55">Omslag</p>
            </div>
            <div className="glass rounded-2xl p-3 text-center">
              <p className="text-2xl font-heading font-bold text-amber-600">
                {parsedBook.spreads.reduce((sum, s) => sum + s.textBlocks.length, 0)}
              </p>
              <p className="text-xs text-ink/55">Textblock</p>
            </div>
          </div>

          {/* List all spreads */}
          <div className="max-h-48 overflow-y-auto">
            <p className="text-sm font-semibold text-ink/80 mb-2">Hittade uppslag:</p>
            <div className="flex flex-wrap gap-1">
              {parsedBook.spreads.map((s) => (
                <span key={s.id} className="text-xs bg-white ring-1 ring-line text-brand rounded-full px-2 py-1">
                  {s.pages === 'omslag' ? 'Omslag' :
                   s.pages === 'slutsida' ? 'Slutsida' :
                   `S.${s.pages}`}
                </span>
              ))}
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => onBookParsed(parsedBook)}
              className="btn-action flex-1 inline-flex items-center justify-center gap-2"
            >
              Ser bra ut – fortsätt till karaktärer <Icon name="arrow_forward" size={19} />
            </button>
            <button
              onClick={handleSaveText}
              disabled={textSaved}
              className={`px-5 py-3 rounded-full font-semibold transition-all flex items-center gap-2 ${
                textSaved
                  ? 'bg-brand/10 text-brand ring-1 ring-brand/20'
                  : 'bg-brand text-white shadow-soft hover:shadow-lift hover:-translate-y-0.5'
              }`}
            >
              <Icon name={textSaved ? 'check' : 'bookmark_add'} filled={!textSaved} size={18} />
              {textSaved ? 'Sparad!' : 'Spara text'}
            </button>
            <button
              onClick={() => onParsedBookChange(null)}
              className="btn-ghost inline-flex items-center gap-1.5"
            >
              <Icon name="edit" size={17} /> Redigera text
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
