'use client';

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { BookProject, Spread } from '@/lib/types';
import { audiobookSpreads, audiobookTextFromSpreads, MAX_AUDIOBOOK_CHARS, parseAudiobookText } from '@/lib/audiobook-text';
import { narrationSegments, estimateSeconds } from '@/lib/narration';
import { STYLE_PRESETS, getStylePreset } from '@/lib/styles';
import { saveBook } from '@/lib/storage';
import { getBookPublishState, setBookPublished, updateBookInfoInCloud } from '@/lib/supabase-db';
import { postJson } from '@/lib/fetch-json';
import AudiobookPanel from './AudiobookPanel';
import Icon from './Icon';
import StepHeader from './StepHeader';

type Step = 'text' | 'cover' | 'listen';

const STEPS: { key: Step; label: string }[] = [
  { key: 'text', label: 'Texten' },
  { key: 'cover', label: 'Omslag' },
  { key: 'listen', label: 'Ljudboken' },
];

const AGES = ['0-3', '3-6', '6-9', '9-12', '12-15'];
const DEFAULT_STYLE = 'luna';
// Så många spår visas i förhandsvisningen innan listan kortas
const SHOWN_SEGMENTS = 12;

interface Cover {
  // Ny bild (base64) tills den laddats upp - sedan bara adressen i molnet
  image?: string;
  url?: string;
  // Bildbeskrivningen från texten, så att "Gör ett nytt" slipper läsa texten igen
  scene: string;
  styleId: string;
  // Byts för varje nytt omslag - avgör om boken behöver sparas om
  version: string;
}

interface Props {
  // En ljudbok som redan finns (från Mina böcker eller bokhandeln), annars en ny
  book: BookProject | null;
  // Varje ändring sparas lokalt av sidan
  onBookChange: (book: BookProject) => void;
  onBack: () => void;
  backLabel?: string;
  onDone: () => void;
  onOpenInBookstore: (bookId: string) => void;
}

const thousands = (n: number) => n.toLocaleString('sv-SE');

// Speltid i listan: 4:07
function clock(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function minutesText(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 90) return `${minutes} ${minutes === 1 ? 'minut' : 'minuter'}`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${hours} ${hours === 1 ? 'timme' : 'timmar'}${rest ? ` och ${rest} min` : ''}`;
}

function coverFromBook(book: BookProject | null): Cover | null {
  const spread = book?.spreads.find(s => s.pages === 'omslag');
  if (!spread || (!spread.generatedImage && !spread.imageUrl)) return null;
  return {
    image: spread.generatedImage,
    url: spread.imageUrl,
    scene: spread.imagePrompt || '',
    styleId: book?.stylePresetId || DEFAULT_STYLE,
    version: spread.imageUrl || `lokal-${spread.id}`,
  };
}

const coverSrc = (cover: Cover | null) =>
  cover?.image ? `data:image/png;base64,${cover.image}` : cover?.url || '';

export default function AudiobookCreator({ book, onBookChange, onBack, backLabel = 'Tillbaka', onDone, onOpenInBookstore }: Props) {
  const initialCover = useMemo(() => coverFromBook(book), [book?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [bookId] = useState(() => book?.id || crypto.randomUUID());
  const [coverSpreadId] = useState(() => book?.spreads.find(s => s.pages === 'omslag')?.id || crypto.randomUUID());
  const [createdAt] = useState(() => book?.createdAt || new Date().toISOString());

  const [step, setStep] = useState<Step>(() => (!book ? 'text' : initialCover ? 'listen' : 'cover'));
  const [title, setTitle] = useState(book?.title || '');
  const [author, setAuthor] = useState(book?.author || '');
  const [targetAge, setTargetAge] = useState(book?.targetAge || '6-9');
  const [text, setText] = useState(() => (book ? audiobookTextFromSpreads(book.spreads) : ''));
  const [showInStore, setShowInStore] = useState(!book?.keepPrivate);

  // Omslag
  const [styleId, setStyleId] = useState(book?.stylePresetId || DEFAULT_STYLE);
  const [cover, setCover] = useState<Cover | null>(initialCover);
  const [wish, setWish] = useState('');
  const [coverBusy, setCoverBusy] = useState(false);
  const [coverError, setCoverError] = useState('');
  // Texten omslagsbeskrivningen gjordes för - ändras titel eller början görs en ny
  const sceneKey = useRef(book ? `${book.title}|${audiobookTextFromSpreads(book.spreads).slice(0, 3000)}` : '');

  // Molnet
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [savedSignature, setSavedSignature] = useState('');
  const [published, setPublished] = useState<boolean | null>(null);
  const [audioComplete, setAudioComplete] = useState(false);
  const [storeError, setStoreError] = useState('');
  const [showAllSegments, setShowAllSegments] = useState(false);

  // Analysen av texten släpar efter skrivandet, så att inklistring av en hel bok inte hackar
  const deferredText = useDeferredValue(text);
  const parsed = useMemo(() => parseAudiobookText(deferredText, title, author), [deferredText, title, author]);
  const segments = useMemo(
    () => narrationSegments({ title: title.trim() || 'Ljudboken', author: author.trim() || undefined, spreads: audiobookSpreads(parsed) }),
    [parsed, title, author]
  );
  const totalSeconds = segments.reduce((n, s) => n + estimateSeconds(s.text), 0);
  const tooLong = parsed.characters > MAX_AUDIOBOOK_CHARS;
  const textReady = title.trim().length > 0 && parsed.words > 0 && !tooLong;

  // ── Boken som sparas ──
  const buildBook = useCallback((overrides: Partial<BookProject> = {}): BookProject => {
    const coverSpread: Spread[] = cover ? [{
      id: coverSpreadId,
      spreadNumber: 0,
      pages: 'omslag',
      textBlocks: [],
      imagePrompt: cover.scene,
      generatedImage: cover.image,
      imageUrl: cover.url,
      status: 'done',
    }] : [];
    return {
      id: bookId,
      title: title.trim() || 'Ljudbok',
      author: author.trim() || undefined,
      targetAge,
      kind: 'audiobook',
      bookFormat: 'kapitelbok',
      stylePresetId: cover?.styleId || styleId,
      characters: [],
      spreads: [...coverSpread, ...audiobookSpreads(parseAudiobookText(text, title, author))],
      styleGuide: '',
      status: 'done',
      keepPrivate: showInStore ? undefined : true,
      createdAt,
      ...overrides,
    };
  }, [cover, coverSpreadId, bookId, title, author, targetAge, styleId, text, showInStore, createdAt]);

  // Det som avgör om molnets kopia är aktuell
  const signature = JSON.stringify([title.trim(), author.trim(), targetAge, text, cover?.version || '', showInStore]);

  // ── Molnsparning (behövs för att servern ska kunna läsa in ljudboken) ──
  const saveToCloud = useCallback(async () => {
    setSaving(true);
    setSaveError('');
    const sig = signature;
    try {
      const result = await saveBook(buildBook(), { cloud: true });
      if (result.cloud !== 'synced') {
        throw new Error(result.cloud === 'disabled' ? 'Molnet är inte påslaget här' : result.cloudError || 'Boken kunde inte sparas i molnet');
      }
      // Omslaget ligger nu i molnet: den lokala kopian behöver inte bilden längre
      const url = result.cloudImageUrls?.[coverSpreadId];
      let saved = result.book;
      if (url) {
        setCover(c => (c ? { ...c, url, image: undefined } : c));
        saved = {
          ...saved,
          spreads: saved.spreads.map(s => (s.id === coverSpreadId ? { ...s, imageUrl: url, generatedImage: undefined } : s)),
        };
      }
      onBookChange(saved);
      setSavedSignature(sig);
      setPublished(await getBookPublishState(bookId).catch(() => null));
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Boken kunde inte sparas i molnet');
    } finally {
      setSaving(false);
    }
  }, [signature, buildBook, coverSpreadId, onBookChange, bookId]);

  // Steg 3 behöver boken i molnet - spara när något ändrats sedan sist
  useEffect(() => {
    if (step === 'listen' && !saving && signature !== savedSignature && !saveError) void saveToCloud();
  }, [step, signature, savedSignature, saving, saveError, saveToCloud]);

  useEffect(() => { window.scrollTo({ top: 0 }); }, [step]);

  const goTo = (next: Step) => {
    if (next !== 'text' && !textReady) return;
    setSaveError('');
    // Sidan sparar lokalt, så att inget går förlorat om fliken stängs
    onBookChange(buildBook());
    setStep(next);
  };

  // ── Omslag ──
  const makeCover = async (freshIdea = false) => {
    setCoverError('');
    setCoverBusy(true);
    const key = `${title.trim()}|${text.slice(0, 3000)}`;
    const reuseScene = !freshIdea && cover?.scene && sceneKey.current === key ? cover.scene : undefined;
    try {
      const { ok, data } = await postJson<{ image: string; scene: string }>('/api/audiobook/cover', {
        title: title.trim(),
        styleId,
        wish: wish.trim() || undefined,
        ...(reuseScene ? { scene: reuseScene } : { text: text.slice(0, 16000) }),
      });
      if (!ok || !data.image) throw new Error(data.error || 'Omslaget kunde inte skapas');
      sceneKey.current = key;
      const next: Cover = { image: data.image, scene: data.scene, styleId, version: crypto.randomUUID() };
      setCover(next);
    } catch (err) {
      setCoverError(err instanceof Error ? err.message : 'Omslaget kunde inte skapas');
    } finally {
      setCoverBusy(false);
    }
  };

  // Nytt omslag sparas lokalt direkt
  const coverVersion = cover?.version;
  useEffect(() => {
    if (coverVersion && step === 'cover') onBookChange(buildBook());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coverVersion]);

  // ── Bokhandeln ──
  const changeShowInStore = async (on: boolean) => {
    setShowInStore(on);
    setStoreError('');
    const next = buildBook({ keepPrivate: on ? undefined : true });
    onBookChange(next);
    if (savedSignature === '') return; // inte i molnet än - följer med vid sparningen
    try {
      if (!on && published) {
        await setBookPublished(bookId, false);
        setPublished(false);
      } else if (on && audioComplete && !published) {
        await setBookPublished(bookId, true);
        setPublished(true);
      }
      await updateBookInfoInCloud(next);
      setSavedSignature(JSON.stringify([title.trim(), author.trim(), targetAge, text, cover?.version || '', on]));
    } catch (err) {
      setStoreError(err instanceof Error ? err.message : 'Kunde inte ändra bokhandeln just nu');
    }
  };

  // Servern publicerar ljudboken när sista kapitlet är inläst - fråga igen då
  const handleAudiobookChange = useCallback((state: { complete: boolean; parts: number }) => {
    setAudioComplete(state.complete);
    if (state.complete) getBookPublishState(bookId).then(setPublished).catch(() => {});
  }, [bookId]);

  // ════════════════════════════════════════════
  //  Delar
  // ════════════════════════════════════════════

  const stepIndex = STEPS.findIndex(s => s.key === step);
  const stepper = (
    <nav aria-label="Steg">
      <ol className="flex items-center gap-1 sm:gap-2">
        {STEPS.map((s, idx) => {
          const isCurrent = s.key === step;
          const isDone = idx < stepIndex;
          const canGo = !isCurrent && (s.key === 'text' || textReady) && !coverBusy;
          return (
            <li key={s.key} className="flex items-center gap-1 sm:gap-2 flex-1 last:flex-none">
              <button
                type="button"
                onClick={() => goTo(s.key)}
                disabled={!canGo}
                aria-current={isCurrent ? 'step' : undefined}
                className={`flex items-center gap-2 rounded-full pl-1 pr-3 py-1 transition-colors disabled:cursor-default ${
                  isCurrent ? 'bg-ink text-white' : canGo ? 'text-ink hover:bg-ink/5' : 'text-ink/40'
                }`}
              >
                <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold ${
                  isCurrent ? 'bg-white/15' : isDone ? 'bg-emerald-600 text-white' : 'bg-ink/[0.06]'
                }`}>
                  {isDone ? <Icon name="check" size={15} /> : idx + 1}
                </span>
                <span className={`text-sm font-medium whitespace-nowrap ${isCurrent ? '' : 'hidden sm:inline'}`}>{s.label}</span>
              </button>
              {idx < STEPS.length - 1 && <span className={`h-px flex-1 min-w-3 ${isDone ? 'bg-emerald-600/40' : 'bg-line'}`} />}
            </li>
          );
        })}
      </ol>
    </nav>
  );

  const coverBox = (size: 'large' | 'small') => (
    <div className={`relative aspect-square overflow-hidden border border-line bg-white ${size === 'large' ? 'rounded-3xl shadow-lift' : 'rounded-2xl shadow-soft'}`}>
      {coverBusy && size === 'large' ? (
        <div className="absolute inset-0 skeleton !rounded-none flex flex-col items-center justify-center gap-3 text-ink/60">
          <span className="spinner !w-7 !h-7" />
          <span className="text-sm font-medium">Ritar omslaget...</span>
        </div>
      ) : coverSrc(cover) ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={coverSrc(cover)} alt={`Omslag till ${title}`} className="absolute inset-0 w-full h-full object-cover" />
      ) : (
        <div className="absolute inset-0 flex flex-col justify-between p-5 bg-gradient-to-br from-paper via-white to-brand/10">
          <Icon name="headphones" size={size === 'large' ? 34 : 26} className="text-ink/25" />
          <span className={`font-heading font-bold text-ink/80 leading-tight break-words hyphens-auto ${size === 'large' ? 'text-2xl' : 'text-lg'}`}>
            {title.trim() || 'Din ljudbok'}
          </span>
        </div>
      )}
    </div>
  );

  // ════════════════════════════════════════════
  //  Steg 1: texten
  // ════════════════════════════════════════════
  const textStep = (
    <div className="grid lg:grid-cols-[minmax(0,1fr)_20rem] gap-6 items-start">
      <div className="card-glass hover:!shadow-soft p-5 sm:p-6 space-y-5">
        <div className="grid sm:grid-cols-2 gap-4">
          <label className="block">
            <span className="block text-xs font-semibold text-ink/60 mb-1">Titel</span>
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Bokens titel" className="field" maxLength={120} />
          </label>
          <label className="block">
            <span className="block text-xs font-semibold text-ink/60 mb-1">Författare (valfritt)</span>
            <input value={author} onChange={e => setAuthor(e.target.value)} placeholder="Läses upp efter titeln" className="field" maxLength={80} />
          </label>
        </div>

        <div role="group" aria-label="Passar för">
          <span className="block text-xs font-semibold text-ink/60 mb-1.5">Passar för</span>
          <div className="flex flex-wrap gap-2">
            {AGES.map(age => (
              <button key={age} type="button" onClick={() => setTargetAge(age)} aria-pressed={targetAge === age} className={targetAge === age ? 'chip-on' : 'chip'}>
                {age.replace('-', '–')} år
              </button>
            ))}
          </div>
        </div>

        <label className="block">
          <span className="block text-xs font-semibold text-ink/60 mb-1">Texten</span>
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder={'Klistra in hela texten här.\n\nRader som "Kapitel 1" eller "Kapitel 2: Skattkartan" blir egna kapitel i ljudboken.'}
            className="field min-h-[22rem] leading-relaxed resize-y"
            spellCheck
          />
        </label>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink/55">
          {parsed.words > 0 ? (
            <>
              <span className="inline-flex items-center gap-1.5"><Icon name="notes" size={17} /> {thousands(parsed.words)} ord</span>
              <span className="inline-flex items-center gap-1.5"><Icon name="schedule" size={17} /> ca {minutesText(totalSeconds)}</span>
              <span className="inline-flex items-center gap-1.5"><Icon name="text_fields" size={17} /> {thousands(parsed.characters)} tecken</span>
            </>
          ) : (
            <span>Titel och författare behöver inte stå i texten - de läses upp först ändå.</span>
          )}
        </div>
        {tooLong && (
          <div className="note-error">
            Texten är för lång för en ljudbok ({thousands(parsed.characters)} tecken, max {thousands(MAX_AUDIOBOOK_CHARS)}). Dela den gärna i flera delar.
          </div>
        )}
      </div>

      {/* Så blir ljudboken */}
      <aside className="card-glass hover:!shadow-soft p-5 space-y-3 lg:sticky lg:top-6">
        <h3 className="font-heading text-lg font-bold text-ink">Så blir ljudboken</h3>
        {parsed.words === 0 ? (
          <ul className="space-y-2.5 text-sm text-ink/65">
            <li className="flex gap-2"><Icon name="format_list_numbered" size={18} className="text-brand shrink-0 mt-px" /> Varje kapitel blir ett eget spår som går att lyssna på och läsa om för sig.</li>
            <li className="flex gap-2"><Icon name="record_voice_over" size={18} className="text-brand shrink-0 mt-px" /> Du väljer bland svenska röster och provlyssnar innan något läses in.</li>
            <li className="flex gap-2"><Icon name="image" size={18} className="text-brand shrink-0 mt-px" /> Ett kvadratiskt omslag ritas efter texten, i den stil du väljer.</li>
          </ul>
        ) : (
          <>
            <p className="text-sm text-ink/55">
              {segments.length} spår · ca {minutesText(totalSeconds)}
            </p>
            <ol className="divide-y divide-line rounded-2xl border border-line overflow-hidden bg-white">
              {(showAllSegments ? segments : segments.slice(0, SHOWN_SEGMENTS)).map(seg => (
                <li key={seg.index} className="flex items-center gap-2.5 px-3 py-2">
                  <span className="w-5 text-[11px] font-semibold tabular-nums text-ink/35 shrink-0">{seg.index + 1}</span>
                  <span className="flex-1 min-w-0 text-sm font-medium text-ink truncate">{seg.label}</span>
                  <span className="shrink-0 text-xs tabular-nums text-ink/45">{clock(estimateSeconds(seg.text))}</span>
                </li>
              ))}
            </ol>
            {segments.length > SHOWN_SEGMENTS && (
              <button type="button" onClick={() => setShowAllSegments(v => !v)} className="text-xs font-semibold text-brand hover:text-brand-dark">
                {showAllSegments ? 'Visa färre' : `Visa alla ${segments.length}`}
              </button>
            )}
            {parsed.chapters.every(c => !c.heading) && (
              <p className="text-xs text-ink/50 leading-relaxed">
                Inga kapitelrubriker hittades, så texten delas i lagom långa delar. Skriv &quot;Kapitel 1&quot; på en egen rad där ett kapitel börjar för att styra uppdelningen.
              </p>
            )}
          </>
        )}
      </aside>
    </div>
  );

  // ════════════════════════════════════════════
  //  Steg 2: omslaget
  // ════════════════════════════════════════════
  const styleLabel = getStylePreset(styleId)?.label || 'vald stil';
  const coverMatchesStyle = !!cover && cover.styleId === styleId;
  const coverStep = (
    <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] gap-6 items-start">
      <div className="card-glass hover:!shadow-soft p-5 sm:p-6 space-y-5">
        <div>
          <h3 className="font-heading text-lg font-bold text-ink">Välj stil</h3>
          <p className="mt-0.5 text-sm text-ink/55">Omslaget ritas efter texten, i den stil du väljer.</p>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          {STYLE_PRESETS.map(st => {
            const chosen = st.id === styleId;
            return (
              <button
                key={st.id}
                type="button"
                onClick={() => setStyleId(st.id)}
                aria-pressed={chosen}
                disabled={coverBusy}
                className={`group text-left rounded-2xl border p-1.5 transition-all active:scale-[0.99] disabled:opacity-60 ${
                  chosen ? 'border-brand ring-2 ring-brand/20 bg-brand/5' : 'border-line bg-white hover:border-ink/25'
                }`}
              >
                <span className={`relative block aspect-square rounded-xl overflow-hidden bg-gradient-to-br ${st.swatch}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/styles/${st.id}.jpg`} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
                  {chosen && (
                    <span className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-brand text-white flex items-center justify-center shadow-soft">
                      <Icon name="check" size={16} />
                    </span>
                  )}
                </span>
                <span className="block px-1 pt-1.5 pb-0.5 text-xs font-semibold text-ink leading-snug line-clamp-2">{st.label}</span>
              </button>
            );
          })}
        </div>
        <label className="block">
          <span className="block text-xs font-semibold text-ink/60 mb-1">Önskemål (valfritt)</span>
          <input
            value={wish}
            onChange={e => setWish(e.target.value)}
            placeholder="T.ex. Vilja med sin gula väska på bryggan i kvällssol"
            className="field"
            maxLength={300}
          />
          <span className="block text-[11px] text-ink/40 mt-1 leading-snug">Annars väljer vi motiv efter texten.</span>
        </label>
      </div>

      <div className="card-glass hover:!shadow-soft p-5 sm:p-6 space-y-4">
        {coverBox('large')}
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => makeCover()} disabled={coverBusy} className="btn-action flex-1 whitespace-nowrap">
            {coverBusy ? <span className="spinner !w-4 !h-4" /> : <Icon name={cover ? 'refresh' : 'auto_fix_high'} filled={!cover} size={19} />}
            {coverBusy ? 'Ritar...' : !cover ? 'Skapa omslag' : coverMatchesStyle ? 'Gör ett nytt' : 'Rita i den här stilen'}
          </button>
          {cover && !coverBusy && (
            <button type="button" onClick={() => makeCover(true)} className="btn-ghost whitespace-nowrap" title="Läser texten igen och väljer ett annat motiv">
              <Icon name="lightbulb" size={18} /> Ny idé
            </button>
          )}
        </div>
        <p className="text-xs text-ink/50 leading-relaxed">
          {coverBusy
            ? `Omslaget ritas i stilen ${styleLabel}. Det tar ungefär en halv minut.`
            : cover
            ? `Ritat i stilen ${getStylePreset(cover.styleId)?.label || styleLabel}. Titeln står på omslaget.`
            : 'Titeln letras på omslaget. Kvadratiskt, som ljudböcker brukar vara.'}
        </p>
        {coverError && <div className="note-error">{coverError}</div>}
      </div>
    </div>
  );

  // ════════════════════════════════════════════
  //  Steg 3: ljudboken
  // ════════════════════════════════════════════
  const listenStep = (
    <div className="grid lg:grid-cols-[17rem_minmax(0,1fr)] gap-6 items-start">
      <aside className="card-glass hover:!shadow-soft p-5 space-y-4 lg:sticky lg:top-6">
        <div className="max-w-[14rem] mx-auto lg:max-w-none">{coverBox('small')}</div>
        <div className="min-w-0">
          <h3 className="font-heading text-lg font-bold text-ink leading-tight break-words">{title.trim()}</h3>
          {author.trim() && <p className="text-sm text-ink/60">av {author.trim()}</p>}
          <p className="mt-1 text-xs text-ink/50">
            {segments.length} spår · ca {minutesText(totalSeconds)} · {targetAge.replace('-', '–')} år
          </p>
        </div>

        <div className="rounded-2xl border border-line bg-white p-3 space-y-2">
          <label className="flex items-start gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={showInStore}
              onChange={e => void changeShowInStore(e.target.checked)}
              className="mt-0.5 w-4 h-4 accent-brand shrink-0"
            />
            <span className="text-sm text-ink leading-snug">
              Visa i bokhandeln
              <span className="block text-xs text-ink/50">
                {published ? 'Finns under Ljudböcker.' : 'Visas under Ljudböcker när hela ljudboken är inläst.'}
              </span>
            </span>
          </label>
          {published && (
            <button type="button" onClick={() => onOpenInBookstore(bookId)} className="btn-ghost w-full !py-2 !text-sm">
              <Icon name="storefront" size={17} /> Visa i bokhandeln
            </button>
          )}
          {storeError && <p className="text-xs text-red-700">{storeError}</p>}
        </div>

        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => goTo('text')} className="btn-ghost !py-2 !text-sm flex-1">
            <Icon name="edit" size={17} /> Ändra texten
          </button>
          <button type="button" onClick={() => goTo('cover')} className="btn-ghost !py-2 !text-sm flex-1">
            <Icon name="image" size={17} /> Omslaget
          </button>
        </div>
      </aside>

      <div className="min-w-0">
        {saving || (signature !== savedSignature && !saveError) ? (
          <div className="glass rounded-4xl p-6 flex items-center gap-3 text-ink/70">
            <span className="spinner !w-5 !h-5 text-brand" />
            <span className="text-sm font-medium">Sparar ljudboken...</span>
          </div>
        ) : saveError ? (
          <div className="glass rounded-4xl p-5 sm:p-6 space-y-3">
            <div className="note-error">{saveError}</div>
            <button type="button" onClick={() => void saveToCloud()} className="btn-action">
              <Icon name="refresh" size={18} /> Försök igen
            </button>
          </div>
        ) : (
          <AudiobookPanel
            bookId={bookId}
            title={title.trim()}
            author={author.trim() || undefined}
            coverUrl={cover?.url}
            canCreate
            onAudiobookChange={handleAudiobookChange}
          />
        )}
      </div>
    </div>
  );

  // ════════════════════════════════════════════
  //  Sidan
  // ════════════════════════════════════════════
  const header = {
    text: { title: 'Gör en ljudbok av din text', description: 'Klistra in texten. Kapitel blir egna spår, och sedan väljer du omslag och röst.' },
    cover: { title: 'Omslaget', description: 'Ett kvadratiskt omslag med titeln, ritat efter texten. Du kan också gå vidare utan.' },
    listen: { title: title.trim() || 'Ljudboken', description: 'Välj röst, provlyssna och läs in hela boken eller ett kapitel i taget.' },
  }[step];

  return (
    <div className="space-y-6">
      <StepHeader
        eyebrow={`Steg ${stepIndex + 1} av 3 · Ljudbok från text`}
        title={header.title}
        description={header.description}
        onBack={onBack}
        backLabel={backLabel}
      />
      {stepper}

      {step === 'text' && textStep}
      {step === 'cover' && coverStep}
      {step === 'listen' && listenStep}

      {/* Knappar längst ned */}
      {step !== 'listen' ? (
        <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3 pt-2">
          <div className="text-xs text-ink/50">
            {step === 'text' && !title.trim() && parsed.words > 0 && 'Skriv en titel för att gå vidare.'}
            {step === 'text' && parsed.words === 0 && 'Klistra in texten för att gå vidare.'}
          </div>
          <div className="flex flex-wrap gap-2">
            {step === 'cover' && (
              <button type="button" onClick={() => goTo('text')} disabled={coverBusy} className="btn-ghost">
                <Icon name="arrow_back" size={18} /> Texten
              </button>
            )}
            {step === 'text' ? (
              <button type="button" onClick={() => goTo('cover')} disabled={!textReady} className="btn-action flex-1 sm:flex-none">
                Fortsätt till omslaget <Icon name="arrow_forward" size={18} />
              </button>
            ) : (
              <button type="button" onClick={() => goTo('listen')} disabled={coverBusy} className={`${cover ? 'btn-action' : 'btn-ghost'} flex-1 sm:flex-none`}>
                {cover ? 'Fortsätt till ljudboken' : 'Fortsätt utan omslag'} <Icon name="arrow_forward" size={18} />
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="flex justify-end pt-2">
          <button type="button" onClick={onDone} className="btn-ghost">
            <Icon name="library_books" size={18} /> Till Mina böcker
          </button>
        </div>
      )}
    </div>
  );
}
