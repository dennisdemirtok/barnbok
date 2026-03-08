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

const FORMAT_CHOICES: { value: BookFormat; label: string }[] = [
  { value: 'bildbok-text-pa-bild', label: 'Bildbok med text pa bild (Handbok-stil)' },
  { value: 'bildbok-separat-text', label: 'Bildbok med separat text (Luna-stil)' },
  { value: 'kapitelbok', label: 'Kapitelbok' },
  { value: 'larobok', label: 'Larobok / Aktivitetsbok' },
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
        title: parsedBook.title || 'Namnlos text',
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
      setError('Klistra in boktext forst');
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
      setError(err instanceof Error ? err.message : 'Nagot gick fel');
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
          <h2 className="text-2xl font-bold text-gray-800 mb-2">
            Steg 1: Skapa eller importera bok
          </h2>
          <p className="text-gray-600">
            Valj om du vill skapa en helt ny bok med AI, importera befintlig boktext, eller anvanda en sparad text.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Create new */}
          <button
            onClick={() => onModeChange('create')}
            className="p-8 border-2 border-gray-200 rounded-2xl text-left hover:border-purple-400
                       hover:shadow-lg transition-all group"
          >
            <div className="text-5xl mb-4">✨</div>
            <h3 className="text-xl font-bold text-gray-800 mb-2 group-hover:text-purple-600 transition-colors">
              Skapa ny bok med AI
            </h3>
            <p className="text-gray-500">
              Fyll i titel, karaktarer, handling och stil. Claude AI skapar hela boken
              - text, kapitel och bildpromptar.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <span className="text-xs bg-purple-100 text-purple-600 px-2 py-1 rounded-full">Bildbok</span>
              <span className="text-xs bg-purple-100 text-purple-600 px-2 py-1 rounded-full">Kapitelbok</span>
              <span className="text-xs bg-purple-100 text-purple-600 px-2 py-1 rounded-full">Larobok</span>
            </div>
          </button>

          {/* Import existing */}
          <button
            onClick={() => onModeChange('import')}
            className="p-8 border-2 border-gray-200 rounded-2xl text-left hover:border-blue-400
                       hover:shadow-lg transition-all group"
          >
            <div className="text-5xl mb-4">📋</div>
            <h3 className="text-xl font-bold text-gray-800 mb-2 group-hover:text-blue-600 transition-colors">
              Importera befintlig boktext
            </h3>
            <p className="text-gray-500">
              Har du redan text med karaktarer, sidtexter och bildpromptar?
              Klistra in den och vi parsar den automatiskt.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <span className="text-xs bg-blue-100 text-blue-600 px-2 py-1 rounded-full">SIDA X-Y format</span>
              <span className="text-xs bg-blue-100 text-blue-600 px-2 py-1 rounded-full">BILDPROMPT</span>
              <span className="text-xs bg-blue-100 text-blue-600 px-2 py-1 rounded-full">KARAKTERER</span>
            </div>
          </button>

          {/* Use saved text */}
          <button
            onClick={() => onModeChange('savedTexts')}
            className="p-8 border-2 border-gray-200 rounded-2xl text-left hover:border-green-400
                       hover:shadow-lg transition-all group"
          >
            <div className="text-5xl mb-4">📚</div>
            <h3 className="text-xl font-bold text-gray-800 mb-2 group-hover:text-green-600 transition-colors">
              Sparade texter
            </h3>
            <p className="text-gray-500">
              Anvand en tidigare sparad boktext. Perfekt for att testa samma historia
              med nya karaktarer eller annat bildformat.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <span className="text-xs bg-green-100 text-green-600 px-2 py-1 rounded-full">Snabb start</span>
              <span className="text-xs bg-green-100 text-green-600 px-2 py-1 rounded-full">Ateranvand text</span>
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
          <h2 className="text-2xl font-bold text-gray-800 mb-2">
            {parsedBook ? 'Bokdata klar!' : 'Importera bokdata'}
          </h2>
          <p className="text-gray-600">
            {parsedBook
              ? 'Granska resultatet och fortsatt till karaktarer.'
              : 'Klistra in din boktext med karaktarer, sidtexter och bildpromptar.'}
          </p>
        </div>
        <button
          onClick={() => { onModeChange('choose'); onParsedBookChange(null); }}
          className="px-4 py-2 text-gray-500 hover:text-gray-700"
        >
          Tillbaka
        </button>
      </div>

      {!parsedBook && (
        <>
          {/* Book format selector for import */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Bokformat (viktigt for bildgenerering)
            </label>
            <div className="flex flex-wrap gap-2">
              {FORMAT_CHOICES.map((fmt) => (
                <button
                  key={fmt.value}
                  onClick={() => onImportFormatChange(fmt.value)}
                  className={`px-4 py-2 rounded-lg text-sm transition-colors ${
                    importFormat === fmt.value
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {fmt.label}
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
            className="w-full h-96 p-4 border-2 border-gray-300 rounded-lg font-mono text-sm
                       focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition-colors
                       resize-y"
          />

          <div className="flex items-center gap-4">
            <button
              onClick={handleParse}
              disabled={loading || !rawText.trim()}
              className="px-8 py-3 bg-blue-600 text-white font-semibold rounded-lg
                         hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed
                         transition-colors"
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
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
          {error}
        </div>
      )}

      {/* Parsing results summary */}
      {parsedBook && (
        <div className={`p-6 rounded-lg space-y-4 ${
          parsedBook.spreads.length === 0 || parsedBook.characters.length === 0
            ? 'bg-yellow-50 border border-yellow-300'
            : 'bg-green-50 border border-green-200'
        }`}>
          {/* Warning if parsing found nothing */}
          {(parsedBook.spreads.length === 0 || parsedBook.characters.length === 0) && (
            <div className="p-3 bg-yellow-100 border border-yellow-300 rounded-lg text-yellow-800 text-sm">
              <strong>Parsningen hittade {parsedBook.spreads.length === 0 ? 'inga uppslag' : ''}{parsedBook.spreads.length === 0 && parsedBook.characters.length === 0 ? ' och ' : ''}{parsedBook.characters.length === 0 ? 'inga karaktarer' : ''}.</strong>
              <br />
              Klicka &quot;Redigera text&quot; for att se och redigera den genererade texten, och forsok parsa igen.
              AI-texten kan ibland anvanda ett format som parsern inte kannar igen.
            </div>
          )}
          <h3 className={`text-lg font-bold ${
            parsedBook.spreads.length === 0 ? 'text-yellow-800' : 'text-green-800'
          }`}>
            {parsedBook.title || 'Parsning klar!'}
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-blue-600">{parsedBook.spreads.length}</p>
              <p className="text-xs text-gray-500">Uppslag</p>
            </div>
            <div className="bg-white rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-purple-600">{parsedBook.characters.length}</p>
              <p className="text-xs text-gray-500">Karaktarer</p>
            </div>
            <div className="bg-white rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-green-600">
                {parsedBook.spreads.filter(s => s.pages === 'omslag').length > 0 ? 'Ja' : 'Nej'}
              </p>
              <p className="text-xs text-gray-500">Omslag</p>
            </div>
            <div className="bg-white rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-orange-600">
                {parsedBook.spreads.reduce((sum, s) => sum + s.textBlocks.length, 0)}
              </p>
              <p className="text-xs text-gray-500">Textblock</p>
            </div>
          </div>

          {/* List all spreads */}
          <div className="max-h-48 overflow-y-auto">
            <p className="text-sm font-semibold text-gray-700 mb-2">Hittade uppslag:</p>
            <div className="flex flex-wrap gap-1">
              {parsedBook.spreads.map((s) => (
                <span key={s.id} className="text-xs bg-white border border-gray-200 rounded px-2 py-1">
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
              className="flex-1 px-8 py-3 bg-green-600 text-white font-semibold rounded-lg
                         hover:bg-green-700 transition-colors"
            >
              Ser bra ut - fortsatt till karaktarer
            </button>
            <button
              onClick={handleSaveText}
              disabled={textSaved}
              className={`px-4 py-3 rounded-lg transition-colors flex items-center gap-2 ${
                textSaved
                  ? 'bg-green-100 text-green-700'
                  : 'bg-yellow-500 text-white hover:bg-yellow-600'
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
              className="px-6 py-3 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
            >
              Redigera text
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
