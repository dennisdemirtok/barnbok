'use client';

import { useEffect, useState } from 'react';
import { BookProject, BookFormat, SavedText } from '@/lib/types';
import { saveText, listSavedCharacters } from '@/lib/storage';
import { STYLE_PRESETS, getStylePreset, composeStyleGuide } from '@/lib/styles';
import BookCreator from './BookCreator';
import SavedTextPicker from './SavedTextPicker';
import StyleTester from './StyleTester';
import StylePicker from './StylePicker';
import Icon from './Icon';
import StepHeader from './StepHeader';
import { postJson } from '@/lib/fetch-json';
import type { AuthorVoice } from '@/lib/author-types';

export type ImportMode = 'choose' | 'import' | 'create' | 'savedTexts' | 'styleTest';

// Allt som hör till berättelsen innan boken skapas - lyft till page.tsx så att
// inget försvinner när man går fram och tillbaka mellan stegen
export interface ManuscriptDraft {
  rawText: string;
  title: string;
  author: string;
  stylePresetId: string;
  targetAge?: string;
  imageWishes: string;
  // Från AI:n: disposition för hela boken, så att resten kan skrivas efter början
  outline?: string;
  restWritten?: boolean;
  // Bokverktygets gamla strukturerade format (SIDA/BILDPROMPT) kan ange eget format
  legacyFormat?: BookFormat;
  // Författarspråk som AI:n skriver i (från AI-skrivaren)
  voice?: AuthorVoice;
  notice?: string;
}

export const EMPTY_DRAFT: ManuscriptDraft = {
  rawText: '',
  title: '',
  author: '',
  stylePresetId: 'luna',
  imageWishes: '',
};

interface Props {
  onBookParsed: (book: BookProject) => void;
  draft: ManuscriptDraft;
  onDraftChange: (draft: ManuscriptDraft) => void;
  mode: ImportMode;
  onModeChange: (mode: ImportMode) => void;
  parsedBook: BookProject | null;
  onParsedBookChange: (book: BookProject | null) => void;
}

const LEGACY_FORMATS: { value: BookFormat; label: string }[] = [
  { value: 'bildbok-text-pa-bild', label: 'Serieformat – text i bilderna' },
  { value: 'bildbok-separat-text', label: 'Bilderbok' },
  { value: 'kapitelbok', label: 'Kapitelbok' },
];

const PLAN_STAGES = [
  'Läser manuset...',
  'Hittar karaktärerna och hur de ser ut...',
  'Delar upp texten i sidor och uppslag...',
  'Väljer de mest bildstarka ögonblicken...',
  'Skriver bildbeskrivningar...',
  'Sätter ihop boken...',
];

const CONTINUE_STAGES = [
  'Läser början och dispositionen...',
  'Skriver nästa kapitel...',
  'Följer upp trådarna i berättelsen...',
  'Skriver mot slutet...',
  'Läser igenom och knyter ihop...',
];

// Texter i bokverktygets strukturerade format delas upp lokalt i stället för av AI:n
function isStructuredText(text: string): boolean {
  return /^\s*\**\s*(SIDA|UPPSLAG)\s+\d+/im.test(text) && /BILDPROMPT/i.test(text);
}

// Karaktärer med samma namn som en sparad karaktär får dess utseende och referensbild
async function attachSavedCharacters(book: BookProject): Promise<BookProject> {
  const saved = await listSavedCharacters().catch(() => []);
  if (saved.length === 0) return book;
  const byName = new Map(saved.map(c => [c.name.trim().toLowerCase(), c]));
  return {
    ...book,
    characters: book.characters.map(c => {
      const match = byName.get(c.name.trim().toLowerCase());
      if (!match) return c;
      return {
        ...c,
        age: match.age || c.age,
        appearance: match.appearance || c.appearance,
        normalClothes: match.normalClothes || c.normalClothes,
        heroName: match.heroName || c.heroName,
        heroCostume: match.heroCostume || c.heroCostume,
        power: match.power || c.power,
        personality: match.personality || c.personality,
        referenceImage: match.referenceImage || c.referenceImage,
      };
    }),
  };
}

function countWords(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

function useStages(active: boolean, stages: string[], ms = 9000): string {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (!active) { setI(0); return; }
    const t = setInterval(() => setI(n => Math.min(n + 1, stages.length - 1)), ms);
    return () => clearInterval(t);
  }, [active, stages, ms]);
  return stages[i];
}

export default function BookImporter({
  onBookParsed,
  draft,
  onDraftChange,
  mode,
  onModeChange,
  parsedBook,
  onParsedBookChange,
}: Props) {
  const [planning, setPlanning] = useState(false);
  const [continuing, setContinuing] = useState(false);
  const [error, setError] = useState('');
  const [textSaved, setTextSaved] = useState(false);
  const planStage = useStages(planning, PLAN_STAGES);
  const continueStage = useStages(continuing, CONTINUE_STAGES, 20000);

  const update = (patch: Partial<ManuscriptDraft>) => onDraftChange({ ...draft, notice: undefined, ...patch });
  const preset = getStylePreset(draft.stylePresetId) ?? STYLE_PRESETS[0];
  const words = countWords(draft.rawText);
  const structured = isStructuredText(draft.rawText);

  const handleSaveText = async () => {
    if (!draft.rawText.trim()) return;
    try {
      const entry: SavedText = {
        id: `text-${Date.now()}`,
        title: parsedBook?.title || draft.title || 'Namnlös text',
        rawText: draft.rawText,
        bookFormat: parsedBook?.bookFormat,
        author: draft.author || undefined,
        stylePresetId: draft.stylePresetId,
        characterCount: parsedBook?.characters.length ?? 0,
        spreadCount: parsedBook?.spreads.length ?? 0,
        savedAt: new Date().toISOString(),
      };
      await saveText(entry);
      setTextSaved(true);
      setTimeout(() => setTextSaved(false), 3000);
    } catch {
      setError('Kunde inte spara texten');
    }
  };

  const handleTextSelected = (text: SavedText) => {
    onParsedBookChange(null);
    onDraftChange({
      ...EMPTY_DRAFT,
      rawText: text.rawText,
      title: text.title === 'Namnlös text' ? '' : text.title,
      author: text.author ?? '',
      stylePresetId: text.stylePresetId ?? EMPTY_DRAFT.stylePresetId,
      legacyFormat: text.bookFormat,
    });
    onModeChange('import');
  };

  // ── Skapa boken av texten ──
  const handleCreateBook = async () => {
    if (!draft.rawText.trim()) {
      setError('Klistra in din text först');
      return;
    }
    setPlanning(true);
    setError('');
    try {
      let book: BookProject;
      if (structured) {
        // Strukturerad text: dela upp lokalt och lägg på vald stil
        const res = await fetch('/api/parse-book', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rawText: draft.rawText }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Kunde inte läsa texten');
        const format = draft.legacyFormat ?? preset.book.format;
        book = {
          ...data,
          title: draft.title.trim() || data.title,
          author: draft.author.trim() || undefined,
          targetAge: draft.targetAge ?? preset.book.age,
          bookFormat: format,
          stylePresetId: preset.id,
          illustrationShape: format === 'bildbok-separat-text' || format === 'kapitelbok' ? preset.shape : undefined,
          styleGuide: composeStyleGuide(preset)
            + (draft.imageWishes.trim() ? `\n\nADDITIONAL WISHES FROM THE AUTHOR: ${draft.imageWishes.trim()}` : ''),
        };
      } else {
        const { ok, data } = await postJson<{ book: BookProject }>('/api/plan-book', {
            rawText: draft.rawText,
            title: draft.title,
            author: draft.author,
            stylePresetId: preset.id,
            imageWishes: draft.imageWishes,
            targetAge: draft.targetAge,
          });
        if (!ok) throw new Error(data.error || 'Kunde inte skapa boken');
        book = data.book;
      }
      onParsedBookChange(await attachSavedCharacters(book));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Något gick fel');
    } finally {
      setPlanning(false);
    }
  };

  // ── AI: skriv resten av boken efter början ──
  const handleContinue = async () => {
    if (!draft.outline) return;
    setContinuing(true);
    setError('');
    try {
      const res = await fetch('/api/continue-book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stylePresetId: preset.id,
          targetAge: draft.targetAge ?? preset.book.age,
          title: draft.title,
          outline: draft.outline,
          rawText: draft.rawText,
          voice: draft.voice ? { profile: draft.voice.profile, samples: draft.voice.samples } : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Kunde inte skriva resten av boken');
      onDraftChange({
        ...draft,
        rawText: `${draft.rawText.trimEnd()}\n\n${String(data.rawText).trim()}`,
        // Blev texten avbruten kan AI:n fortsätta där den slutade
        restWritten: !data.truncated,
        notice: data.truncated
          ? 'AI:n hann inte skriva klart hela boken. Klicka "Skriv resten av boken" igen så fortsätter den där den slutade.'
          : 'Resten av boken är skriven. Läs igenom och ändra fritt – sedan skapar du boken.',
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Något gick fel');
    } finally {
      setContinuing(false);
    }
  };

  // ════════════════════════════════════════════════════════
  //  Välj väg
  // ════════════════════════════════════════════════════════
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
              text: 'Beskriv idén eller slumpa fram en handling. AI:n skriver först början, så att du kan prova bilderna innan resten skrivs.',
              cta: 'Kom igång',
              accent: true,
            },
            {
              mode: 'import' as const,
              icon: 'content_paste',
              title: 'Använd din egen text',
              text: 'Klistra in manuset som det är – prolog, kapitel och repliker. AI:n delar upp det i sidor och hittar karaktärerna.',
              cta: 'Klistra in text',
            },
            {
              mode: 'savedTexts' as const,
              icon: 'bookmarks',
              title: 'Sparade texter',
              text: 'Återanvänd en text du sparat tidigare – till exempel i en annan stil.',
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
                Klistra in början av manuset. Du får omslag och testsidor i flera boktyper – lika mycket text per sida som
                i den riktiga boken – och väljer sedan vilken väg boken ska ta.
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

  // ════════════════════════════════════════════════════════
  //  Stilprovning
  // ════════════════════════════════════════════════════════
  if (mode === 'styleTest') {
    const seeded = draft.rawText.trim().length > 0;
    return (
      <StyleTester
        initial={seeded ? {
          rawText: draft.rawText,
          title: draft.title,
          styles: Array.from(new Set([draft.stylePresetId, ...(draft.outline ? [] : ['luna', 'knyckertz', 'mammamu'])])),
          note: draft.outline
            ? 'AI:n har skrivit början av boken. Skapa testbilder för att se hur den blir – lägg gärna till fler stilar att jämföra.'
            : undefined,
        } : undefined}
        onChooseStyle={choice => {
          // Behåll ett längre manus om provningen bara gjordes på början av det
          const keepDraftText = draft.rawText.includes(choice.rawText.trim().slice(0, 200));
          onDraftChange({
            ...draft,
            stylePresetId: choice.stylePresetId,
            title: draft.title || choice.title,
            rawText: keepDraftText ? draft.rawText : choice.rawText,
            notice: `Stilen ${getStylePreset(choice.stylePresetId)?.label} är vald. ${
              draft.outline && !draft.restWritten
                ? 'Nu kan AI:n skriva resten av boken.'
                : 'Har du bara provat början – klistra in resten av manuset innan du skapar boken.'
            }`,
          });
          onModeChange('import');
        }}
        onBack={() => onModeChange(seeded ? 'import' : 'choose')}
      />
    );
  }

  if (mode === 'savedTexts') {
    return (
      <SavedTextPicker
        onTextSelected={handleTextSelected}
        onBack={() => onModeChange('choose')}
      />
    );
  }

  if (mode === 'create') {
    return (
      <BookCreator
        onBeginningWritten={result => {
          onParsedBookChange(null);
          onDraftChange({
            ...EMPTY_DRAFT,
            rawText: result.rawText,
            title: result.title,
            stylePresetId: result.stylePresetId,
            targetAge: result.targetAge,
            imageWishes: result.imageWishes ?? '',
            outline: result.outline,
            voice: result.voice,
            notice: 'Början av boken är skriven. Läs och ändra fritt, prova bilderna – och låt sedan AI:n skriva resten.',
          });
          onModeChange('import');
        }}
        onBack={() => onModeChange('choose')}
      />
    );
  }

  // ════════════════════════════════════════════════════════
  //  Resultat: boken är uppdelad
  // ════════════════════════════════════════════════════════
  if (parsedBook) {
    const pagesWithText = parsedBook.spreads.filter(s => s.pages !== 'omslag');
    const bookPreset = getStylePreset(parsedBook.stylePresetId);
    const empty = pagesWithText.length === 0;
    return (
      <div className="space-y-6">
        <StepHeader
          eyebrow="Steg 1 av 4 · Berättelsen"
          title="Boken är uppdelad"
          description="Kontrollera sidorna och karaktärerna. Nästa steg skapar karaktärsbilderna."
          onBack={() => onParsedBookChange(null)}
          backLabel="Ändra texten"
        />

        <div className="card-glass hover:!shadow-soft p-5 sm:p-6 space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <h3 className="text-2xl font-heading font-bold text-ink">{parsedBook.title}</h3>
              <p className="text-sm text-ink/55 mt-0.5">
                {[parsedBook.author && `av ${parsedBook.author}`, bookPreset?.label, bookPreset?.book.format === 'kapitelbok' ? 'Kapitelbok' : 'Bilderbok', parsedBook.targetAge]
                  .filter(Boolean).join(' · ')}
              </p>
            </div>
            <div className="flex gap-2 text-center">
              <div className="rounded-2xl bg-paper border border-line px-4 py-2">
                <p className="text-xl font-bold text-ink">{pagesWithText.length}</p>
                <p className="text-[11px] text-ink/50">{pagesWithText.length === 1 ? 'bild' : 'bilder'} + omslag</p>
              </div>
              <div className="rounded-2xl bg-paper border border-line px-4 py-2">
                <p className="text-xl font-bold text-ink">{parsedBook.characters.length}</p>
                <p className="text-[11px] text-ink/50">karaktärer</p>
              </div>
            </div>
          </div>

          {empty && (
            <div className="note-warning">
              Inga sidor hittades i texten. Gå tillbaka och kontrollera texten, eller prova igen.
            </div>
          )}

          {parsedBook.characters.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {parsedBook.characters.map(c => (
                <span key={c.id} className="magic-chip" title={c.appearance}>
                  <Icon name={c.role === 'main' ? 'star' : 'person'} filled size={13} />
                  {c.name}{c.age ? `, ${c.age}` : ''}
                </span>
              ))}
            </div>
          )}

          {!empty && (
            <ol className="max-h-80 overflow-y-auto divide-y divide-line rounded-2xl border border-line">
              {pagesWithText.map((s, i) => {
                const text = s.textBlocks.map(b => b.text).join(' ');
                return (
                  <li key={s.id} className="flex gap-3 px-4 py-3 text-sm">
                    <span className="w-6 shrink-0 text-ink/40 font-semibold tabular-nums">{i + 1}</span>
                    <span className="min-w-0 text-ink/70 line-clamp-2">
                      {text || <em className="text-ink/40">Ingen text</em>}
                    </span>
                    <span className="shrink-0 text-xs text-ink/40 tabular-nums">{countWords(text)} ord</span>
                  </li>
                );
              })}
            </ol>
          )}

          <div className="flex flex-col sm:flex-row gap-3">
            <button
              onClick={() => onBookParsed(parsedBook)}
              disabled={empty}
              className="btn-action sm:flex-1"
            >
              Fortsätt till karaktärerna <Icon name="arrow_forward" size={19} />
            </button>
            <button onClick={handleSaveText} disabled={textSaved} className="btn-ghost">
              <Icon name={textSaved ? 'check' : 'bookmark_add'} size={18} />
              {textSaved ? 'Texten är sparad' : 'Spara texten'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ════════════════════════════════════════════════════════
  //  Manus: text, författare och boktyp
  // ════════════════════════════════════════════════════════
  const aiBeginning = !!draft.outline && !draft.restWritten;
  const imagesForText = Math.max(1, Math.round(words / preset.book.wordsPerImage));
  const busy = planning || continuing;

  return (
    <div className="space-y-6">
      <StepHeader
        eyebrow="Steg 1 av 4 · Berättelsen"
        title={draft.outline ? 'Din bok tar form' : 'Gör en bok av din text'}
        description={draft.outline
          ? 'Läs och ändra texten fritt. Prova bilderna på början innan AI:n skriver resten – då slipper du skapa en hel bok i fel stil.'
          : 'Klistra in texten som den är – prolog, kapitel och repliker. AI:n delar upp den i sidor, hittar karaktärerna och skriver bildbeskrivningar. Texten ändras inte.'}
        onBack={() => onModeChange('choose')}
      />

      {draft.notice && <div className="note-success">{draft.notice}</div>}

      <div className="grid lg:grid-cols-[1.25fr_1fr] gap-6 items-start">
        {/* Text */}
        <div className="card-glass hover:!shadow-soft p-5 sm:p-6 space-y-4">
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-semibold text-ink/80 mb-1.5">
                Titel <span className="text-ink/40 font-normal">(valfritt)</span>
              </label>
              <input value={draft.title} onChange={e => update({ title: e.target.value })} placeholder="AI:n föreslår en annars" className="field" />
            </div>
            <div>
              <label className="block text-sm font-semibold text-ink/80 mb-1.5">
                Författare <span className="text-ink/40 font-normal">(valfritt)</span>
              </label>
              <input value={draft.author} onChange={e => update({ author: e.target.value })} placeholder="Namnet på omslaget" className="field" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-semibold text-ink/80 mb-1.5">Texten</label>
            <textarea
              value={draft.rawText}
              onChange={e => update({ rawText: e.target.value })}
              placeholder={'Klistra in hela manuset här...\n\nKapitel 1 – Drömmen\n– Vänta på mig! ropar Otis och kippar efter andan.\nHan ligger en bra bit efter sin storasyster...'}
              className="field h-[22rem] lg:h-[34rem] text-sm leading-relaxed resize-y"
              disabled={busy}
            />
            <p className="text-xs text-ink/45 mt-1.5">
              {words > 0 ? `${words.toLocaleString('sv-SE')} ord` : 'Ett stycke per rad. Repliker kan börja med – eller -.'}
              {structured && ' · Texten har bokverktygets sidformat och delas upp efter SIDA-markeringarna.'}
            </p>
          </div>
        </div>

        {/* Boktyp och åtgärder */}
        <div className="space-y-4 lg:sticky lg:top-24">
          <div className="card-glass hover:!shadow-soft p-5 space-y-3">
            <div>
              <p className="text-sm font-semibold text-ink/80">Boktyp och stil</p>
              <p className="text-xs text-ink/50 mt-0.5">Stilen bestämmer bilderna, typografin och hur mycket text varje sida får.</p>
            </div>
            <StylePicker value={preset.id} onChange={id => update({ stylePresetId: id })} columns={1} />
            {structured && (
              <div className="flex flex-wrap gap-2 pt-1">
                {LEGACY_FORMATS.map(f => (
                  <button
                    key={f.value}
                    onClick={() => update({ legacyFormat: f.value })}
                    className={`${(draft.legacyFormat ?? preset.book.format) === f.value ? 'chip-on' : 'chip'} !py-1.5 !text-xs`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            )}
            <details className="group">
              <summary className="text-xs font-semibold text-ink/60 cursor-pointer select-none">
                Egna önskemål om bilderna
              </summary>
              <textarea
                value={draft.imageWishes}
                onChange={e => update({ imageWishes: e.target.value })}
                placeholder="T.ex. höstiga färger, mycket kvällsljus, Otis har alltid sin gröna mössa..."
                className="field h-20 text-sm resize-y mt-2"
              />
            </details>
          </div>

          <div className="glass rounded-3xl p-5 space-y-3">
            {words > 0 && !structured && (
              <p className="text-sm text-ink/60">
                {preset.label} · ca {imagesForText} {imagesForText === 1 ? 'bild' : 'bilder'} + omslag för {words.toLocaleString('sv-SE')} ord
              </p>
            )}

            {error && <div className="note-error">{error}</div>}

            {aiBeginning ? (
              <>
                <button onClick={() => onModeChange('styleTest')} disabled={busy || !words} className="btn-action w-full">
                  <Icon name="palette" size={19} /> Prova bilderna på början
                </button>
                <button onClick={handleContinue} disabled={busy || !words} className="btn-primary w-full">
                  {continuing
                    ? <><span className="spinner" /> {continueStage}</>
                    : <><Icon name="edit_note" size={19} /> Skriv resten av boken</>}
                </button>
                <p className="text-xs text-ink/45 text-center">
                  {continuing ? 'Det kan ta ett par minuter för en lång bok.' : `Boken blir ca ${preset.book.targetWords.toLocaleString('sv-SE')} ord – ${preset.book.lengthLabel.toLowerCase()}.`}
                </p>
              </>
            ) : (
              <>
                <button onClick={handleCreateBook} disabled={busy || !words} className="btn-action w-full">
                  {planning
                    ? <><span className="spinner" /> {planStage}</>
                    : <><Icon name="auto_stories" size={19} /> Skapa boken</>}
                </button>
                {!planning && (
                  <button onClick={() => onModeChange('styleTest')} disabled={busy || !words} className="btn-ghost w-full">
                    <Icon name="palette" size={18} /> Prova stilar på början först
                  </button>
                )}
                {planning && <p className="text-xs text-ink/45 text-center">Tar oftast under en minut.</p>}
              </>
            )}
            {words > 0 && !busy && (
              <button onClick={handleSaveText} disabled={textSaved} className="w-full text-xs font-semibold text-ink/50 hover:text-ink py-1">
                {textSaved ? 'Texten är sparad ✓' : 'Spara texten till senare'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
