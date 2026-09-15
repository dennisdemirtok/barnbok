'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BookProject, Spread } from '@/lib/types';
import type { StyleTestPlan } from '@/lib/claude';
import { STYLE_PRESETS, getStylePreset, composeStyleGuide } from '@/lib/styles';
import { saveStyleTest, loadStyleTest, clearStyleTest } from '@/lib/storage';
import StyleThumb from './StyleThumb';
import Icon from './Icon';
import StepHeader from './StepHeader';
import { postJson } from '@/lib/fetch-json';
import { pasteManuscript } from '@/lib/dialogue';
import { aspectFor, balanceCompositions, COMPOSITION_LABEL, resolveComposition } from '@/lib/compositions';
import { comicPageScript, comicTextBlocks, fallbackComicPage } from '@/lib/comic';

// Serieromaner provas som färdiga seriesidor med texten i bilden; övriga stilar sätter texten själva
const isComicStyle = (styleId: string) => getStylePreset(styleId)?.book.format === 'bildbok-text-pa-bild';

interface Props {
  // Vald stil tas vidare till manussteget, där hela boken skapas
  onChooseStyle: (choice: { stylePresetId: string; title: string; rawText: string }) => void;
  onBack: () => void;
  // Förifyllt från AI:ns början av boken - ersätter en tidigare provning
  initial?: { rawText: string; title: string; styles: string[]; note?: string };
}

type CellStatus = 'pending' | 'generating' | 'done' | 'error';

interface Cell {
  status: CellStatus;
  image?: string;
  error?: string;
}

interface TestState {
  title: string;
  rawText: string;
  selectedStyles: string[];
  plan: StyleTestPlan | null;
  styleGuides: Record<string, string>;
  cells: Record<string, Cell>;
}

interface PageRow {
  id: string;
  label: string;
  spread: Spread;
}

const DEFAULT_STYLES = ['luna', 'knyckertz', 'handbok', 'mammamu'];
const CONCURRENCY = 3;
const SECONDS_PER_IMAGE = 35;

const EMPTY_STATE: TestState = {
  title: '',
  rawText: '',
  selectedStyles: DEFAULT_STYLES,
  plan: null,
  styleGuides: {},
  cells: {},
};

const cellKey = (pageId: string, styleId: string) => `${pageId}|${styleId}`;

// Ungefär hur många testsidor en stil får - servern räknar exakt på styckena
const MAX_TEST_PAGES = 4;
function estimateTestPages(styleId: string, words: number): number {
  const perImage = getStylePreset(styleId)?.book.wordsPerImage ?? 150;
  return Math.max(1, Math.min(MAX_TEST_PAGES, Math.round(Math.min(words, perImage * MAX_TEST_PAGES) / perImage)));
}

// Varje stil har sin egen uppdelning av texten (olika mycket text per bild)
function buildPages(plan: StyleTestPlan, title: string, styleId: string): PageRow[] {
  const cover: PageRow = {
    id: 'cover',
    label: 'Omslag',
    spread: {
      id: 'cover',
      spreadNumber: 0,
      pages: 'omslag',
      textBlocks: [],
      imagePrompt: `${plan.coverPrompt}\n\nThe exact Swedish title text on the cover is: "${title}"`,
      status: 'pending',
    },
  };
  const sceneList = plan.scenesByStyle?.[styleId] ?? plan.scenes;
  // Rörliga boktyper blandar bildtyper redan på testsidorna
  const mix = getStylePreset(styleId)?.book.compositionMix;
  const compositions = mix ? balanceCompositions(sceneList.map(() => undefined), mix, `${styleId}:${title}`) : [];
  const comic = isComicStyle(styleId);
  const scenes = sceneList.map((scene, i): PageRow => {
    // Serie: sidmanus och pratbubblor från planeringen (äldre provningar får en enkel seriesida)
    const comicPage = comic && !scene.textBlocks ? fallbackComicPage(scene.text, scene.imagePrompt) : undefined;
    return {
      id: `scene-${i}`,
      label: scene.label,
      spread: {
        id: `scene-${i}`,
        spreadNumber: i + 1,
        pages: `${6 + i * 2}-${7 + i * 2}`,
        // Stycken blir egna textblock så layouterna kan fördela texten
        textBlocks: comicPage ? comicTextBlocks(comicPage) : scene.textBlocks ?? scene.text
          .split(/\n\s*\n/)
          .map(t => t.trim())
          .filter(Boolean)
          .map((text, j) => ({ position: `stycke ${j + 1}`, text })),
        imagePrompt: comicPage ? comicPageScript(comicPage, plan.characters) : scene.imagePrompt,
        composition: compositions[i],
        status: 'pending',
      },
    };
  });
  return [cover, ...scenes];
}

export default function StyleTester({ onChooseStyle, onBack, initial }: Props) {
  const [state, setState] = useState<TestState>(EMPTY_STATE);
  const [loaded, setLoaded] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [showScenes, setShowScenes] = useState(false);
  const [scenesStyle, setScenesStyle] = useState<string | null>(null);
  const [lightboxKey, setLightboxKey] = useState<string | null>(null);
  const [confirmStyle, setConfirmStyle] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  // Refs så att parallella genereringar alltid läser senaste state
  const stateRef = useRef(state);
  stateRef.current = state;
  const abortRef = useRef(false);

  const effectiveTitle = state.plan ? (state.title.trim() || state.plan.title) : state.title;
  const pagesByStyle = useMemo(() => {
    const map: Record<string, PageRow[]> = {};
    if (state.plan) for (const st of STYLE_PRESETS) map[st.id] = buildPages(state.plan, effectiveTitle, st.id);
    return map;
  }, [state.plan, effectiveTitle]);
  const pagesFor = (styleId: string) => pagesByStyle[styleId] ?? [];
  const activeStyles = STYLE_PRESETS.filter(s => state.selectedStyles.includes(s.id));

  // ── Ladda senaste provningen ──
  useEffect(() => {
    loadStyleTest<TestState>()
      .then(saved => {
        // En ny text från AI:n ersätter provningen - men samma text återupptas
        if (initial && saved?.rawText !== initial.rawText) {
          setState({ ...EMPTY_STATE, rawText: initial.rawText, title: initial.title, selectedStyles: initial.styles });
        } else if (saved) {
          // Bilder som höll på att genereras vid omladdning ska göras om
          const cells: Record<string, Cell> = {};
          for (const [k, c] of Object.entries(saved.cells || {})) {
            cells[k] = c.status === 'generating' ? { status: 'pending' } : c;
          }
          setState({ ...EMPTY_STATE, ...saved, cells });
        }
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
    return () => { abortRef.current = true; };
  }, []);

  // ── Spara löpande (debounce) ──
  useEffect(() => {
    if (!loaded) return;
    const t = setTimeout(() => {
      saveStyleTest(state).catch(err => console.warn('Kunde inte spara stilprovning:', err));
    }, 1200);
    return () => clearTimeout(t);
  }, [state, loaded]);

  const setCell = (key: string, cell: Cell) =>
    setState(prev => ({ ...prev, cells: { ...prev.cells, [key]: cell } }));

  const generateCell = useCallback(async (key: string) => {
    const s = stateRef.current;
    if (!s.plan) return;
    const [pageId, styleId] = key.split('|');
    const page = buildPages(s.plan, s.title.trim() || s.plan.title, styleId).find(p => p.id === pageId);
    const fallbackPreset = getStylePreset(styleId);
    const styleGuide = s.styleGuides[styleId] || (fallbackPreset ? composeStyleGuide(fallbackPreset) : undefined);
    if (!page || !styleGuide) return;

    setCell(key, { status: 'generating' });
    try {
      const res = await fetch('/api/style-test/image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          spread: page.spread,
          characters: s.plan.characters,
          styleGuide,
          // Texten sätts av layoutmotorn - utom i serieromaner där den letras i bilden.
          // Bildform enligt stilens bokkoncept.
          bookFormat: isComicStyle(styleId) ? 'bildbok-text-pa-bild' : 'bildbok-separat-text',
          illustrationShape: getStylePreset(styleId)?.shape,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.image) throw new Error(data.error || 'Ingen bild genererades');
      setCell(key, { status: 'done', image: data.image });
    } catch (err) {
      setCell(key, { status: 'error', error: err instanceof Error ? err.message : 'Okänt fel' });
    }
  }, []);

  const runQueue = useCallback(async (keys: string[]) => {
    if (keys.length === 0) return;
    abortRef.current = false;
    setRunning(true);
    const queue = [...keys];
    const worker = async () => {
      while (queue.length > 0 && !abortRef.current) {
        const key = queue.shift()!;
        await generateCell(key);
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    setRunning(false);
  }, [generateCell]);

  // Kö: omslag i alla stilar först, sedan sida för sida - så jämförelsen syns tidigt
  const missingKeys = (s: TestState = stateRef.current) => {
    if (!s.plan) return [];
    const title = s.title.trim() || s.plan.title;
    const rowsByStyle = s.selectedStyles.map(styleId => ({ styleId, rows: buildPages(s.plan!, title, styleId) }));
    const keys: string[] = [];
    const longest = Math.max(0, ...rowsByStyle.map(r => r.rows.length));
    for (let i = 0; i < longest; i++) {
      for (const { styleId, rows } of rowsByStyle) {
        const row = rows[i];
        if (!row) continue;
        const key = cellKey(row.id, styleId);
        const cell = s.cells[key];
        if (!cell || cell.status === 'pending' || cell.status === 'error') keys.push(key);
      }
    }
    return keys;
  };

  // ── Analysera texten och starta generering ──
  const handleStart = async () => {
    setError('');
    setPlanning(true);
    try {
      const { ok, data } = await postJson<{ plan: StyleTestPlan; styleGuides: Record<string, string> }>(
        '/api/style-test/plan', { rawText: state.rawText, title: state.title }
      );
      if (!ok) throw new Error(data.error || 'Kunde inte analysera texten');

      const next: TestState = { ...stateRef.current, plan: data.plan, styleGuides: data.styleGuides, cells: {} };
      stateRef.current = next;
      setState(next);
      setPlanning(false);
      runQueue(missingKeys(next));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Något gick fel');
      setPlanning(false);
    }
  };

  const toggleStyle = (id: string) => {
    setState(prev => {
      const selected = prev.selectedStyles.includes(id)
        ? prev.selectedStyles.filter(s => s !== id)
        : [...prev.selectedStyles, id];
      // Behåll stillistans ordning
      return { ...prev, selectedStyles: STYLE_PRESETS.map(s => s.id).filter(s => selected.includes(s)) };
    });
  };

  const handleReset = async () => {
    if (!confirmReset) {
      setConfirmReset(true);
      setTimeout(() => setConfirmReset(false), 4000);
      return;
    }
    abortRef.current = true;
    setConfirmReset(false);
    setState(prev => ({ ...prev, plan: null, cells: {}, styleGuides: {} }));
    await clearStyleTest().catch(() => {});
  };

  const handleChooseStyle = (styleId: string) => {
    const s = stateRef.current;
    if (!s.plan) return;
    abortRef.current = true;
    onChooseStyle({ stylePresetId: styleId, title: s.title.trim() || s.plan.title, rawText: s.rawText });
  };

  // ── Lightbox-navigering över klara bilder ──
  const doneKeys = activeStyles.flatMap(style =>
    pagesFor(style.id).map(p => cellKey(p.id, style.id)).filter(k => state.cells[k]?.status === 'done')
  );
  const stepLightbox = useCallback((dir: 1 | -1) => {
    setLightboxKey(current => {
      if (!current || doneKeys.length === 0) return current;
      const idx = doneKeys.indexOf(current);
      return doneKeys[(idx + dir + doneKeys.length) % doneKeys.length];
    });
  }, [doneKeys]);

  useEffect(() => {
    if (!lightboxKey) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightboxKey(null);
      if (e.key === 'ArrowRight') stepLightbox(1);
      if (e.key === 'ArrowLeft') stepLightbox(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightboxKey, stepLightbox]);

  // ── Statistik ──
  const totalCells = activeStyles.reduce((n, style) => n + pagesFor(style.id).length, 0);
  const doneCount = doneKeys.length;
  const errorCount = activeStyles.reduce((n, style) =>
    n + pagesFor(style.id).filter(p => state.cells[cellKey(p.id, style.id)]?.status === 'error').length, 0);
  const missingCount = state.plan ? missingKeys(state).length : 0;
  const wordCount = state.rawText.trim() ? state.rawText.trim().split(/\s+/).length : 0;
  const plannedImages = state.selectedStyles.reduce((n, id) => n + 1 + estimateTestPages(id, wordCount), 0);
  const estimatedMinutes = Math.max(1, Math.round((plannedImages / CONCURRENCY) * SECONDS_PER_IMAGE / 60));

  const header = (
    <StepHeader
      eyebrow="Steg 1 av 4 · Stilprovning"
      title={state.plan ? effectiveTitle : 'Prova stilar på början av din bok'}
      description={state.plan
        ? 'Varje rad är en stil och varje kolumn en sida. Jämför och välj den väg boken ska ta.'
        : 'Klistra in en start och ett första kapitel. Du får ett omslag och testsidor i flera stilar – innan du gör hela boken.'}
      onBack={onBack}
    />
  );

  if (!loaded) {
    return (
      <div className="space-y-6">
        {header}
        <div className="skeleton h-96 rounded-4xl" />
      </div>
    );
  }

  // ════════════════════════════════════════════════════════
  //  INMATNING
  // ════════════════════════════════════════════════════════
  if (!state.plan) {
    return (
      <div className="space-y-6">
        {header}
        {initial?.note && <div className="note-success">{initial.note}</div>}

        <div className="grid lg:grid-cols-5 gap-6 items-start">
          {/* Text */}
          <div className="lg:col-span-3 card-glass p-5 sm:p-6 space-y-4 hover:!shadow-soft">
            <div>
              <label className="block text-sm font-semibold text-ink/80 mb-2">
                Titel <span className="text-ink/40 font-normal">(valfritt – annars föreslår AI:n en)</span>
              </label>
              <input
                type="text"
                value={state.title}
                onChange={e => setState(prev => ({ ...prev, title: e.target.value }))}
                placeholder="T.ex. Allies försvinnande"
                className="field"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-ink/80 mb-2">
                Början av boken
              </label>
              <textarea
                value={state.rawText}
                onChange={e => setState(prev => ({ ...prev, rawText: e.target.value }))}
                onPaste={e => { const v = pasteManuscript(e, state.rawText); if (v !== null) setState(prev => ({ ...prev, rawText: v })); }}
                placeholder={'Klistra in prolog och kapitel 1 här...\n\n– Vänta på mig! ropar Otis och kippar efter andan.\n\nHan ligger en bra bit efter sin storasyster...'}
                className="field h-[22rem] lg:h-[30rem] text-sm leading-relaxed resize-y"
              />
              <p className="text-xs text-ink/40 mt-1.5">
                {wordCount > 0
                  ? `${wordCount.toLocaleString('sv-SE')} ord · ${state.rawText.length.toLocaleString('sv-SE')} tecken`
                  : 'Texten används ordagrant – AI:n delar bara upp den i scener och skriver bildbeskrivningar.'}
              </p>
            </div>
          </div>

          {/* Inställningar */}
          <div className="lg:col-span-2 space-y-6">
            <div className="card-glass p-5 sm:p-6 space-y-5 hover:!shadow-soft">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-semibold text-ink/80">Stilar att jämföra</label>
                  <button
                    onClick={() => setState(prev => ({
                      ...prev,
                      selectedStyles: prev.selectedStyles.length === STYLE_PRESETS.length
                        ? DEFAULT_STYLES
                        : STYLE_PRESETS.map(s => s.id),
                    }))}
                    className="text-xs font-semibold text-brand/70 hover:text-brand"
                  >
                    {state.selectedStyles.length === STYLE_PRESETS.length ? 'Standardval' : 'Välj alla'}
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2 gap-2">
                  {STYLE_PRESETS.map(style => {
                    const on = state.selectedStyles.includes(style.id);
                    return (
                      <button
                        key={style.id}
                        onClick={() => toggleStyle(style.id)}
                        className={`flex items-start gap-2.5 p-2.5 rounded-2xl text-left text-sm transition-all ${
                          on
                            ? 'bg-white ring-2 ring-ink shadow-soft'
                            : 'bg-paper/60 ring-1 ring-line hover:ring-ink/25 hover:bg-white'
                        }`}
                      >
                        <StyleThumb styleId={style.id} size={40} selected={on} />
                        <span className="min-w-0">
                          <span className={`block font-heading font-semibold leading-tight ${on ? 'text-ink' : 'text-ink/70'}`}>
                            {style.label}
                          </span>
                          <span className="block text-[11px] leading-snug text-ink/55 mt-0.5">
                            {style.concept}
                          </span>
                          <span className="block text-[11px] leading-snug text-ink/40 mt-0.5">
                            {style.book.lengthLabel}{wordCount > 0 && ` · ${estimateTestPages(style.id, wordCount)} testsidor`}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

            </div>

            <div className="glass rounded-4xl p-5 space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 shrink-0 rounded-2xl bg-ink flex items-center justify-center text-white shadow-soft">
                  <Icon name="photo_library" filled size={22} />
                </div>
                <div className="text-sm">
                  <p className="font-heading font-semibold text-ink">
                    {plannedImages} testbilder
                  </p>
                  <p className="text-ink/55">
                    Omslag + testsidor i {state.selectedStyles.length} {state.selectedStyles.length === 1 ? 'stil' : 'stilar'} · ca {estimatedMinutes} min
                  </p>
                  <p className="text-xs text-ink/40 mt-0.5">
                    Antalet testsidor följer hur mycket text varje boktyp har per sida.
                  </p>
                </div>
              </div>

              {error && <div className="note-error">{error}</div>}

              <button
                onClick={handleStart}
                disabled={planning || !state.rawText.trim() || state.selectedStyles.length === 0}
                className="btn-action w-full text-base disabled:opacity-50 disabled:translate-y-0 disabled:shadow-none"
              >
                {planning
                  ? <><span className="spinner" /> Läser texten och väljer scener...</>
                  : <><Icon name="auto_awesome" filled size={20} /> Skapa testbilder</>}
              </button>
              {planning && (
                <p className="text-xs text-ink/55 text-center">
                  Claude delar upp texten i scener och beskriver bildstarka ögonblick. Tar ungefär en minut.
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ════════════════════════════════════════════════════════
  //  RESULTAT: stilar × sidor
  // ════════════════════════════════════════════════════════
  const plan = state.plan;
  const progress = totalCells > 0 ? Math.round((doneCount / totalCells) * 100) : 0;
  const lightboxCell = lightboxKey ? state.cells[lightboxKey] : null;
  const [lbPageId, lbStyleId] = lightboxKey ? lightboxKey.split('|') : ['', ''];

  return (
    <div className="space-y-6">
      {header}

      {/* Kontrollpanel */}
      <div className="glass rounded-4xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className={`w-12 h-12 shrink-0 rounded-2xl flex items-center justify-center text-white shadow-soft ${
              doneCount === totalCells ? 'bg-emerald-500' : 'bg-ink'
            }`}>
              {running
                ? <span className="spinner !w-6 !h-6" />
                : <Icon name={doneCount === totalCells ? 'celebration' : 'palette'} filled size={26} />}
            </div>
            <div>
              <p className="font-heading font-semibold text-ink">
                {doneCount === totalCells
                  ? 'Alla testbilder klara – välj en stil!'
                  : running ? 'Skapar testbilder...' : `${missingCount} ${missingCount === 1 ? 'bild' : 'bilder'} återstår`}
              </p>
              <p className="text-sm text-ink/55">
                {doneCount} av {totalCells} bilder
                {errorCount > 0 && <span className="text-red-500"> · {errorCount} misslyckades</span>}
                {running && missingCount > 0 && ` · ca ${Math.max(1, Math.round((missingCount / CONCURRENCY) * SECONDS_PER_IMAGE / 60))} min kvar`}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {running ? (
              <button onClick={() => { abortRef.current = true; }} className="btn-danger !py-2.5 text-sm">
                <Icon name="stop_circle" filled size={18} /> Pausa
              </button>
            ) : missingCount > 0 ? (
              <button onClick={() => runQueue(missingKeys())} className="btn-primary !py-2.5 text-sm">
                <Icon name="auto_fix_high" filled size={18} /> Generera {missingCount} saknade
              </button>
            ) : null}
            <button onClick={() => setShowScenes(v => !v)} className="btn-ghost !py-2 text-sm">
              <Icon name={showScenes ? 'expand_less' : 'article'} size={18} />
              {showScenes ? 'Dölj scenerna' : 'Visa scenerna'}
            </button>
            <button
              onClick={handleReset}
              className={`btn-ghost !py-2 text-sm ${confirmReset ? '!bg-red-600 !text-white !border-red-600' : ''}`}
            >
              <Icon name="restart_alt" size={18} />
              {confirmReset ? 'Klicka igen – rensar bilderna' : 'Ny provning'}
            </button>
          </div>
        </div>

        <div className="bg-ink/10 rounded-full h-2.5 overflow-hidden">
          <div
            className="bg-brand h-full rounded-full transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>

        {/* Lägg till/ta bort stilar i efterhand */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-ink/55 mr-1">Stilar:</span>
          {STYLE_PRESETS.map(style => {
            const on = state.selectedStyles.includes(style.id);
            return (
              <button
                key={style.id}
                onClick={() => toggleStyle(style.id)}
                disabled={running}
                title={on ? 'Dölj stilen' : 'Lägg till stilen – generera sedan saknade bilder'}
                className={`${on ? 'chip-on' : 'chip'} !py-1.5 !text-xs disabled:opacity-60`}
              >
                <Icon name={on ? 'check' : 'add'} size={15} /> {style.label}
              </button>
            );
          })}
        </div>

        {/* Karaktärer */}
        {plan.characters.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-ink/55 mr-1">Karaktärer:</span>
            {plan.characters.map(c => (
              <span key={c.name} title={c.appearance} className="magic-chip !text-xs cursor-help">
                <Icon name={c.role === 'main' ? 'star' : 'person'} filled size={13} />
                {c.name}{c.age ? `, ${c.age}` : ''}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Scentexter */}
      {showScenes && (
        <div className="space-y-3 animate-fade-up">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-ink/55 mr-1">Uppdelning för:</span>
            {activeStyles.map(style => (
              <button
                key={style.id}
                onClick={() => setScenesStyle(style.id)}
                className={`${(scenesStyle ?? activeStyles[0]?.id) === style.id ? 'chip-on' : 'chip'} !py-1.5 !text-xs`}
              >
                {style.label} · {pagesFor(style.id).length - 1} sidor
              </button>
            ))}
          </div>
          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
          {(plan.scenesByStyle?.[scenesStyle ?? activeStyles[0]?.id ?? ''] ?? plan.scenes).map((scene, i) => (
            <div key={i} className="card-glass p-4 hover:!shadow-soft">
              <p className="text-xs font-semibold text-brand/60 uppercase tracking-wide">Sida {i + 1}</p>
              <h4 className="font-heading font-semibold text-ink mb-2">{scene.label}</h4>
              <p className="text-sm text-ink/65 whitespace-pre-line max-h-48 overflow-y-auto pr-1">{scene.text}</p>
            </div>
          ))}
          </div>
        </div>
      )}

      {errorCount > 0 && !running && (
        <div className="note-warning">
          {errorCount} {errorCount === 1 ? 'bild' : 'bilder'} kunde inte skapas. Klicka &quot;Generera saknade&quot; eller försök igen på enskilda bilder.
        </div>
      )}

      {/* Matris: en rad per stil */}
      <div className="space-y-5">
        {activeStyles.map(style => {
          const pages = pagesFor(style.id);
          const rowDone = pages.filter(p => state.cells[cellKey(p.id, style.id)]?.status === 'done').length;
          return (
            <div key={style.id} className="card-glass p-4 sm:p-5 hover:!shadow-soft animate-fade-up">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                <div className="flex items-center gap-3">
                  <StyleThumb styleId={style.id} size={44} className="shadow-soft" />
                  <div>
                    <h3 className="font-heading font-semibold text-ink leading-tight">{style.label}</h3>
                    <p className="text-xs text-ink/55">
                      {rowDone} av {pages.length} bilder klara
                      {' · '}{style.concept}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setConfirmStyle(style.id)}
                  disabled={rowDone === 0}
                  className="btn-action !py-2 !px-5 text-sm disabled:opacity-40 disabled:translate-y-0 disabled:shadow-none"
                >
                  Välj denna stil <Icon name="arrow_forward" size={18} />
                </button>
              </div>

              <div className="overflow-x-auto no-scrollbar -mx-4 px-4 sm:mx-0 sm:px-1 pb-1">
                <div
                  className="grid gap-3"
                  // Omslaget är alltid stående; sidorna följer stilens bildform
                  style={{
                    gridTemplateColumns: pages.map(pg => {
                      const comp = pg.id === 'cover' ? 'full' : resolveComposition(pg.spread.composition, style.shape);
                      return comp === 'spread' || comp === 'band' ? 'minmax(200px, 290px)' : 'minmax(130px, 190px)';
                    }).join(' '),
                  }}
                >
                  {pages.map(page => {
                    const key = cellKey(page.id, style.id);
                    const cell = state.cells[key];
                    return (
                      <div key={key} className="min-w-0">
                        <div
                          className={`relative overflow-hidden bg-paper ring-1 ring-line group ${page.spread.composition === 'round' ? 'rounded-full' : 'rounded-2xl'}`}
                          style={{ aspectRatio: aspectFor(page.id === 'cover' ? 'full' : resolveComposition(page.spread.composition, style.shape)).replace(':', ' / ') }}
                        >
                          {cell?.status === 'done' && cell.image ? (
                            <>
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={`data:image/png;base64,${cell.image}`}
                                alt={`${page.label} i stilen ${style.label}`}
                                onClick={() => setLightboxKey(key)}
                                className="w-full h-full object-cover cursor-zoom-in group-hover:scale-[1.03] transition-transform duration-500"
                              />
                              {!running && (
                                <button
                                  onClick={() => runQueue([key])}
                                  title="Skapa en ny version av bilden"
                                  className="absolute top-2 right-2 w-8 h-8 rounded-full bg-white text-brand shadow-soft
                                             flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                                >
                                  <Icon name="refresh" size={17} />
                                </button>
                              )}
                            </>
                          ) : cell?.status === 'generating' ? (
                            <div className="skeleton !rounded-none w-full h-full flex flex-col items-center justify-center text-brand">
                              <span className="spinner !w-7 !h-7 relative z-10" />
                              <span className="text-xs text-ink/55 mt-2 relative z-10">Målar...</span>
                            </div>
                          ) : cell?.status === 'error' ? (
                            <div className="w-full h-full flex flex-col items-center justify-center p-3 text-center">
                              <Icon name="broken_image" size={26} className="text-red-300" />
                              <p className="text-[11px] text-ink/55 mt-1 line-clamp-3">{cell.error}</p>
                              {!running && (
                                <button
                                  onClick={() => runQueue([key])}
                                  className="mt-2 px-3 py-1 bg-brand text-white text-xs rounded-full font-medium hover:opacity-90"
                                >
                                  Försök igen
                                </button>
                              )}
                            </div>
                          ) : (
                            <div className="w-full h-full flex flex-col items-center justify-center text-ink/40">
                              <Icon name="hourglass_empty" size={24} />
                              <span className="text-xs mt-1">I kö</span>
                            </div>
                          )}
                        </div>
                        <p className="mt-1.5 text-xs font-semibold text-ink/65 truncate" title={page.label}>
                          {page.id === 'cover' ? 'Omslag' : page.label}
                          {page.spread.composition && <span className="ml-1 font-normal text-ink/40">· {COMPOSITION_LABEL[page.spread.composition]}</span>}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Bekräfta stilval */}
      {confirmStyle && (
        <div className="fixed inset-0 !m-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setConfirmStyle(null)}>
          <div className="glass-strong rounded-4xl w-full max-w-md p-7 animate-pop" onClick={e => e.stopPropagation()}>
            <StyleThumb styleId={confirmStyle} size={64} className="block shadow-soft mb-4" />
            <h3 className="text-2xl font-heading font-bold text-ink mb-2">
              Gå vidare med {getStylePreset(confirmStyle)?.label}?
            </h3>
            <p className="text-sm text-ink/55 mb-2">
              Nästa steg är att göra hela boken: stilen är förvald och din text följer med. Har du bara provat början
              klistrar du in resten av manuset där.
            </p>
            <p className="text-sm text-ink/55 mb-6">
              Bilderna skapas sedan med godkända karaktärer, så att figurerna ser likadana ut på varje sida.
              Stilprovningen finns kvar om du vill komma tillbaka.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmStyle(null)} className="btn-ghost flex-1">Avbryt</button>
              <button onClick={() => handleChooseStyle(confirmStyle)} className="btn-action flex-1">
                Fortsätt <Icon name="arrow_forward" size={18} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Lightbox */}
      {lightboxKey && lightboxCell?.image && (
        <div className="fixed inset-0 !m-0 bg-black/85 backdrop-blur-sm z-50 flex flex-col animate-pop" onClick={() => setLightboxKey(null)}>
          <div className="flex items-center justify-between gap-3 px-4 sm:px-6 py-3 text-white" onClick={e => e.stopPropagation()}>
            <div className="min-w-0">
              <p className="font-heading font-semibold truncate">
                {pagesFor(lbStyleId).find(p => p.id === lbPageId)?.label} · {getStylePreset(lbStyleId)?.label}
              </p>
              <p className="text-xs text-white/60">Pilar ← → för att bläddra · Esc för att stänga</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => { setLightboxKey(null); setConfirmStyle(lbStyleId); }}
                className="btn-action !py-2 !px-4 text-sm"
              >
                Välj stilen
              </button>
              <button onClick={() => setLightboxKey(null)} className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center">
                <Icon name="close" size={22} />
              </button>
            </div>
          </div>
          <div className="flex-1 min-h-0 flex items-center justify-center gap-2 px-2 sm:px-6 pb-6">
            <button
              onClick={e => { e.stopPropagation(); stepLightbox(-1); }}
              className="shrink-0 w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center"
              title="Föregående"
            >
              <Icon name="chevron_left" size={28} />
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`data:image/png;base64,${lightboxCell.image}`}
              alt=""
              onClick={e => e.stopPropagation()}
              className="max-h-full max-w-full object-contain rounded-2xl shadow-2xl"
            />
            <button
              onClick={e => { e.stopPropagation(); stepLightbox(1); }}
              className="shrink-0 w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center"
              title="Nästa"
            >
              <Icon name="chevron_right" size={28} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
