'use client';

import { useState } from 'react';
import { BookProject, BookFormat, SavedText } from '@/lib/types';
import { saveText } from '@/lib/storage';
import BookCreator from './BookCreator';
import SavedTextPicker from './SavedTextPicker';
import Icon from './Icon';

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
      <div className="space-y-7">
        <div>
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-brand/10 text-brand text-xs font-heading font-bold uppercase tracking-wide ring-1 ring-brand/15">
            <Icon name="counter_1" filled size={16} /> Steg 1
          </span>
          <h2 className="mt-3 text-3xl font-heading font-bold text-gray-800">
            Hur vill du börja?
          </h2>
          <p className="mt-1.5 text-gray-500 max-w-2xl">
            Skapa en helt ny bok med AI, importera en befintlig boktext, eller återanvänd en sparad text.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Create new — recommended */}
          <button
            onClick={() => onModeChange('create')}
            className="relative card-glass p-7 text-left hover:-translate-y-1.5 group ring-1 ring-brand/15 hover:ring-brand/40 flex flex-col"
          >
            <span className="absolute top-4 right-4 inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-gradient-to-r from-brand to-magic text-white text-[10px] font-heading font-bold uppercase tracking-wide shadow-glow">
              <Icon name="star" filled size={13} /> Populärast
            </span>
            <div className="w-16 h-16 mb-4 flex items-center justify-center rounded-2xl bg-gradient-to-br from-brand to-magic text-white shadow-glow group-hover:scale-105 group-hover:rotate-3 transition-transform">
              <Icon name="auto_awesome" filled size={32} />
            </div>
            <h3 className="text-xl font-heading font-bold text-gray-800 mb-2 group-hover:text-brand transition-colors">
              Skapa ny bok med AI
            </h3>
            <p className="text-gray-500 text-sm leading-relaxed flex-1">
              Fyll i titel, karaktärer, handling och stil. Claude AI skapar hela boken
              — text, kapitel och bildpromptar.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <span className="magic-chip">Bildbok</span>
              <span className="magic-chip">Kapitelbok</span>
              <span className="magic-chip">Lärobok</span>
            </div>
            <span className="mt-5 inline-flex items-center gap-1.5 text-brand font-heading font-bold text-sm group-hover:gap-2.5 transition-all">
              Kom igång <Icon name="arrow_forward" size={18} />
            </span>
          </button>

          {/* Import existing */}
          <button
            onClick={() => onModeChange('import')}
            className="card-glass p-7 text-left hover:-translate-y-1.5 group ring-1 ring-transparent hover:ring-trust/30 flex flex-col"
          >
            <div className="w-16 h-16 mb-4 flex items-center justify-center rounded-2xl bg-gradient-to-br from-trust to-brand text-white shadow-glow group-hover:scale-105 group-hover:rotate-3 transition-transform">
              <Icon name="content_paste" filled size={30} />
            </div>
            <h3 className="text-xl font-heading font-bold text-gray-800 mb-2 group-hover:text-trust transition-colors">
              Importera befintlig boktext
            </h3>
            <p className="text-gray-500 text-sm leading-relaxed flex-1">
              Har du redan text med karaktärer, sidtexter och bildpromptar?
              Klistra in den och vi parsar den automatiskt.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <span className="magic-chip">SIDA X-Y format</span>
              <span className="magic-chip">BILDPROMPT</span>
              <span className="magic-chip">KARAKTERER</span>
            </div>
            <span className="mt-5 inline-flex items-center gap-1.5 text-trust font-heading font-bold text-sm group-hover:gap-2.5 transition-all">
              Klistra in text <Icon name="arrow_forward" size={18} />
            </span>
          </button>

          {/* Use saved text */}
          <button
            onClick={() => onModeChange('savedTexts')}
            className="card-glass p-7 text-left hover:-translate-y-1.5 group ring-1 ring-transparent hover:ring-magic/30 flex flex-col"
          >
            <div className="w-16 h-16 mb-4 flex items-center justify-center rounded-2xl bg-gradient-to-br from-sunset to-magic text-white shadow-glow group-hover:scale-105 group-hover:rotate-3 transition-transform">
              <Icon name="bookmarks" filled size={30} />
            </div>
            <h3 className="text-xl font-heading font-bold text-gray-800 mb-2 group-hover:text-magic transition-colors">
              Sparade texter
            </h3>
            <p className="text-gray-500 text-sm leading-relaxed flex-1">
              Använd en tidigare sparad boktext. Perfekt för att testa samma historia
              med nya karaktärer eller annat bildformat.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <span className="magic-chip">Snabb start</span>
              <span className="magic-chip">Återanvänd text</span>
            </div>
            <span className="mt-5 inline-flex items-center gap-1.5 text-magic font-heading font-bold text-sm group-hover:gap-2.5 transition-all">
              Bläddra <Icon name="arrow_forward" size={18} />
            </span>
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
      <div className="flex items-start justify-between gap-4">
        <div>
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-brand/10 text-brand text-xs font-heading font-bold uppercase tracking-wide ring-1 ring-brand/15">
            <Icon name="counter_1" filled size={16} /> Steg 1
          </span>
          <h2 className="mt-3 text-3xl font-heading font-bold text-gray-800">
            {parsedBook ? 'Bokdata klar!' : 'Importera bokdata'}
          </h2>
          <p className="mt-1.5 text-gray-500 max-w-2xl">
            {parsedBook
              ? 'Granska resultatet och fortsätt till karaktärerna.'
              : 'Klistra in din boktext med karaktärer, sidtexter och bildpromptar.'}
          </p>
        </div>
        <button
          onClick={() => { onModeChange('choose'); onParsedBookChange(null); }}
          className="shrink-0 inline-flex items-center gap-1.5 text-brand/70 hover:text-brand font-heading font-semibold transition-colors"
        >
          <Icon name="arrow_back" size={18} /> Tillbaka
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
              className="btn-action inline-flex items-center gap-2"
            >
              {loading ? (
                <><span className="spinner" /> Parsar...</>
              ) : (
                <><Icon name="auto_fix_high" filled size={19} /> Parsa bokdata</>
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
              className="btn-action flex-1 inline-flex items-center justify-center gap-2"
            >
              Ser bra ut – fortsätt till karaktärer <Icon name="arrow_forward" size={19} />
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
