'use client';

import { useState } from 'react';
import { BookProject } from '@/lib/types';
import { BookConfig, TextDensity } from '@/lib/claude';

interface Props {
  onBookCreated: (book: BookProject, rawText: string) => void;
  onBack: () => void;
}

type BookFormat = BookConfig['bookFormat'];

const FORMAT_OPTIONS: { value: BookFormat; label: string; description: string; icon: string }[] = [
  {
    value: 'bildbok-text-pa-bild',
    label: 'Bildbok med text pa bild',
    description: 'Likt "Handbok for Superhjaltar" - helsides illustrationer med text integrerad i bilden. Kort text, mycket visuellt.',
    icon: '🦸',
  },
  {
    value: 'bildbok-separat-text',
    label: 'Bildbok med separat text',
    description: 'Likt "Luna"-bocker - text ovanfor/under eller bredvid bilderna. Mer text, bild och text kompletterar varandra.',
    icon: '🌙',
  },
  {
    value: 'kapitelbok',
    label: 'Kapitelbok',
    description: 'Likt Harry Potter / Bert-bocker - mest text med enstaka illustrationer. Langre kapitel och detaljerat berattande.',
    icon: '📖',
  },
  {
    value: 'larobok',
    label: 'Larobok / Aktivitetsbok',
    description: 'Likt "Artan, Partan" - blandning av text, bilder och uppgifter. Pedagogiskt upplag.',
    icon: '📐',
  },
];

const PLOT_TAGS = [
  'Aventyr', 'Drama', 'Komedi', 'Mysterium', 'Fantasy', 'Sci-fi',
  'Vanskap', 'Skola', 'Familj', 'Djur', 'Natur', 'Sport',
  'Superhjaltar', 'Magi', 'Rymden', 'Pirater', 'Dinosaurier',
];

const SETTING_TAGS = [
  'Skola', 'Hemma', 'Skog', 'Stad', 'Strand', 'Berg',
  'Rymden', 'Under vatten', 'Slott', 'Bondgard', 'Lekplats',
];

const AGE_OPTIONS = ['3-5 ar', '6-8 ar', '9-12 ar', '12+ ar'];

const PAGE_PRESETS = [
  { pages: 24, label: '24 sidor (kort bildbok)' },
  { pages: 32, label: '32 sidor (standard bildbok)' },
  { pages: 48, label: '48 sidor (langre bildbok)' },
  { pages: 64, label: '64 sidor (kort kapitelbok)' },
  { pages: 96, label: '96 sidor (kapitelbok)' },
  { pages: 128, label: '128 sidor (lang kapitelbok)' },
];

export default function BookCreator({ onBookCreated, onBack }: Props) {
  const [currentStep, setCurrentStep] = useState<1 | 2>(1);

  // Step 1 fields
  const [title, setTitle] = useState('');
  const [bookFormat, setBookFormat] = useState<BookFormat>('bildbok-text-pa-bild');
  const [numCharacters, setNumCharacters] = useState(3);
  const [characterNames, setCharacterNames] = useState('');
  const [numPages, setNumPages] = useState(32);
  const [targetAge, setTargetAge] = useState('6-8 ar');
  const [textDensity, setTextDensity] = useState<TextDensity>('medium');
  const [subject, setSubject] = useState('');

  // Step 2 fields
  const [plotText, setPlotText] = useState('');
  const [selectedPlotTags, setSelectedPlotTags] = useState<string[]>([]);
  const [setting, setSetting] = useState('');
  const [selectedSettingTags, setSelectedSettingTags] = useState<string[]>([]);
  const [imageStyle, setImageStyle] = useState('Farggrant, manga/comic-stil med stora uttrycksfulla ogon, tjocka konturer, detaljerade bakgrunder, skandinavisk estetik');

  // State
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState('');

  // Word counts per spread based on real book data (Luna ~180 ord/textsida, Handbok ~100 ord/sida)
  const getWordsPerSpread = () => {
    const wordsTable: Record<BookFormat, Record<TextDensity, number>> = {
      'bildbok-text-pa-bild': { minimal: 45, lite: 80, medium: 130, mycket: 200 },
      'bildbok-separat-text': { minimal: 45, lite: 80, medium: 130, mycket: 190 },
      'kapitelbok': { minimal: 250, lite: 350, medium: 480, mycket: 630 },
      'larobok': { minimal: 90, lite: 160, medium: 250, mycket: 350 },
    };
    return wordsTable[bookFormat][textDensity];
  };

  const estimatedWords = () => {
    const spreads = Math.ceil(numPages / 2);
    return Math.round(spreads * getWordsPerSpread());
  };

  // Format-specific word range descriptions for the density buttons
  const getDensityOptions = (): { value: TextDensity; label: string; desc: string; words: string }[] => {
    const options: Record<BookFormat, { value: TextDensity; label: string; desc: string; words: string }[]> = {
      'bildbok-text-pa-bild': [
        { value: 'minimal', label: 'Minimal', desc: '1-2 meningar/ruta', words: '15-30 ord/sida' },
        { value: 'lite', label: 'Lite', desc: '2-3 meningar/ruta', words: '30-50 ord/sida' },
        { value: 'medium', label: 'Medium', desc: '3-5 meningar/ruta', words: '50-80 ord/sida' },
        { value: 'mycket', label: 'Mycket', desc: '4-6 meningar/ruta', words: '80-120 ord/sida' },
      ],
      'bildbok-separat-text': [
        { value: 'minimal', label: 'Minimal', desc: '2-4 meningar', words: '30-60 ord/sida' },
        { value: 'lite', label: 'Lite', desc: '4-6 meningar', words: '60-100 ord/sida' },
        { value: 'medium', label: 'Medium', desc: '6-10 meningar', words: '100-160 ord/sida' },
        { value: 'mycket', label: 'Mycket', desc: '10+ meningar', words: '160-220 ord/sida' },
      ],
      'kapitelbok': [
        { value: 'minimal', label: 'Minimal', desc: 'Korta stycken', words: '100-150 ord/sida' },
        { value: 'lite', label: 'Lite', desc: 'Lagom stycken', words: '150-200 ord/sida' },
        { value: 'medium', label: 'Medium', desc: 'Typisk kapitelbok', words: '200-280 ord/sida' },
        { value: 'mycket', label: 'Mycket', desc: 'Riklig text', words: '280-350 ord/sida' },
      ],
      'larobok': [
        { value: 'minimal', label: 'Minimal', desc: 'Korta instruktioner', words: '30-60 ord/sida' },
        { value: 'lite', label: 'Lite', desc: 'Tydliga forklaringar', words: '60-100 ord/sida' },
        { value: 'medium', label: 'Medium', desc: 'Utforliga ovningar', words: '100-150 ord/sida' },
        { value: 'mycket', label: 'Mycket', desc: 'Detaljerat', words: '150-200 ord/sida' },
      ],
    };
    return options[bookFormat];
  };

  const togglePlotTag = (tag: string) => {
    setSelectedPlotTags(prev =>
      prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
    );
  };

  const toggleSettingTag = (tag: string) => {
    setSelectedSettingTags(prev =>
      prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
    );
  };

  const handleGenerate = async () => {
    setLoading(true);
    setError('');
    setProgress('Skapar din bok med AI... Detta kan ta 1-2 minuter.');

    const config: BookConfig = {
      title,
      bookFormat,
      numCharacters,
      characterNames: characterNames
        .split(',')
        .map(n => n.trim())
        .filter(Boolean),
      numPages,
      targetAge,
      textDensity,
      plot: [...selectedPlotTags, plotText].filter(Boolean).join('. '),
      setting: [...selectedSettingTags, setting].filter(Boolean).join(', '),
      imageStyle,
      subject: bookFormat === 'larobok' ? subject : undefined,
    };

    try {
      const res = await fetch('/api/generate-book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Generering misslyckades');
      }

      const { book, rawText } = await res.json();
      setProgress('Klar! Boken har skapats.');
      onBookCreated(book, rawText);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nagot gick fel');
    } finally {
      setLoading(false);
      setProgress('');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-800 mb-1">
            Skapa ny bok med AI
          </h2>
          <p className="text-gray-600">
            {currentStep === 1
              ? 'Steg 1: Grundinställningar - format, karaktärer och längd'
              : 'Steg 2: Handling, miljö och bildstil'}
          </p>
        </div>
        <button onClick={onBack} className="px-4 py-2 text-gray-500 hover:text-gray-700">
          Tillbaka
        </button>
      </div>

      {/* Step indicator */}
      <div className="flex gap-2">
        <div className={`flex-1 h-2 rounded-full ${currentStep >= 1 ? 'bg-blue-500' : 'bg-gray-200'}`} />
        <div className={`flex-1 h-2 rounded-full ${currentStep >= 2 ? 'bg-blue-500' : 'bg-gray-200'}`} />
      </div>

      {currentStep === 1 ? (
        <div className="space-y-6">
          {/* Title */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Titel *
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="T.ex. Stjärnpatrullen, Mattemonster, Äventyret i Skogen..."
              className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg text-lg
                         focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition-colors"
            />
          </div>

          {/* Book Format */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-3">
              Bokformat *
            </label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {FORMAT_OPTIONS.map((fmt) => (
                <button
                  key={fmt.value}
                  onClick={() => setBookFormat(fmt.value)}
                  className={`p-4 border-2 rounded-xl text-left transition-all ${
                    bookFormat === fmt.value
                      ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-200'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-2xl">{fmt.icon}</span>
                    <span className="font-semibold text-gray-800">{fmt.label}</span>
                  </div>
                  <p className="text-xs text-gray-500">{fmt.description}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Subject (for larobok) */}
          {bookFormat === 'larobok' && (
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Amne
              </label>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="T.ex. Matematik, Svenska, Naturkunskap..."
                className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg
                           focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
              />
            </div>
          )}

          {/* Target Age */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Malgrupp *
            </label>
            <div className="flex flex-wrap gap-2">
              {AGE_OPTIONS.map((age) => (
                <button
                  key={age}
                  onClick={() => setTargetAge(age)}
                  className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                    targetAge === age
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {age}
                </button>
              ))}
            </div>
          </div>

          {/* Text Density */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Textmangd per sida
            </label>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {getDensityOptions().map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setTextDensity(opt.value)}
                  className={`p-3 border-2 rounded-xl text-center transition-all ${
                    textDensity === opt.value
                      ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-200'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="font-semibold text-sm text-gray-800">{opt.label}</div>
                  <div className="text-xs text-gray-500">{opt.desc}</div>
                  <div className="text-xs text-blue-500 mt-1">{opt.words}</div>
                </button>
              ))}
            </div>
            <p className="text-xs text-gray-400 mt-2">
              Styr hur mycket text varje sida far. Anpassat efter valt bokformat ({FORMAT_OPTIONS.find(f => f.value === bookFormat)?.label}).
            </p>
          </div>

          {/* Characters */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Antal karaktarer
              </label>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={1}
                  max={10}
                  value={numCharacters}
                  onChange={(e) => setNumCharacters(parseInt(e.target.value))}
                  className="flex-1"
                />
                <span className="w-8 text-center font-bold text-blue-600 text-lg">{numCharacters}</span>
              </div>
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Namn pa karaktarerna
                <span className="text-gray-400 font-normal ml-1">(valfritt)</span>
              </label>
              <input
                type="text"
                value={characterNames}
                onChange={(e) => setCharacterNames(e.target.value)}
                placeholder="T.ex. Ella, Max, Saga (kommaseparerat)"
                className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg
                           focus:border-blue-500 focus:ring-2 focus:ring-blue-200 text-sm"
              />
              <p className="text-xs text-gray-400 mt-1">Lamna tomt for automatiska namn</p>
            </div>
          </div>

          {/* Pages */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Antal sidor
            </label>
            <div className="flex flex-wrap gap-2 mb-3">
              {PAGE_PRESETS.map((preset) => (
                <button
                  key={preset.pages}
                  onClick={() => setNumPages(preset.pages)}
                  className={`px-4 py-2 rounded-lg text-sm transition-colors ${
                    numPages === preset.pages
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-500">Eget antal:</span>
              <input
                type="number"
                min={8}
                max={200}
                step={2}
                value={numPages}
                onChange={(e) => setNumPages(parseInt(e.target.value) || 24)}
                className="w-20 px-3 py-2 border-2 border-gray-300 rounded-lg text-center
                           focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
              />
              <span className="text-sm text-gray-500">sidor</span>
            </div>
            <div className="mt-2 p-3 bg-gray-50 rounded-lg">
              <p className="text-sm text-gray-600">
                <span className="font-medium">{Math.ceil(numPages / 2)} uppslag</span>
                {' · '}
                <span>~{estimatedWords().toLocaleString()} ord</span>
                {' · '}
                <span>~{(estimatedWords() * 5.5).toLocaleString()} tecken</span>
              </p>
            </div>
          </div>

          {/* Next button */}
          <button
            onClick={() => setCurrentStep(2)}
            disabled={!title.trim()}
            className="w-full px-8 py-3 bg-blue-600 text-white font-semibold rounded-lg
                       hover:bg-blue-700 disabled:bg-gray-400 transition-colors text-lg"
          >
            Nasta: Handling & stil →
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Plot/Story */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Handling / Tema
            </label>
            <div className="flex flex-wrap gap-2 mb-3">
              {PLOT_TAGS.map((tag) => (
                <button
                  key={tag}
                  onClick={() => togglePlotTag(tag)}
                  className={`px-3 py-1.5 rounded-full text-sm transition-colors ${
                    selectedPlotTags.includes(tag)
                      ? 'bg-purple-600 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {tag}
                </button>
              ))}
            </div>
            <textarea
              value={plotText}
              onChange={(e) => setPlotText(e.target.value)}
              placeholder="Beskriv handlingen fritt... T.ex. 'Fyra barn som gar i skolan upptacker att de har magiska krafter. De maste samarbeta for att stoppa en mystisk skurk.'"
              className="w-full h-24 p-3 border-2 border-gray-300 rounded-lg text-sm
                         focus:border-blue-500 focus:ring-2 focus:ring-blue-200 resize-y"
            />
          </div>

          {/* Setting */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Miljo
            </label>
            <div className="flex flex-wrap gap-2 mb-3">
              {SETTING_TAGS.map((tag) => (
                <button
                  key={tag}
                  onClick={() => toggleSettingTag(tag)}
                  className={`px-3 py-1.5 rounded-full text-sm transition-colors ${
                    selectedSettingTags.includes(tag)
                      ? 'bg-green-600 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {tag}
                </button>
              ))}
            </div>
            <input
              type="text"
              value={setting}
              onChange={(e) => setSetting(e.target.value)}
              placeholder="Beskriv miljon mer detaljerat... T.ex. 'Liten svensk stad vid kusten, gammal skola fran 1800-talet'"
              className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg text-sm
                         focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
            />
          </div>

          {/* Image Style */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Bildstil
            </label>
            <textarea
              value={imageStyle}
              onChange={(e) => setImageStyle(e.target.value)}
              placeholder="Beskriv hur bilderna ska se ut..."
              className="w-full h-20 p-3 border-2 border-gray-300 rounded-lg text-sm
                         focus:border-blue-500 focus:ring-2 focus:ring-blue-200 resize-y"
            />
            <div className="flex flex-wrap gap-2 mt-2">
              {[
                { label: 'Handbok for Superhjaltar', value: 'Farggrant, manga/comic-stil med stora uttrycksfulla ogon, tjocka konturer, detaljerade bakgrunder, skandinavisk estetik. Liknande "Handbok for Superhjaltar".' },
                { label: 'Akvarellstil', value: 'Mjuk akvarellstil med pasteller, drommande atmosfar, fina detaljer och naturliga toner.' },
                { label: 'Tecknad/Disney', value: 'Tecknad stil liknande moderna Disney/Pixar-filmer, varm belysning, uttrycksfulla karaktarer, detaljerade miljoer.' },
                { label: 'Minimalistisk', value: 'Enkel, minimalistisk stil med platta farger, geometriska former och mycket vitt utrymme.' },
              ].map((style) => (
                <button
                  key={style.label}
                  onClick={() => setImageStyle(style.value)}
                  className={`px-3 py-1.5 rounded-full text-xs transition-colors ${
                    imageStyle === style.value
                      ? 'bg-orange-600 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {style.label}
                </button>
              ))}
            </div>
          </div>

          {/* Summary */}
          <div className="p-4 bg-blue-50 rounded-xl border border-blue-100">
            <h4 className="font-semibold text-blue-800 mb-2">Sammanfattning</h4>
            <div className="grid grid-cols-2 gap-2 text-sm text-blue-700">
              <div><span className="font-medium">Titel:</span> {title}</div>
              <div><span className="font-medium">Format:</span> {FORMAT_OPTIONS.find(f => f.value === bookFormat)?.label}</div>
              <div><span className="font-medium">Sidor:</span> {numPages} ({Math.ceil(numPages / 2)} uppslag)</div>
              <div><span className="font-medium">Karaktarer:</span> {numCharacters}</div>
              <div><span className="font-medium">Alder:</span> {targetAge}</div>
              <div><span className="font-medium">~Ord:</span> {estimatedWords().toLocaleString()}</div>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
              {error}
            </div>
          )}

          {/* Progress */}
          {progress && (
            <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg text-blue-700 flex items-center gap-3">
              <svg className="animate-spin h-5 w-5 text-blue-600" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              {progress}
            </div>
          )}

          {/* Buttons */}
          <div className="flex gap-3">
            <button
              onClick={() => setCurrentStep(1)}
              disabled={loading}
              className="px-6 py-3 bg-gray-200 text-gray-700 font-semibold rounded-lg
                         hover:bg-gray-300 disabled:opacity-50 transition-colors"
            >
              ← Tillbaka
            </button>
            <button
              onClick={handleGenerate}
              disabled={loading || !title.trim()}
              className="flex-1 px-8 py-3 bg-green-600 text-white font-semibold rounded-lg
                         hover:bg-green-700 disabled:bg-gray-400 transition-colors text-lg
                         flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Skapar boken...
                </>
              ) : (
                <>✨ Skapa boken med AI</>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
