'use client';

import { useState } from 'react';
import { BookProject, BookFormat, SavedText } from '@/lib/types';
import { saveText } from '@/lib/storage';
import BookCreator from './BookCreator';
import SavedTextPicker from './SavedTextPicker';

type Mode = 'choose' | 'import' | 'create' | 'savedTexts';

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
  { value: 'bildbok-separat-text', label: 'Bildbok med separat text (Luna-stil)', comingSoon: true },
  { value: 'kapitelbok', label: 'Kapitelbok', comingSoon: true },
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
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-heading font-bold text-gray-800 mb-2">
            Steg 1: Skapa eller importera bok
          </h2>
          <p className="text-gray-600">
            Välj om du vill skapa en helt ny bok med AI, importera befintlig boktext, eller använda en sparad text.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Create new */}
          <button
            onClick={() => onModeChange('create')}
            className="card-glass p-8 text-left hover:-translate-y-1 group"
          >
            <div className="w-16 h-16 mb-4 flex items-center justify-center rounded-2xl bg-gradient-to-br from-brand to-magic text-3xl shadow-glow">✨</div>
            <h3 className="text-xl font-heading font-bold text-gray-800 mb-2 group-hover:text-brand transition-colors">
              Skapa ny bok med AI
            </h3>
            <p className="text-gray-500">
              Fyll i titel, karaktärer, handling och stil. Claude AI skapar hela boken
              - text, kapitel och bildpromptar.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <span className="magic-chip">Bildbok</span>
              <span className="magic-chip">Kapitelbok</span>
              <span className="magic-chip">Lärobok</span>
            </div>
          </button>

          {/* Import existing */}
          <button
            onClick={() => onModeChange('import')}
            className="card-glass p-8 text-left hover:-translate-y-1 group"
          >
            <div className="w-16 h-16 mb-4 flex items-center justify-center rounded-2xl bg-gradient-to-br from-trust to-brand text-3xl shadow-glow">📋</div>
            <h3 className="text-xl font-heading font-bold text-gray-800 mb-2 group-hover:text-trust transition-colors">
              Importera befintlig boktext
            </h3>
            <p className="text-gray-500">
              Har du redan text med karaktärer, sidtexter och bildpromptar?
              Klistra in den och vi parsar den automatiskt.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <span className="magic-chip">SIDA X-Y format</span>
              <span className="magic-chip">BILDPROMPT</span>
              <span className="magic-chip">KARAKTERER</span>
            </div>
          </button>

          {/* Use saved text */}
          <button
            onClick={() => onModeChange('savedTexts')}
            className="card-glass p-8 text-left hover:-translate-y-1 group"
          >
            <div className="w-16 h-16 mb-4 flex items-center justify-center rounded-2xl bg-gradient-to-br from-sunset to-magic text-3xl shadow-glow">📚</div>
            <h3 className="text-xl font-heading font-bold text-gray-800 mb-2 group-hover:text-magic transition-colors">
              Sparade texter
            </h3>
            <p className="text-gray-500">
              Använd en tidigare sparad boktext. Perfekt för att testa samma historia
              med nya karaktärer eller annat bildformat.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <span className="magic-chip">Snabb start</span>
              <span className="magic-chip">Återanvänd text</span>
            </div>
          </button>
        </div>
      </div>
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
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-heading font-bold text-gray-800 mb-2">
            {parsedBook ? 'Bokdata klar!' : 'Importera bokdata'}
          </h2>
          <p className="text-gray-600">
            {parsedBook
              ? 'Granska resultatet och fortsatt till karaktärer.'
              : 'Klistra in din boktext med karaktärer, sidtexter och bildpromptar.'}
          </p>
        </div>
        <button
          onClick={() => { onModeChange('choose'); onParsedBookChange(null); }}
          className="btn-ghost"
        >
          Tillbaka
        </button>
      </div>

      {!parsedBook && (
        <>
          {/* Book format selector for import */}
          <div>
            <label className="block text-sm font-heading font-semibold text-gray-700 mb-2">
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
                      ? 'bg-white/40 text-gray-400 cursor-not-allowed ring-1 ring-gray-200/60'
                      : importFormat === fmt.value
                      ? 'bg-gradient-to-r from-brand to-magic text-white shadow-glow'
                      : 'bg-gradient-to-r from-brand/10 to-magic/10 text-brand ring-1 ring-brand/15 hover:ring-brand/30'
                  }`}
                >
                  {fmt.label}
                  {fmt.comingSoon && <span className="ml-1.5 text-xs text-sunset font-semibold">(kommer snart)</span>}
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
            className="field h-96 font-mono text-sm resize-y"
          />

          <div className="flex items-center gap-4">
            <button
              onClick={handleParse}
              disabled={loading || !rawText.trim()}
              className="btn-action"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Parsar...
                </span>
              ) : (
                'Parsa bokdata'
              )}
            </button>

            <span className="text-gray-500 text-sm">
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
            ? 'ring-1 ring-sunset/30'
            : 'ring-1 ring-brand/15'
        }`}>
          {/* Warning if parsing found nothing */}
          {(parsedBook.spreads.length === 0 || parsedBook.characters.length === 0) && (
            <div className="p-3 bg-sunset/10 ring-1 ring-sunset/30 rounded-2xl text-amber-700 text-sm">
              <strong>Parsningen hittade {parsedBook.spreads.length === 0 ? 'inga uppslag' : ''}{parsedBook.spreads.length === 0 && parsedBook.characters.length === 0 ? ' och ' : ''}{parsedBook.characters.length === 0 ? 'inga karaktärer' : ''}.</strong>
              <br />
              Klicka &quot;Redigera text&quot; för att se och redigera den genererade texten, och försök parsa igen.
              AI-texten kan ibland använda ett format som parsern inte känner igen.
            </div>
          )}
          <h3 className={`text-lg font-heading font-bold ${
            parsedBook.spreads.length === 0 ? 'text-amber-700' : 'text-brand'
          }`}>
            {parsedBook.title || 'Parsning klar!'}
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="glass rounded-2xl p-3 text-center">
              <p className="text-2xl font-heading font-bold text-trust">{parsedBook.spreads.length}</p>
              <p className="text-xs text-gray-500">Uppslag</p>
            </div>
            <div className="glass rounded-2xl p-3 text-center">
              <p className="text-2xl font-heading font-bold text-brand">{parsedBook.characters.length}</p>
              <p className="text-xs text-gray-500">Karaktärer</p>
            </div>
            <div className="glass rounded-2xl p-3 text-center">
              <p className="text-2xl font-heading font-bold text-magic">
                {parsedBook.spreads.filter(s => s.pages === 'omslag').length > 0 ? 'Ja' : 'Nej'}
              </p>
              <p className="text-xs text-gray-500">Omslag</p>
            </div>
            <div className="glass rounded-2xl p-3 text-center">
              <p className="text-2xl font-heading font-bold text-sunset">
                {parsedBook.spreads.reduce((sum, s) => sum + s.textBlocks.length, 0)}
              </p>
              <p className="text-xs text-gray-500">Textblock</p>
            </div>
          </div>

          {/* List all spreads */}
          <div className="max-h-48 overflow-y-auto">
            <p className="text-sm font-heading font-semibold text-gray-700 mb-2">Hittade uppslag:</p>
            <div className="flex flex-wrap gap-1">
              {parsedBook.spreads.map((s) => (
                <span key={s.id} className="text-xs bg-white/70 ring-1 ring-brand/15 text-brand rounded-full px-2 py-1">
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
              className="btn-action flex-1"
            >
              Ser bra ut - fortsatt till karaktärer
            </button>
            <button
              onClick={handleSaveText}
              disabled={textSaved}
              className={`px-5 py-3 rounded-full font-heading font-semibold transition-all flex items-center gap-2 ${
                textSaved
                  ? 'bg-brand/10 text-brand ring-1 ring-brand/20'
                  : 'bg-gradient-to-r from-sunset to-magic text-white shadow-glow hover:shadow-glow-lg hover:-translate-y-0.5'
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
              </svg>
              {textSaved ? 'Sparad!' : 'Spara text'}
            </button>
            <button
              onClick={() => onParsedBookChange(null)}
              className="btn-ghost"
            >
              Redigera text
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
