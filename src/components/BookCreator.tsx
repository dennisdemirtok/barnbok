'use client';

import { useEffect, useState } from 'react';
import { STYLE_PRESETS, getStylePreset } from '@/lib/styles';
import Icon from './Icon';
import StepHeader from './StepHeader';
import StylePicker from './StylePicker';
import CharacterLibraryPicker from './CharacterLibraryPicker';
import { listSavedCharacters, listAuthorVoices } from '@/lib/storage';
import type { AuthorVoice } from '@/lib/author-types';

interface Props {
  onBeginningWritten: (result: {
    title: string;
    stylePresetId: string;
    targetAge: string;
    rawText: string;
    outline: string;
    imageWishes?: string;
    voice?: AuthorVoice;
  }) => void;
  onBack: () => void;
}

// Åldersval: vanliga spann plus de som boktyperna använder
const AGE_OPTIONS = Array.from(new Set(['2-5 år', '3-6 år', '6-9 år', '8-12 år', '12+ år', ...STYLE_PRESETS.map(s => s.book.age)]))
  .sort((a, b) => parseInt(a) - parseInt(b));

// Roterande lägesmeddelanden medan AI:n skriver (tar ca 30-60 s)
const WRITING_STAGES = [
  'Läser in boktypen och stilen...',
  'Planerar handlingen för hela boken...',
  'Lär känna karaktärerna...',
  'Skriver den första scenen...',
  'Putsar på språket...',
  'Nästan klart – de sista meningarna...',
];

// Början = ca fyra illustrerade sidor (samma formel som beginningWordTarget i lib/claude.ts)
function beginningWords(book: { targetWords: number; wordsPerImage: number }) {
  const words = Math.min(book.targetWords, book.wordsPerImage * 4);
  return words >= 500 ? Math.round(words / 50) * 50 : Math.round(words / 10) * 10;
}

export default function BookCreator({ onBeginningWritten, onBack }: Props) {
  const [stylePresetId, setStylePresetId] = useState('luna');
  const [plot, setPlot] = useState('');
  const [setting, setSetting] = useState('');
  const [title, setTitle] = useState('');
  const [characterNotes, setCharacterNotes] = useState('');
  const [libraryIds, setLibraryIds] = useState<string[]>([]); // sparade karaktärer som ska med
  const [chosenAge, setChosenAge] = useState<string | null>(null); // null = följ boktypen
  const [imageWishes, setImageWishes] = useState('');
  const [voices, setVoices] = useState<AuthorVoice[]>([]);
  const [voiceId, setVoiceId] = useState<string | null>(null); // null = boktypens stil

  // Senaste slumpade förslaget - används inte som ledtråd för nästa slumpning
  const [lastRandom, setLastRandom] = useState<{ plot: string; title: string } | null>(null);
  const [randomizing, setRandomizing] = useState(false);

  const [writing, setWriting] = useState(false);
  const [stage, setStage] = useState(0);
  const [error, setError] = useState('');

  // Sparade författarspråk från "Slutför din bok"
  useEffect(() => {
    listAuthorVoices()
      .then(setVoices)
      .catch(err => console.error('Kunde inte ladda författarspråk:', err));
  }, []);
  const voice = voices.find(v => v.id === voiceId);

  const preset = getStylePreset(stylePresetId) ?? STYLE_PRESETS[0];
  const targetAge = chosenAge ?? preset.book.age;
  const busy = writing || randomizing;

  useEffect(() => {
    if (!writing) return;
    setStage(0);
    const timer = setInterval(() => setStage(s => Math.min(s + 1, WRITING_STAGES.length - 1)), 8000);
    return () => clearInterval(timer);
  }, [writing]);

  const handleRandomPlot = async () => {
    setRandomizing(true);
    setError('');
    // Egen text blir ledtråd - ett tidigare slumpat förslag gör det inte
    const hint = plot.trim() && plot !== lastRandom?.plot ? plot.trim() : undefined;
    try {
      const res = await fetch('/api/random-plot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stylePresetId, targetAge, hint }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Kunde inte slumpa en handling');

      setPlot(data.plot);
      setSetting(data.setting || '');
      // Skriv inte över en titel som författaren själv har skrivit
      if (!title.trim() || title === lastRandom?.title) setTitle(data.title || '');
      setLastRandom({ plot: data.plot, title: data.title || '' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Något gick fel');
    } finally {
      setRandomizing(false);
    }
  };

  const handleWrite = async () => {
    setWriting(true);
    setError('');
    try {
      const saved = libraryIds.length > 0 ? await listSavedCharacters() : [];
      const characters = saved
        .filter(c => libraryIds.includes(c.id))
        .map(c => ({ name: c.name, appearance: [c.age && `${c.age}`, c.appearance, c.normalClothes].filter(Boolean).join('. '), personality: c.personality }));
      const res = await fetch('/api/write-beginning', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stylePresetId,
          targetAge,
          title: title.trim() || undefined,
          plot: plot.trim(),
          setting: setting.trim() || undefined,
          characterNotes: characterNotes.trim() || undefined,
          characters: characters.length > 0 ? characters : undefined,
          voice: voice ? { profile: voice.profile, samples: voice.samples } : undefined,
        }),
      });
      // Tidsgräns på servern kan ge ett svar som inte är JSON
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Det gick inte att skriva början – försök igen');

      onBeginningWritten({
        title: data.title,
        stylePresetId,
        targetAge,
        rawText: data.rawText,
        outline: data.outline,
        imageWishes: imageWishes.trim() || undefined,
        voice,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Något gick fel');
    } finally {
      setWriting(false);
    }
  };

  return (
    <div className="space-y-8">
      <StepHeader
        eyebrow="Steg 1 av 4 · Berättelsen"
        title="Skriv en bok med AI"
        description="Välj boktyp och berätta vad boken ska handla om. AI:n skriver först början, så att du kan läsa texten och prova bilderna innan hela boken skrivs."
        onBack={onBack}
      />

      {/* Boktyp - styr format, längd och skrivstil */}
      <section>
        <h3 className="text-sm font-semibold text-ink/80 mb-1">Boktyp</h3>
        <p className="text-xs text-ink/55 mb-3">Boktypen bestämmer bildstil, längd och hur texten låter.</p>
        <StylePicker value={stylePresetId} onChange={setStylePresetId} />
      </section>

      {/* Handling */}
      <section>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <label htmlFor="plot" className="text-sm font-semibold text-ink/80">Vad handlar boken om?</label>
          <button
            type="button"
            onClick={handleRandomPlot}
            disabled={busy}
            className="btn-ghost text-sm py-2"
            title={plot.trim() && plot !== lastRandom?.plot ? 'Bygger vidare på din text' : 'Hitta på en ny idé'}
          >
            {randomizing ? <span className="spinner w-4 h-4" /> : <Icon name="casino" size={18} />}
            Slumpa handling
          </button>
        </div>
        <textarea
          id="plot"
          value={plot}
          onChange={(e) => setPlot(e.target.value)}
          placeholder="T.ex. Otis hittar en liten drake i mormors vedbod och måste gömma den för hela byn. Eller skriv några ord – ”drakar och vänskap” – och tryck på Slumpa handling."
          className="field h-28 text-sm resize-y"
          disabled={writing}
        />
        {setting && (
          <p className="mt-2 flex items-start gap-1.5 text-xs text-ink/55">
            <Icon name="location_on" size={16} />
            <span className="flex-1">Miljö: {setting}</span>
            <button type="button" onClick={() => setSetting('')} className="text-ink/40 hover:text-ink" aria-label="Ta bort miljön">
              <Icon name="close" size={16} />
            </button>
          </p>
        )}
      </section>

      {/* Titel */}
      <section>
        <label htmlFor="title" className="block text-sm font-semibold text-ink/80 mb-2">
          Titel <span className="font-normal text-ink/40">(valfritt – AI:n föreslår en annars)</span>
        </label>
        <input
          id="title"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="T.ex. Draken i vedboden"
          className="field"
          disabled={writing}
        />
      </section>

      {/* Karaktärer */}
      <section>
        <label htmlFor="characters" className="block text-sm font-semibold text-ink/80 mb-1">
          Karaktärer <span className="font-normal text-ink/40">(valfritt)</span>
        </label>
        <p className="text-xs text-ink/55 mb-2">Välj bland dina sparade karaktärer eller beskriv nya. AI:n lägger till fler när berättelsen behöver det.</p>
        <div className="mb-3">
          <CharacterLibraryPicker selectedIds={libraryIds} onChange={setLibraryIds} />
        </div>
        <textarea
          id="characters"
          value={characterNotes}
          onChange={(e) => setCharacterNotes(e.target.value)}
          placeholder="Namn och kort beskrivning, t.ex. Otis 8 år – nyfiken och lite rädd för mörker"
          className="field h-20 text-sm resize-y"
          disabled={writing}
        />
      </section>

      {/* Ålder - följer boktypen tills författaren väljer själv */}
      <section>
        <h3 className="text-sm font-semibold text-ink/80 mb-2">Ålder</h3>
        <div className="flex flex-wrap gap-2">
          {AGE_OPTIONS.map((age) => (
            <button
              key={age}
              type="button"
              onClick={() => setChosenAge(age)}
              className={targetAge === age ? 'chip-on' : 'chip'}
            >
              {age}
            </button>
          ))}
        </div>
      </section>

      {/* Författarspråk - bara om det finns sparade */}
      {voices.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold text-ink/80 mb-1">Skriv i mitt författarspråk <span className="font-normal text-ink/40">(valfritt)</span></h3>
          <p className="text-xs text-ink/55 mb-3">Välj ett språk du har sparat så låter texten som du i stället för boktypens stil.</p>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Författarspråk">
            <button
              type="button"
              role="radio"
              aria-checked={!voice}
              onClick={() => setVoiceId(null)}
              className={!voice ? 'chip-on' : 'chip'}
              disabled={writing}
            >
              Boktypens stil
            </button>
            {voices.map(v => (
              <button
                key={v.id}
                type="button"
                role="radio"
                aria-checked={voice?.id === v.id}
                onClick={() => setVoiceId(v.id)}
                className={voice?.id === v.id ? 'chip-on' : 'chip'}
                disabled={writing}
              >
                <Icon name="record_voice_over" size={17} /> <span className="max-w-[14rem] truncate">{v.name}</span>
              </button>
            ))}
          </div>
          {voice?.profile?.summary && (
            <p className="mt-2 rounded-2xl bg-paper border border-line p-3 text-xs text-ink/65 leading-relaxed">{voice.profile.summary}</p>
          )}
        </section>
      )}

      {/* Bildönskemål */}
      <section>
        <label htmlFor="imageWishes" className="block text-sm font-semibold text-ink/80 mb-2">
          Egna önskemål om bilderna <span className="font-normal text-ink/40">(valfritt)</span>
        </label>
        <textarea
          id="imageWishes"
          value={imageWishes}
          onChange={(e) => setImageWishes(e.target.value)}
          placeholder="T.ex. höstiga färger, mycket kvällsljus, Otis har alltid sin gröna mössa..."
          className="field h-20 text-sm resize-y"
          disabled={writing}
        />
      </section>

      {/* Sammanfattning + skriv */}
      <div className="space-y-3">
        <p className="rounded-2xl bg-paper border border-line p-3 text-sm text-ink/65">
          <span className="font-medium text-ink">{preset.label}</span>
          {' · '}{preset.book.lengthLabel}
          {voice && <>{' · '}i ditt språk ({voice.name})</>}
          {' · '}AI skriver först början (ca {beginningWords(preset.book).toLocaleString('sv-SE')} ord) så att du kan prova bilderna
        </p>

        {error && <div className="note-error">{error}</div>}

        {writing && (
          <div className="rounded-2xl bg-brand/5 border border-brand/15 p-4 text-brand flex items-center gap-3" role="status">
            <span className="spinner shrink-0" />
            <span>
              {WRITING_STAGES[stage]}
              <span className="block text-xs text-brand/70 mt-0.5">Det brukar ta 30–60 sekunder.</span>
            </span>
          </div>
        )}

        <button
          type="button"
          onClick={handleWrite}
          disabled={busy || !plot.trim()}
          className="btn-primary w-full text-lg"
        >
          {writing ? (
            <><span className="spinner" /> Skriver början...</>
          ) : (
            <><Icon name="auto_awesome" filled size={20} /> Skriv början av boken</>
          )}
        </button>
        {!plot.trim() && !busy && (
          <p className="text-xs text-ink/45 text-center">Beskriv handlingen eller tryck på Slumpa handling för att börja.</p>
        )}
      </div>
    </div>
  );
}
