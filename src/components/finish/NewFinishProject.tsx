'use client';

import { useMemo, useRef, useState } from 'react';
import type { AuthorVoice, FinishProject, FinishSettings, TimelineChapter, TimelineRequest, TimelineResponse, VoiceRequest, VoiceResponse } from '@/lib/author-types';
import { saveAuthorVoice, saveFinishProject } from '@/lib/storage';
import { postJson } from '@/lib/fetch-json';
import Icon from '../Icon';
import { countMissingMarkers, pasteManuscript, restoreDialogueMarkers } from '@/lib/dialogue';
import StepHeader from '../StepHeader';
import { FreedomPicker } from './SettingsModal';
import { FieldLabel, Stepper, useElapsed } from './ui';
import {
  AGE_OPTIONS,
  applyTimeline,
  buildContext,
  continueTitles,
  countWords,
  errorText,
  fmt,
  newId,
  newPlannedChapter,
  nowIso,
  splitBeginning,
  voiceFromResponse,
} from './finish-utils';

interface Props {
  voices: AuthorVoice[];
  onCancel: () => void;
  onCreated: (project: FinishProject) => void;
  onVoicesChanged: () => void;
}

type StepState = 'pending' | 'running' | 'done' | 'error' | 'skipped';

interface Pipeline {
  project: FinishProject;
  voice: StepState;
  timeline: StepState;
  error?: string;
  startedAt: number;
}

const MIN_WORDS = 80;

export default function NewFinishProject({ voices, onCancel, onCreated, onVoicesChanged }: Props) {
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [beginning, setBeginning] = useState('');
  const [premise, setPremise] = useState('');
  const [ending, setEnding] = useState('');
  const [targetAge, setTargetAge] = useState('6-9 år');
  const [totalChapters, setTotalChapters] = useState(10);
  const [wordsOverride, setWordsOverride] = useState<number | null>(null);
  const [freedom, setFreedom] = useState<FinishSettings['freedom']>('balanced');
  const [voiceChoice, setVoiceChoice] = useState<string>('analyze'); // 'analyze' eller id på sparat språk
  const [rememberVoice, setRememberVoice] = useState(true);
  const [pipeline, setPipeline] = useState<Pipeline | null>(null);
  const [formError, setFormError] = useState('');
  const [loadingSample, setLoadingSample] = useState(false);
  const beginningRef = useRef<HTMLTextAreaElement>(null);

  const parts = useMemo(() => splitBeginning(beginning), [beginning]);
  const beginningWords = useMemo(() => countWords(beginning), [beginning]);
  const missingBeginningDialogue = useMemo(() => countMissingMarkers(beginning), [beginning]);
  const autoWords = useMemo(() => {
    const written = parts.filter(p => p.text.trim());
    if (!written.length) return 1000;
    const avg = written.reduce((s, p) => s + countWords(p.text), 0) / written.length;
    return Math.max(100, Math.round(avg / 50) * 50);
  }, [parts]);
  const wordsPerChapter = wordsOverride ?? autoWords;
  const minChapters = Math.max(1, parts.length);
  const chapterCount = Math.max(totalChapters, minChapters);
  const toWrite = chapterCount - parts.filter(p => p.text.trim()).length;
  const savedVoice = voices.find(v => v.id === voiceChoice);

  const loadSample = async () => {
    setLoadingSample(true);
    try {
      const res = await fetch('/dev-data/book.json');
      const book = await res.json() as { title?: string; author?: string; spreads?: { textBlocks?: { text: string }[] }[] };
      const text = (book.spreads || []).flatMap(s => (s.textBlocks || []).map(b => b.text)).join('\n\n');
      setBeginning(text);
      setTitle(book.title || 'Bydalen');
      setAuthor(book.author || '');
      if (!premise) setPremise('Otis storasyster Allie har varit försvunnen i över tre veckor. Otis tror inte på de vuxnas förklaringar och börjar leta på egen hand i skogen bakom Bydalen, där han hittar spår som ingen annan har sett.');
    } catch {
      setFormError('Exempeltexten kunde inte laddas');
    } finally {
      setLoadingSample(false);
    }
  };

  // ── Skapa: dela upp → lär språket → fyll tidslinjen ──

  const create = async () => {
    setFormError('');
    if (beginningWords < MIN_WORDS) {
      setFormError(`Klistra in lite mer av din början (minst ${MIN_WORDS} ord) så att AI:n kan lära sig ditt språk.`);
      beginningRef.current?.focus();
      return;
    }
    const now = nowIso();
    const authored: TimelineChapter[] = parts.map(part =>
      part.text.trim()
        ? { id: newId(), title: part.title, notes: '', text: part.text, source: 'author', status: 'written', history: [], updatedAt: now }
        : newPlannedChapter(part.title),
    );
    const planned = continueTitles(parts.map(p => p.title), chapterCount - parts.length).map(t => newPlannedChapter(t));
    const project: FinishProject = {
      id: newId(),
      title: title.trim() || 'Namnlös bok',
      author: author.trim(),
      premise: premise.trim(),
      ending: ending.trim() || undefined,
      voice: savedVoice ? { ...savedVoice } : undefined,
      chapters: [...authored, ...planned],
      settings: { targetAge, totalChapters: chapterCount, wordsPerChapter, freedom },
      createdAt: now,
      updatedAt: now,
    };
    try {
      await saveFinishProject(project);
    } catch (err) {
      setFormError(errorText(err, 'Projektet kunde inte sparas i webbläsaren'));
      return;
    }
    window.scrollTo({ top: 0 });
    const first: Pipeline = { project, voice: savedVoice ? 'skipped' : 'pending', timeline: 'pending', startedAt: Date.now() };
    setPipeline(first);
    await proceed(first, false);
  };

  const proceed = async (state: Pipeline, skipVoice: boolean) => {
    let project = state.project;

    if (!project.voice && !skipVoice) {
      setPipeline({ ...state, voice: 'running', error: undefined, startedAt: Date.now() });
      try {
        const text = project.chapters.filter(c => c.source === 'author').map(c => `${c.title}\n\n${c.text}`).join('\n\n');
        const name = author.trim() ? `${author.trim()} – ${project.title}` : `Språket i ${project.title}`;
        const body: VoiceRequest = { text, name };
        const { ok, data } = await postJson<VoiceResponse>('/api/author/voice', body);
        if (!ok || !data.voice) throw new Error(data.error || 'Språket kunde inte analyseras – försök igen');
        const voice = voiceFromResponse(data.voice, name, project.title);
        project = { ...project, voice };
        await saveFinishProject(project);
        if (rememberVoice) {
          await saveAuthorVoice(voice).catch(err => console.error('Kunde inte spara språket:', err));
          onVoicesChanged();
        }
      } catch (err) {
        setPipeline({ ...state, project, voice: 'error', error: errorText(err, 'Språket kunde inte analyseras – försök igen') });
        return;
      }
    }

    const voiceState: StepState = project.voice ? (state.voice === 'skipped' ? 'skipped' : 'done') : 'skipped';
    setPipeline({ project, voice: voiceState, timeline: 'running', error: undefined, startedAt: Date.now() });
    try {
      const body: TimelineRequest = { project: buildContext(project), mode: 'fill' };
      const { ok, data } = await postJson<TimelineResponse>('/api/author/timeline', body);
      if (!ok || !Array.isArray(data.chapters)) throw new Error(data.error || 'Tidslinjen kunde inte skapas – försök igen');
      const chapters = applyTimeline(project.chapters, data.chapters);
      project = { ...project, chapters, settings: { ...project.settings, totalChapters: Math.max(project.settings.totalChapters, chapters.length) } };
      await saveFinishProject(project);
    } catch (err) {
      setPipeline({ project, voice: voiceState, timeline: 'error', error: errorText(err, 'Tidslinjen kunde inte skapas – försök igen'), startedAt: Date.now() });
      return;
    }

    setPipeline({ project, voice: voiceState, timeline: 'done', startedAt: Date.now() });
    window.setTimeout(() => onCreated(project), 700);
  };

  if (pipeline) {
    return <PipelineView pipeline={pipeline} onRetry={() => proceed(pipeline, pipeline.voice === 'skipped')} onSkip={() => (pipeline.voice === 'error' ? proceed(pipeline, true) : onCreated(pipeline.project))} onOpen={() => onCreated(pipeline.project)} />;
  }

  return (
    <div className="space-y-8 pb-16 md:pb-0">
      <StepHeader
        eyebrow="Slutför din bok"
        title="Ny bok att slutföra"
        description="Klistra in din början – inledningen och början av första kapitlet. AI:n lär sig ditt språk från den och hjälper dig planera och skriva resten."
        onBack={onCancel}
        backLabel="Alla projekt"
      />

      <div className="grid lg:grid-cols-[minmax(0,1fr)_320px] gap-8 items-start">
        <div className="space-y-8 min-w-0">
          <section className="grid sm:grid-cols-2 gap-4">
            <div>
              <FieldLabel htmlFor="nf-title">Titel</FieldLabel>
              <input id="nf-title" className="field" value={title} onChange={e => setTitle(e.target.value)} placeholder="T.ex. Bydalen" />
            </div>
            <div>
              <FieldLabel htmlFor="nf-author">Författare</FieldLabel>
              <input id="nf-author" className="field" value={author} onChange={e => setAuthor(e.target.value)} placeholder="Ditt namn" autoComplete="name" />
            </div>
          </section>

          {/* Början */}
          <section>
            <div className="flex flex-wrap items-end justify-between gap-2 mb-2">
              <FieldLabel htmlFor="nf-beginning" hint="Rubriker som Prolog, Inledning eller Kapitel 1 delar upp texten i kapitel.">Din början</FieldLabel>
              {process.env.NODE_ENV !== 'production' && !beginning && (
                <button type="button" onClick={loadSample} disabled={loadingSample} className="btn-ghost !py-1.5 !px-3 text-xs mb-2">
                  {loadingSample ? <span className="spinner !w-3.5 !h-3.5" /> : <Icon name="science" size={16} />} Exempeltext (dev)
                </button>
              )}
            </div>
            <textarea
              id="nf-beginning"
              ref={beginningRef}
              value={beginning}
              onChange={e => setBeginning(e.target.value)}
              onPaste={e => { const v = pasteManuscript(e, beginning); if (v !== null) setBeginning(v); }}
              className="field min-h-[16rem] sm:min-h-[22rem] resize-y text-[15px] leading-relaxed"
              placeholder={'Prolog\n\nKlistra in din inledning här...\n\nKapitel 1 – Titel\n\nOch början av första kapitlet.'}
              spellCheck
              lang="sv"
            />
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className={`tabular-nums ${beginningWords && beginningWords < 300 ? 'text-amber-700' : 'text-ink/50'}`}>
                {fmt(beginningWords)} ord
                {beginningWords > 0 && beginningWords < 300 && ' · ju mer text, desto bättre lär sig AI:n ditt språk'}
              </span>
            </div>
            {missingBeginningDialogue > 0 && (
              <div className="mt-3 note-warning !font-normal flex flex-col sm:flex-row sm:items-center gap-2">
                <p className="flex-1">
                  <span className="font-semibold">{missingBeginningDialogue} {missingBeginningDialogue === 1 ? 'replik verkar sakna' : 'repliker verkar sakna'} talstreck.</span>{' '}
                  Skrev du dem som punktlista i Word eller Pages? Punkterna försvinner när texten klistras in.
                </p>
                <button type="button" onClick={() => setBeginning(restoreDialogueMarkers(beginning).text)} className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-900 text-white text-xs font-semibold hover:bg-amber-950">
                  <Icon name="format_list_bulleted" size={15} /> Lägg till talstreck
                </button>
              </div>
            )}
            {parts.length > 0 && (
              <div className="mt-3 rounded-2xl bg-white border border-line p-3">
                <p className="text-xs font-semibold text-ink/55 mb-2 flex items-center gap-1.5">
                  <Icon name="splitscreen" size={15} /> {parts.length === 1 ? 'Blir 1 kapitel' : `Blir ${parts.length} kapitel`}
                </p>
                <ol className="flex flex-wrap gap-1.5">
                  {parts.map((p, i) => (
                    <li key={i} className="inline-flex items-center gap-1.5 pl-2.5 pr-2 py-1 rounded-full bg-ink text-white text-xs font-medium max-w-full">
                      <span className="truncate">{p.title}</span>
                      <span className="text-white/55 tabular-nums shrink-0">{p.text.trim() ? `${fmt(countWords(p.text))} ord` : 'tom'}</span>
                    </li>
                  ))}
                  {toWrite > 0 && (
                    <li className="inline-flex items-center px-2.5 py-1 rounded-full border border-dashed border-ink/25 text-ink/55 text-xs font-medium">
                      + {toWrite} att skriva
                    </li>
                  )}
                </ol>
              </div>
            )}
          </section>

          <section className="space-y-5">
            <div>
              <FieldLabel htmlFor="nf-premise" hint="Några meningar räcker. AI:n planerar tidslinjen utifrån det här.">Vad handlar boken om och vart är den på väg?</FieldLabel>
              <textarea
                id="nf-premise"
                value={premise}
                onChange={e => setPremise(e.target.value)}
                className="field min-h-[7rem] resize-y text-sm leading-relaxed"
                placeholder="T.ex. Otis storasyster har försvunnit. Han börjar leta på egen hand och upptäcker att skogen bakom byn gömmer en hemlighet."
              />
            </div>
            <div>
              <FieldLabel htmlFor="nf-ending">
                Hur slutar den? <span className="font-normal text-ink/40">(valfritt)</span>
              </FieldLabel>
              <textarea
                id="nf-ending"
                value={ending}
                onChange={e => setEnding(e.target.value)}
                className="field min-h-[5rem] resize-y text-sm leading-relaxed"
                placeholder="Lämna tomt om du inte vet än – AI:n föreslår ett slut som passar."
              />
            </div>
          </section>
        </div>

        {/* Inställningar */}
        <aside className="space-y-6 lg:sticky lg:top-20 rounded-3xl bg-white border border-line p-5 shadow-soft">
          <div>
            <p className="text-sm font-semibold text-ink/80 mb-2">Ålder</p>
            <div className="flex flex-wrap gap-2">
              {AGE_OPTIONS.map(age => (
                <button key={age} type="button" onClick={() => setTargetAge(age)} className={`${targetAge === age ? 'chip-on' : 'chip'} !px-3 !py-1.5`} aria-pressed={targetAge === age}>
                  {age}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-4">
            <p className="text-sm font-semibold text-ink/80 -mb-2">Längd</p>
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-ink/60">Kapitel totalt</span>
              <Stepper value={chapterCount} min={minChapters} max={60} label="antal kapitel" onChange={setTotalChapters} />
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-ink/60">
                Ord per kapitel
                {wordsOverride === null && parts.some(p => p.text.trim()) && <span className="block text-[11px] text-ink/40">som dina kapitel</span>}
              </span>
              <Stepper value={wordsPerChapter} min={100} max={8000} step={50} label="ord per kapitel" onChange={setWordsOverride} />
            </div>
            <p className="text-xs text-ink/45">Boken blir ca {fmt(chapterCount * wordsPerChapter)} ord.</p>
          </div>

          <div>
            <p className="text-sm font-semibold text-ink/80 mb-2">Frihet</p>
            <FreedomPicker value={freedom} onChange={setFreedom} stacked />
          </div>

          <div>
            <p className="text-sm font-semibold text-ink/80 mb-2">Författarspråk</p>
            <div className="space-y-2" role="radiogroup">
              <VoiceOption
                on={voiceChoice === 'analyze'}
                onClick={() => setVoiceChoice('analyze')}
                icon="psychology"
                title="Analysera från min text"
                text="AI:n lär sig hur du skriver från början du klistrat in."
              />
              {voices.map(v => (
                <VoiceOption
                  key={v.id}
                  on={voiceChoice === v.id}
                  onClick={() => setVoiceChoice(v.id)}
                  icon="record_voice_over"
                  title={v.name}
                  text={v.profile?.summary || (v.sourceTitle ? `Från ${v.sourceTitle}` : 'Sparat språk')}
                />
              ))}
            </div>
            {voiceChoice === 'analyze' && (
              <label className="mt-3 flex items-start gap-2 text-sm text-ink/70 cursor-pointer">
                <input type="checkbox" checked={rememberVoice} onChange={e => setRememberVoice(e.target.checked)} className="mt-0.5 w-4 h-4 accent-brand" />
                <span>Spara språket så att jag kan använda det i fler böcker</span>
              </label>
            )}
          </div>
        </aside>
      </div>

      <div className="space-y-3 max-w-2xl">
        {formError && <div className="note-error" role="alert">{formError}</div>}
        <button type="button" onClick={create} disabled={!beginning.trim()} className="btn-action w-full sm:w-auto !px-8 !py-3.5 text-base">
          <Icon name="auto_awesome" filled size={20} /> Skapa tidslinjen
        </button>
        <p className="text-xs text-ink/45">
          {savedVoice ? `Använder ${savedVoice.name}. ` : 'AI:n analyserar ditt språk, '}
          {savedVoice ? 'AI:n' : 'och'} föreslår sedan en plan för {toWrite > 0 ? `de ${toWrite} kapitel som återstår` : 'resten'}. Du kan ändra allt efteråt.
        </p>
      </div>
    </div>
  );
}

function VoiceOption({ on, onClick, icon, title, text }: { on: boolean; onClick: () => void; icon: string; title: string; text: string }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      onClick={onClick}
      className={`w-full flex items-start gap-3 text-left rounded-2xl border p-3 transition-all ${on ? 'border-brand bg-brand/[0.05] ring-4 ring-brand/10' : 'border-line bg-white hover:border-ink/30'}`}
    >
      <span className={`w-9 h-9 shrink-0 rounded-xl flex items-center justify-center ${on ? 'bg-brand text-white' : 'bg-paper text-ink/55'}`}>
        <Icon name={icon} size={20} />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-ink truncate">{title}</span>
        <span className="block text-xs text-ink/55 line-clamp-2 mt-0.5">{text}</span>
      </span>
    </button>
  );
}

// ── Förloppet medan projektet skapas ──

function PipelineView({ pipeline, onRetry, onSkip, onOpen }: { pipeline: Pipeline; onRetry: () => void; onSkip: () => void; onOpen: () => void }) {
  const { project, voice, timeline, error } = pipeline;
  const running = voice === 'running' || timeline === 'running';
  const seconds = useElapsed(running ? pipeline.startedAt : null);
  const authored = project.chapters.filter(c => c.status === 'written');
  const words = authored.reduce((s, c) => s + countWords(c.text), 0);
  const planned = project.chapters.length - authored.length;

  const steps: { state: StepState; title: string; text: string }[] = [
    { state: 'done', title: 'Din början är uppdelad', text: `${authored.length} kapitel · ${fmt(words)} ord` },
    {
      state: voice,
      title: voice === 'skipped' && project.voice ? `Använder ${project.voice.name}` : voice === 'skipped' ? 'Hoppade över språkanalysen' : 'Lär sig ditt författarspråk',
      text: voice === 'done' && project.voice ? project.voice.profile.summary || 'Klart' : voice === 'running' ? 'Lyssnar på rytmen, replikerna och ordvalen...' : voice === 'skipped' ? 'Sparat språk' : '',
    },
    {
      state: timeline,
      title: 'Planerar resten av tidslinjen',
      text: timeline === 'running' ? `Föreslår vad som händer i ${planned} kapitel...` : timeline === 'done' ? 'Klart – öppnar skrivbordet' : '',
    },
  ];

  return (
    <div className="max-w-xl mx-auto py-6 sm:py-12 pb-24 md:pb-12">
      <p className="eyebrow">Slutför din bok</p>
      <h2 className="mt-2 text-3xl sm:text-4xl font-heading font-bold tracking-tight text-ink leading-tight">{project.title}</h2>
      <p className="mt-2 text-ink/60">Det här tar oftast en eller ett par minuter. Projektet är redan sparat.</p>

      <ol className="mt-8 space-y-3">
        {steps.map((s, i) => (
          <li
            key={i}
            className={`flex items-start gap-3 rounded-2xl border p-4 transition-all ${
              s.state === 'running' ? 'bg-white border-brand/30 shadow-soft' : s.state === 'error' ? 'bg-red-50 border-red-200' : 'bg-white/60 border-line'
            }`}
          >
            <span
              className={`w-8 h-8 shrink-0 rounded-full flex items-center justify-center ${
                s.state === 'done' || s.state === 'skipped'
                  ? 'bg-emerald-600 text-white'
                  : s.state === 'running'
                    ? 'bg-brand/10 text-brand'
                    : s.state === 'error'
                      ? 'bg-red-600 text-white'
                      : 'bg-ink/[0.06] text-ink/40'
              }`}
            >
              {s.state === 'running' ? <span className="spinner !w-4 !h-4" /> : <Icon name={s.state === 'error' ? 'priority_high' : s.state === 'pending' ? 'more_horiz' : 'check'} size={18} />}
            </span>
            <div className="min-w-0 flex-1">
              <p className={`font-semibold ${s.state === 'pending' ? 'text-ink/45' : 'text-ink'}`}>{s.title}</p>
              {s.text && <p className="text-sm text-ink/55 mt-0.5 line-clamp-3">{s.text}</p>}
              {s.state === 'running' && <p className="text-xs text-brand/70 mt-1 tabular-nums">{seconds} s</p>}
            </div>
          </li>
        ))}
      </ol>

      {error && (
        <div className="mt-6 space-y-3">
          <div className="note-error" role="alert">{error}</div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={onRetry} className="btn-action">
              <Icon name="refresh" size={19} /> Försök igen
            </button>
            <button type="button" onClick={onSkip} className="btn-ghost">
              {voice === 'error' ? 'Fortsätt utan språkanalys' : 'Öppna ändå – planera själv'}
            </button>
          </div>
        </div>
      )}
      {timeline === 'done' && (
        <button type="button" onClick={onOpen} className="btn-primary mt-6">
          Öppna skrivbordet <Icon name="arrow_forward" size={19} />
        </button>
      )}
    </div>
  );
}
