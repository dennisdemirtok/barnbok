'use client';

import { useState } from 'react';
import { BookProject } from '@/lib/types';
import { BookConfig, TextDensity } from '@/lib/claude';
import Icon from './Icon';

interface Props {
  onBookCreated: (book: BookProject, rawText: string) => void;
  onBack: () => void;
}

type BookFormat = BookConfig['bookFormat'];

const FORMAT_OPTIONS: { value: BookFormat; label: string; description: string; icon: string; comingSoon?: boolean }[] = [
  {
    value: 'bildbok-text-pa-bild',
    label: 'Bildbok med text pa bild',
    description: 'Likt "Handbok för Superhjältar" - helsides illustrationer med text integrerad i bilden. Kort text, mycket visuellt.',
    icon: '🦸',
  },
  {
    value: 'bildbok-separat-text',
    label: 'Bildbok med separat text',
    description: 'Likt "Luna"-böcker - text ovanför/under eller bredvid bilderna. Mer text, bild och text kompletterar varandra.',
    icon: '🌙',
    comingSoon: true,
  },
  {
    value: 'kapitelbok',
    label: 'Kapitelbok',
    description: 'Likt Harry Potter / Bert-böcker - mest text med enstaka illustrationer. Längre kapitel och detaljerat berättande.',
    icon: '📖',
    comingSoon: true,
  },
  {
    value: 'larobok',
    label: 'Lärobok / Aktivitetsbok',
    description: 'Likt "Artan, Partan" - blandning av text, bilder och uppgifter. Pedagogiskt upplag.',
    icon: '📐',
    comingSoon: true,
  },
];

const PLOT_TAGS = [
  'Aventyr', 'Drama', 'Komedi', 'Mysterium', 'Fantasy', 'Sci-fi',
  'Vanskap', 'Skola', 'Familj', 'Djur', 'Natur', 'Sport',
  'Superhjältar', 'Magi', 'Rymden', 'Pirater', 'Dinosaurier',
];

const SETTING_TAGS = [
  'Skola', 'Hemma', 'Skog', 'Stad', 'Strand', 'Berg',
  'Rymden', 'Under vatten', 'Slott', 'Bondgard', 'Lekplats',
];

const AGE_OPTIONS = ['3-5 år', '6-8 år', '9-12 år', '12+ år'];

const PAGE_PRESETS = [
  { pages: 24, label: '24 sidor (kort bildbok)' },
  { pages: 32, label: '32 sidor (standard bildbok)' },
  { pages: 48, label: '48 sidor (längre bildbok)' },
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
  const [targetAge, setTargetAge] = useState('6-8 år');
  const [textDensity, setTextDensity] = useState<TextDensity>('medium');
  const [subject, setSubject] = useState('');

  // Step 2 fields
  const [plotText, setPlotText] = useState('');
  const [selectedPlotTags, setSelectedPlotTags] = useState<string[]>([]);
  const [setting, setSetting] = useState('');
  const [selectedSettingTags, setSelectedSettingTags] = useState<string[]>([]);
  const [imageStyle, setImageStyle] = useState('Färgglatt, manga/comic-stil med stora uttrycksfulla ögon, tjocka konturer, detaljerade bakgrunder, skandinavisk estetik');
  const [styleSeries, setStyleSeries] = useState<string | undefined>(undefined);

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

  // Tryckkonvention: sida 1-5 är titelsida/copyright, sista sidan är slutsidan.
  // Innehållsuppslagen ligger däremellan (samma formel som i claude.ts).
  const contentSpreads = () => Math.max(1, Math.floor((numPages - 6) / 2));

  const estimatedWords = () => {
    return Math.round(contentSpreads() * getWordsPerSpread());
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
        { value: 'lite', label: 'Lite', desc: 'Tydliga förklaringar', words: '60-100 ord/sida' },
        { value: 'medium', label: 'Medium', desc: 'Utförliga övningar', words: '100-150 ord/sida' },
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
      styleSeries,
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
      setError(err instanceof Error ? err.message : 'Något gick fel');
    } finally {
      setLoading(false);
      setProgress('');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-heading font-bold text-brand mb-1">
            Skapa ny bok med AI
          </h2>
          <p className="text-gray-600">
            {currentStep === 1
              ? 'Steg 1: Grundinställningar - format, karaktärer och längd'
              : 'Steg 2: Handling, miljö och bildstil'}
          </p>
        </div>
        <button onClick={onBack} className="btn-ghost">
          Tillbaka
        </button>
      </div>

      {/* Step indicator */}
      <div className="flex gap-2">
        <div className={`flex-1 h-2 rounded-full transition-all ${currentStep >= 1 ? 'bg-gradient-to-r from-brand to-magic' : 'bg-brand/10'}`} />
        <div className={`flex-1 h-2 rounded-full transition-all ${currentStep >= 2 ? 'bg-gradient-to-r from-brand to-magic' : 'bg-brand/10'}`} />
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
              className="field text-lg"
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
                  onClick={() => !fmt.comingSoon && setBookFormat(fmt.value)}
                  disabled={fmt.comingSoon}
                  className={`relative p-4 rounded-4xl text-left transition-all ${
                    fmt.comingSoon
                      ? 'bg-gray-100/70 border border-gray-200 opacity-60 cursor-not-allowed'
                      : bookFormat === fmt.value
                      ? 'card-glass ring-2 ring-brand bg-gradient-to-br from-brand/10 to-magic/10'
                      : 'card-glass'
                  }`}
                >
                  {fmt.comingSoon && (
                    <span className="absolute top-2 right-2 px-2 py-0.5 bg-gradient-to-r from-sunset to-amber-400 text-white
                                     text-xs font-semibold rounded-full shadow-glow">
                      Kommer snart
                    </span>
                  )}
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-2xl">{fmt.icon}</span>
                    <span className={`font-heading font-semibold ${fmt.comingSoon ? 'text-gray-500' : 'text-brand'}`}>{fmt.label}</span>
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
                Ämne
              </label>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="T.ex. Matematik, Svenska, Naturkunskap..."
                className="field"
              />
            </div>
          )}

          {/* Target Age */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Målgrupp *
            </label>
            <div className="flex flex-wrap gap-2">
              {AGE_OPTIONS.map((age) => (
                <button
                  key={age}
                  onClick={() => setTargetAge(age)}
                  className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
                    targetAge === age
                      ? 'bg-gradient-to-r from-brand to-magic text-white shadow-glow'
                      : 'glass text-brand hover:shadow-glow'
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
              Textmängd per sida
            </label>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {getDensityOptions().map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setTextDensity(opt.value)}
                  className={`p-3 rounded-2xl text-center transition-all ${
                    textDensity === opt.value
                      ? 'card-glass ring-2 ring-brand bg-gradient-to-br from-brand/10 to-magic/10'
                      : 'card-glass'
                  }`}
                >
                  <div className="font-heading font-semibold text-sm text-brand">{opt.label}</div>
                  <div className="text-xs text-gray-500">{opt.desc}</div>
                  <div className="text-xs text-magic mt-1">{opt.words}</div>
                </button>
              ))}
            </div>
            <p className="text-xs text-gray-400 mt-2">
              Styr hur mycket text varje sida får. Anpassat efter valt bokformat ({FORMAT_OPTIONS.find(f => f.value === bookFormat)?.label}).
            </p>
          </div>

          {/* Characters */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Antal karaktärer
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
                <span className="w-8 text-center font-heading font-bold text-brand text-lg">{numCharacters}</span>
              </div>
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Namn på karaktärerna
                <span className="text-gray-400 font-normal ml-1">(valfritt)</span>
              </label>
              <input
                type="text"
                value={characterNames}
                onChange={(e) => setCharacterNames(e.target.value)}
                placeholder="T.ex. Ella, Max, Saga (kommaseparerat)"
                className="field py-2 text-sm"
              />
              <p className="text-xs text-gray-400 mt-1">Lämna tomt för automatiska namn</p>
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
                  className={`px-4 py-2 rounded-full text-sm transition-all ${
                    numPages === preset.pages
                      ? 'bg-gradient-to-r from-brand to-magic text-white shadow-glow'
                      : 'glass text-brand hover:shadow-glow'
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
                className="field w-20 px-3 py-2 text-center"
              />
              <span className="text-sm text-gray-500">sidor</span>
            </div>
            <div className="mt-2 glass rounded-2xl p-3">
              <p className="text-sm text-gray-600">
                <span className="font-medium">{contentSpreads()} uppslag + omslag + slutsida</span>
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
            className="btn-primary w-full text-lg"
          >
            Nästa: Handling & stil →
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
                  className={`px-3 py-1.5 rounded-full text-sm transition-all ${
                    selectedPlotTags.includes(tag)
                      ? 'bg-gradient-to-r from-brand to-magic text-white shadow-glow'
                      : 'magic-chip hover:shadow-glow'
                  }`}
                >
                  {tag}
                </button>
              ))}
            </div>
            <textarea
              value={plotText}
              onChange={(e) => setPlotText(e.target.value)}
              placeholder="Beskriv handlingen fritt... T.ex. 'Fyra barn som går i skolan upptäcker att de har magiska krafter. De måste samarbeta för att stoppa en mystisk skurk.'"
              className="field h-24 text-sm resize-y"
            />
          </div>

          {/* Setting */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Miljö
            </label>
            <div className="flex flex-wrap gap-2 mb-3">
              {SETTING_TAGS.map((tag) => (
                <button
                  key={tag}
                  onClick={() => toggleSettingTag(tag)}
                  className={`px-3 py-1.5 rounded-full text-sm transition-all ${
                    selectedSettingTags.includes(tag)
                      ? 'bg-gradient-to-r from-brand to-magic text-white shadow-glow'
                      : 'magic-chip hover:shadow-glow'
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
              placeholder="Beskriv miljön mer detaljerat... T.ex. 'Liten svensk stad vid kusten, gammal skola från 1800-talet'"
              className="field py-2 text-sm"
            />
          </div>

          {/* Image Style */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Bildstil
            </label>
            <textarea
              value={imageStyle}
              onChange={(e) => { setImageStyle(e.target.value); setStyleSeries(undefined); }}
              placeholder="Beskriv hur bilderna ska se ut..."
              className="field h-20 text-sm resize-y"
            />
            <div className="flex flex-wrap gap-2 mt-2">
              {[
                { label: 'Handbok för Superhjältar', series: 'Handbok for Superhjaltar', value: 'Färgglatt, manga/comic-stil med stora uttrycksfulla ögon, tjocka konturer, detaljerade bakgrunder, skandinavisk estetik. Liknande "Handbok för Superhjältar".' },
                { label: 'Mamma Mu (akvarell)', series: 'Mamma Mu', value: 'Klassisk skandinavisk tusch- och akvarellstil med fina svarta konturer, varma naturfärger och mjuka vinjetter mot vit bakgrund. Liknande "Mamma Mu".' },
                { label: 'Luna', series: 'Luna', value: 'Mjuk, varm skandinavisk bilderboksstil med fina konturer och dämpade färger. Liknande "Luna"-böckerna.' },
                { label: 'Tecknad/Disney', series: undefined, value: 'Tecknad stil liknande moderna Disney/Pixar-filmer, varm belysning, uttrycksfulla karaktärer, detaljerade miljöer.' },
                { label: 'Minimalistisk', series: undefined, value: 'Enkel, minimalistisk stil med platta färger, geometriska former och mycket vitt utrymme.' },
              ].map((style) => (
                <button
                  key={style.label}
                  onClick={() => { setImageStyle(style.value); setStyleSeries(style.series); }}
                  className={`px-3 py-1.5 rounded-full text-xs transition-all ${
                    imageStyle === style.value
                      ? 'bg-gradient-to-r from-sunset to-magic text-white shadow-glow'
                      : 'magic-chip hover:shadow-glow'
                  }`}
                >
                  <span className="inline-flex items-center gap-1">
                    {style.series && <Icon name="auto_awesome" filled size={13} />}{style.label}
                  </span>
                </button>
              ))}
            </div>
            {styleSeries && (
              <p className="text-xs text-brand mt-2 inline-flex items-start gap-1">
                <Icon name="auto_awesome" filled size={14} className="mt-0.5 shrink-0" />
                Stilprofil analyserad från riktiga böcker används - text och bild kalibreras automatiskt mot seriens stil.
              </p>
            )}
          </div>

          {/* Summary */}
          <div className="glass-strong rounded-4xl p-4">
            <h4 className="font-heading font-semibold text-brand mb-2">Sammanfattning</h4>
            <div className="grid grid-cols-2 gap-2 text-sm text-gray-700">
              <div><span className="font-medium">Titel:</span> {title}</div>
              <div><span className="font-medium">Format:</span> {FORMAT_OPTIONS.find(f => f.value === bookFormat)?.label}</div>
              <div><span className="font-medium">Sidor:</span> {numPages} ({contentSpreads()} uppslag + omslag + slutsida)</div>
              <div><span className="font-medium">Karaktärer:</span> {numCharacters}</div>
              <div><span className="font-medium">Ålder:</span> {targetAge}</div>
              <div><span className="font-medium">~Ord:</span> {estimatedWords().toLocaleString()}</div>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="glass rounded-2xl p-4 border-red-200 bg-red-50/80 text-red-700">
              {error}
            </div>
          )}

          {/* Progress */}
          {progress && (
            <div className="glass rounded-2xl p-4 text-brand flex items-center gap-3">
              <svg className="animate-spin h-5 w-5 text-brand" viewBox="0 0 24 24">
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
              className="btn-ghost disabled:opacity-50"
            >
              ← Tillbaka
            </button>
            <button
              onClick={handleGenerate}
              disabled={loading || !title.trim()}
              className="btn-action flex-1 text-lg disabled:opacity-50"
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
                <><Icon name="auto_awesome" filled size={20} /> Skapa boken med AI</>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
