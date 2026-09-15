'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AuthorVoice,
  ChapterRequest,
  ChapterResponse,
  FinishProject,
  FinishSettings,
  RewriteRequest,
  RewriteResponse,
  TimelineChapter,
  TimelineRequest,
  TimelineResponse,
  VoiceRequest,
  VoiceResponse,
} from '@/lib/author-types';
import { saveAuthorVoice, saveFinishProject } from '@/lib/storage';
import { postJson } from '@/lib/fetch-json';
import Icon from '../Icon';
import StepHeader from '../StepHeader';
import TimelinePanel from './TimelinePanel';
import ChapterEditor, { TextRange, VariantsState } from './ChapterEditor';
import SettingsModal, { SettingsTab } from './SettingsModal';
import { BusyNote, ChapterDot, useArmed, useMediaQuery } from './ui';
import {
  applyTimeline,
  authorText,
  buildContext,
  countWords,
  errorText,
  fmt,
  insertTitle,
  manuscriptText,
  newId,
  newPlannedChapter,
  nowIso,
  projectStats,
  pushHistory,
  renumber,
  rewriteProject,
  voiceFromResponse,
  withText,
} from './finish-utils';

export interface CreateBookInput {
  rawText: string;
  title: string;
  author: string;
  targetAge: string;
}

interface Props {
  initial: FinishProject;
  voices: AuthorVoice[];
  onVoicesChanged: () => void;
  onBack: () => void;
  onCreateBook: (m: CreateBookInput) => void;
}

type Busy =
  | { kind: 'chapter' | 'polish' | 'selection'; chapterId: string; label: string; startedAt: number }
  | { kind: 'timeline' | 'voice'; label: string; startedAt: number };

interface Message {
  scope: 'editor' | 'timeline' | 'top' | 'voice';
  kind: 'error' | 'success';
  text: string;
  chapterId?: string;
}

export default function FinishWorkspace({ initial, voices, onVoicesChanged, onBack, onCreateBook }: Props) {
  const [project, setProject] = useState<FinishProject>(initial);
  const projectRef = useRef(initial);
  const dirtyRef = useRef(false);
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saved');

  const [selectedId, setSelectedId] = useState<string | null>(
    () => (initial.chapters.find(c => c.status === 'planned') ?? initial.chapters[0])?.id ?? null,
  );
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;

  const [busy, setBusyState] = useState<Busy | null>(null);
  const busyRef = useRef<Busy | null>(null);
  const [message, setMessage] = useState<Message | null>(null);
  const [truncated, setTruncated] = useState<Set<string>>(new Set());
  const [selection, setSelection] = useState<(TextRange & { chapterId: string }) | null>(null);
  const [variants, setVariants] = useState<VariantsState | null>(null);
  const [focusRange, setFocusRange] = useState<(TextRange & { key: number }) | null>(null);
  const [run, setRun] = useState<{ done: number; total: number; stopping: boolean } | null>(null);
  const stopRef = useRef(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const editBase = useRef<{ id: string; text: string } | null>(null);
  const editorTopRef = useRef<HTMLDivElement>(null);
  const chipRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const { armed, confirm } = useArmed();
  const isDesktop = useMediaQuery('(min-width: 1024px)');

  // ── Tillstånd + autospar ──

  // Alla ändringar går via update() så att projectRef alltid är aktuell
  // (AI-anrop i följd bygger sin kontext från den)
  const update = useCallback((fn: (p: FinishProject) => FinishProject) => {
    const prev = projectRef.current;
    const next = fn(prev);
    if (next === prev) return;
    projectRef.current = next;
    dirtyRef.current = true;
    setProject(next);
  }, []);

  const updateChapter = useCallback((id: string, fn: (c: TimelineChapter) => TimelineChapter) => {
    update(p => ({ ...p, chapters: p.chapters.map(c => (c.id === id ? fn(c) : c)) }));
  }, [update]);

  const flush = useCallback(async () => {
    if (!dirtyRef.current) return;
    dirtyRef.current = false;
    try {
      await saveFinishProject(projectRef.current);
      setSaveState(dirtyRef.current ? 'saving' : 'saved');
    } catch (err) {
      console.error('Kunde inte spara projektet:', err);
      dirtyRef.current = true;
      setSaveState('error');
    }
  }, []);

  useEffect(() => {
    if (!dirtyRef.current) return;
    setSaveState('saving');
    const t = window.setTimeout(flush, 800);
    return () => window.clearTimeout(t);
  }, [project, flush]);

  useEffect(() => {
    const onHide = () => {
      if (dirtyRef.current) saveFinishProject(projectRef.current).catch(() => {});
    };
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        flush();
      }
    };
    window.addEventListener('pagehide', onHide);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pagehide', onHide);
      window.removeEventListener('keydown', onKey);
      onHide();
    };
  }, [flush]);

  const startBusy = (b: Busy) => {
    busyRef.current = b;
    setBusyState(b);
  };
  const endBusy = () => {
    busyRef.current = null;
    setBusyState(null);
  };

  // ── Val av kapitel ──

  // Manuella ändringar sedan senaste versionen läggs i historiken när man lämnar kapitlet
  const commitEdit = useCallback(() => {
    const base = editBase.current;
    if (!base) return;
    editBase.current = null;
    const ch = projectRef.current.chapters.find(c => c.id === base.id);
    if (ch && ch.text !== base.text && base.text.trim()) {
      updateChapter(base.id, c => ({ ...c, history: pushHistory(c.history, base.text) }));
    }
  }, [updateChapter]);

  const selectChapter = useCallback((id: string, opts: { scroll?: boolean } = {}) => {
    if (id !== selectedRef.current) {
      commitEdit();
      setSelection(null);
    }
    setSelectedId(id);
    selectedRef.current = id;
    setSheetOpen(false);
    if (opts.scroll !== false) {
      const top = editorTopRef.current?.getBoundingClientRect().top;
      if (top !== undefined && top < 0) window.scrollTo({ top: window.scrollY + top - 80, behavior: 'smooth' });
    }
  }, [commitEdit]);

  useEffect(() => {
    if (!selectedId || isDesktop) return;
    chipRefs.current.get(selectedId)?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }, [selectedId, isDesktop]);

  // ── Manuell redigering ──

  const handleText = (id: string, text: string) => {
    updateChapter(id, c => {
      if (!editBase.current || editBase.current.id !== id) editBase.current = { id, text: c.text };
      let history = c.history;
      if (Math.abs(text.length - c.text.length) >= 80) {
        // Stor ändring på en gång (inklistring, radering)
        history = pushHistory(history, c.text);
        editBase.current = { id, text };
      } else if (Math.abs(text.length - editBase.current.text.length) >= 400) {
        history = pushHistory(history, editBase.current.text);
        editBase.current = { id, text };
      }
      const startedWriting = !c.text.trim() && !!text.trim();
      return {
        ...c,
        text,
        history,
        status: text.trim() ? 'written' : 'planned',
        source: startedWriting ? 'author' : c.source,
        updatedAt: nowIso(),
      };
    });
  };

  const undo = (id: string) => {
    editBase.current = null;
    updateChapter(id, c => {
      if (!c.history.length) return c;
      const text = c.history[c.history.length - 1];
      return { ...c, text, history: c.history.slice(0, -1), status: text.trim() ? 'written' : 'planned', updatedAt: nowIso() };
    });
    setSelection(null);
    setVariants(null);
    setMessage(null);
  };

  // ── AI: kapitel ──

  const writeChapter = useCallback(async (id: string, comment?: string): Promise<boolean> => {
    const p = projectRef.current;
    const ch = p.chapters.find(c => c.id === id);
    if (!ch || busyRef.current) return false;
    const rewriting = !!ch.text.trim();
    startBusy({ kind: 'chapter', chapterId: id, label: `${rewriting ? 'Skriver om' : 'Skriver'} ${ch.title.trim() || 'kapitlet'}...`, startedAt: Date.now() });
    setMessage(null);
    if (variants?.chapterId === id) setVariants(null);
    try {
      const body: ChapterRequest = { project: buildContext(p), chapterId: id, comment };
      const { ok, data } = await postJson<ChapterResponse>('/api/author/chapter', body);
      if (!ok || typeof data.text !== 'string' || !data.text.trim()) {
        throw new Error(data.error || 'Kapitlet kunde inte skrivas – försök igen');
      }
      if (editBase.current?.id === id) editBase.current = null;
      updateChapter(id, c => withText(c, data.text.trim(), { source: 'ai' }));
      setTruncated(prev => {
        const next = new Set(prev);
        if (data.truncated) next.add(id);
        else next.delete(id);
        return next;
      });
      if (rewriting) {
        setMessage({ scope: 'editor', kind: 'success', chapterId: id, text: 'Kapitlet är omskrivet. Den tidigare versionen finns kvar under Ångra.' });
      }
      return true;
    } catch (err) {
      setMessage({ scope: 'editor', kind: 'error', chapterId: id, text: errorText(err, 'Kapitlet kunde inte skrivas – försök igen') });
      return false;
    } finally {
      endBusy();
    }
  }, [updateChapter, variants]);

  const polish = async (id: string) => {
    const p = projectRef.current;
    const ch = p.chapters.find(c => c.id === id);
    if (!ch || !ch.text.trim() || busyRef.current) return;
    startBusy({ kind: 'polish', chapterId: id, label: `Förbättrar språket i ${ch.title.trim() || 'kapitlet'}...`, startedAt: Date.now() });
    setMessage(null);
    setSelection(null);
    setVariants(null);
    try {
      const body: RewriteRequest = { project: rewriteProject(p), chapterTitle: ch.title, before: '', selection: ch.text, after: '', mode: 'polish' };
      const { ok, data } = await postJson<RewriteResponse>('/api/author/rewrite', body);
      const text = Array.isArray(data.variants) ? data.variants.find(v => typeof v === 'string' && v.trim()) : undefined;
      if (!ok || !text) throw new Error(data.error || 'Språket kunde inte förbättras – försök igen');
      if (editBase.current?.id === id) editBase.current = null;
      updateChapter(id, c => withText(c, text.trim()));
      setMessage({ scope: 'editor', kind: 'success', chapterId: id, text: 'Språket är förbättrat.' });
    } catch (err) {
      setMessage({ scope: 'editor', kind: 'error', chapterId: id, text: errorText(err, 'Språket kunde inte förbättras – försök igen') });
    } finally {
      endBusy();
    }
  };

  // ── AI: markering ──

  const rewriteSelection = async (mode: 'comment' | 'variants', comment?: string) => {
    const sel = selection;
    const p = projectRef.current;
    const ch = sel && p.chapters.find(c => c.id === sel.chapterId);
    if (!sel || !ch || busyRef.current) return;
    const original = ch.text.slice(sel.start, sel.end);
    if (!original.trim()) return;
    startBusy({
      kind: 'selection',
      chapterId: ch.id,
      label: mode === 'comment' ? 'Skriver om markeringen...' : 'Slumpar nya versioner...',
      startedAt: Date.now(),
    });
    setMessage(null);
    try {
      const body: RewriteRequest = {
        project: rewriteProject(p),
        chapterTitle: ch.title,
        before: ch.text.slice(Math.max(0, sel.start - 1500), sel.start),
        selection: original,
        after: ch.text.slice(sel.end, sel.end + 800),
        mode,
        comment,
      };
      const { ok, data } = await postJson<RewriteResponse>('/api/author/rewrite', body);
      const list = Array.isArray(data.variants) ? data.variants.filter((v): v is string => typeof v === 'string' && !!v.trim()) : [];
      if (!ok || list.length === 0) throw new Error(data.error || 'Det gick inte att skriva om markeringen – försök igen');
      setVariants({ chapterId: ch.id, start: sel.start, end: sel.end, original, mode, comment, list });
    } catch (err) {
      setMessage({ scope: 'editor', kind: 'error', chapterId: ch.id, text: errorText(err, 'Det gick inte att skriva om markeringen – försök igen') });
    } finally {
      endBusy();
    }
  };

  const applyVariant = (variant: string) => {
    const vs = variants;
    const ch = vs && projectRef.current.chapters.find(c => c.id === vs.chapterId);
    if (!vs || !ch) return;
    let start = vs.start;
    let end = vs.end;
    // Texten kan ha ändrats sedan markeringen - leta upp originalet igen
    if (ch.text.slice(start, end) !== vs.original) {
      const idx = ch.text.indexOf(vs.original);
      if (idx < 0) {
        setMessage({ scope: 'editor', kind: 'error', chapterId: ch.id, text: 'Texten har ändrats sedan du markerade. Markera stycket igen.' });
        setVariants(null);
        return;
      }
      start = idx;
      end = idx + vs.original.length;
    }
    const lead = vs.original.match(/^\s*/)?.[0] ?? '';
    const trail = vs.original.match(/\s*$/)?.[0] ?? '';
    const body = variant.trim();
    const next = ch.text.slice(0, start) + lead + body + trail + ch.text.slice(end);
    if (editBase.current?.id === ch.id) editBase.current = null;
    updateChapter(ch.id, c => withText(c, next));
    setVariants(null);
    const range = { start: start + lead.length, end: start + lead.length + body.length };
    setSelection({ chapterId: ch.id, ...range });
    setFocusRange({ ...range, key: Date.now() });
  };

  // ── AI: skriv flera ──

  const writeNext = async () => {
    const next = projectRef.current.chapters.find(c => c.status === 'planned');
    if (!next) return;
    selectChapter(next.id);
    await writeChapter(next.id);
  };

  const writeAll = async () => {
    if (busyRef.current) return;
    stopRef.current = false;
    const total = projectRef.current.chapters.filter(c => c.status === 'planned').length;
    if (!total) return;
    setRun({ done: 0, total, stopping: false });
    setMessage(null);
    let done = 0;
    let lastId: string | null = null;
    let failed = false;
    while (!stopRef.current) {
      const next = projectRef.current.chapters.find(c => c.status === 'planned');
      if (!next) break;
      // Följ med till nästa kapitel bara om författaren tittar på det som just skrevs
      if (lastId === null || selectedRef.current === lastId) selectChapter(next.id, { scroll: false });
      lastId = next.id;
      const ok = await writeChapter(next.id);
      if (!ok) {
        failed = true;
        break;
      }
      done++;
      setRun(r => (r ? { ...r, done } : r));
    }
    setRun(null);
    if (!failed) {
      const left = projectRef.current.chapters.filter(c => c.status === 'planned').length;
      setMessage({
        scope: 'top',
        kind: 'success',
        text: left === 0
          ? `Klart! Alla kapitel är skrivna – läs igenom och förbättra det som inte känns rätt.`
          : `Stoppade efter ${done} kapitel. ${left} kvar att skriva.`,
      });
    }
  };

  const stopAll = () => {
    stopRef.current = true;
    setRun(r => (r ? { ...r, stopping: true } : r));
  };

  // ── Tidslinje ──

  const runTimeline = async (mode: TimelineRequest['mode'], instruction?: string): Promise<boolean> => {
    if (busyRef.current) return false;
    startBusy({ kind: 'timeline', label: mode === 'fill' ? 'Föreslår tidslinje...' : 'Ändrar tidslinjen...', startedAt: Date.now() });
    setMessage(null);
    try {
      const body: TimelineRequest = { project: buildContext(projectRef.current), mode, instruction };
      const { ok, data } = await postJson<TimelineResponse>('/api/author/timeline', body);
      if (!ok || !Array.isArray(data.chapters)) throw new Error(data.error || 'Tidslinjen kunde inte skapas – försök igen');
      update(p => {
        const chapters = applyTimeline(p.chapters, data.chapters);
        return { ...p, chapters, settings: { ...p.settings, totalChapters: Math.max(p.settings.totalChapters, chapters.length) } };
      });
      return true;
    } catch (err) {
      setMessage({ scope: 'timeline', kind: 'error', text: errorText(err, 'Tidslinjen kunde inte skapas – försök igen') });
      return false;
    } finally {
      endBusy();
    }
  };

  const addChapter = (afterId: string | null) => {
    const p = projectRef.current;
    const found = afterId ? p.chapters.findIndex(c => c.id === afterId) : -1;
    const idx = found >= 0 ? found + 1 : p.chapters.length;
    const ch = newPlannedChapter(insertTitle(p.chapters, idx));
    update(prev => {
      const after = [...prev.chapters.slice(0, idx), ch, ...prev.chapters.slice(idx)];
      const chapters = renumber(prev.chapters, after);
      return { ...prev, chapters, settings: { ...prev.settings, totalChapters: chapters.length } };
    });
    selectChapter(ch.id);
  };

  const moveChapter = (id: string, dir: -1 | 1) => {
    update(p => {
      const i = p.chapters.findIndex(c => c.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= p.chapters.length) return p;
      const after = [...p.chapters];
      [after[i], after[j]] = [after[j], after[i]];
      return { ...p, chapters: renumber(p.chapters, after) };
    });
  };

  const removeChapter = (id: string) => {
    const p = projectRef.current;
    const i = p.chapters.findIndex(c => c.id === id);
    if (i < 0) return;
    if (editBase.current?.id === id) editBase.current = null;
    update(prev => {
      const chapters = renumber(prev.chapters, prev.chapters.filter(c => c.id !== id));
      return { ...prev, chapters, settings: { ...prev.settings, totalChapters: Math.max(1, chapters.length) } };
    });
    if (selectedRef.current === id) {
      const neighbor = p.chapters[i + 1] ?? p.chapters[i - 1];
      setSelectedId(neighbor?.id ?? null);
      selectedRef.current = neighbor?.id ?? null;
    }
    if (selection?.chapterId === id) setSelection(null);
    if (variants?.chapterId === id) setVariants(null);
  };

  // ── Författarspråk ──

  const reanalyzeVoice = async () => {
    const p = projectRef.current;
    const text = authorText(p.chapters);
    if (countWords(text) < 150 || busyRef.current) return;
    startBusy({ kind: 'voice', label: 'Lär sig ditt språk...', startedAt: Date.now() });
    setMessage(null);
    try {
      const body: VoiceRequest = { text, name: p.voice?.name || undefined };
      const { ok, data } = await postJson<VoiceResponse>('/api/author/voice', body);
      if (!ok || !data.voice) throw new Error(data.error || 'Språket kunde inte analyseras – försök igen');
      const voice = voiceFromResponse(data.voice, p.voice?.name || `${p.author || 'Mitt'} språk`, p.title);
      update(prev => ({ ...prev, voice }));
    } catch (err) {
      setMessage({ scope: 'voice', kind: 'error', text: errorText(err, 'Språket kunde inte analyseras – försök igen') });
    } finally {
      endBusy();
    }
  };

  const saveVoice = async (asNew: boolean): Promise<boolean> => {
    const p = projectRef.current;
    if (!p.voice) return false;
    const voice: AuthorVoice = {
      ...p.voice,
      id: asNew ? newId() : p.voice.id,
      name: p.voice.name.trim() || `${p.author || 'Mitt'} språk`,
      sourceTitle: p.voice.sourceTitle || p.title,
      createdAt: asNew ? nowIso() : p.voice.createdAt,
    };
    try {
      await saveAuthorVoice(voice);
      update(prev => ({ ...prev, voice }));
      onVoicesChanged();
      return true;
    } catch (err) {
      setMessage({ scope: 'voice', kind: 'error', text: errorText(err, 'Språket kunde inte sparas') });
      return false;
    }
  };

  // ── Gör en bok ──

  const stats = projectStats(project);

  const createBook = async () => {
    const p = projectRef.current;
    const s = projectStats(p);
    if (s.written === 0) {
      setMessage({ scope: 'top', kind: 'error', text: 'Det finns ingen text än – skriv minst ett kapitel först.' });
      return;
    }
    if (s.planned > 0 && !confirm('book')) return;
    commitEdit();
    await flush();
    onCreateBook({
      rawText: manuscriptText(p.chapters),
      title: p.title.trim() || 'Namnlös bok',
      author: p.author.trim(),
      targetAge: p.settings.targetAge,
    });
  };

  // ── Render ──

  const chapters = project.chapters;
  const selectedIndex = chapters.findIndex(c => c.id === selectedId);
  const selected = selectedIndex >= 0 ? chapters[selectedIndex] : null;
  const busyChapterId = busy && 'chapterId' in busy ? busy.chapterId : null;
  const nextPlanned = chapters.find(c => c.status === 'planned');
  const busyChapter = busyChapterId ? chapters.find(c => c.id === busyChapterId) : null;
  const editorMessage = message?.scope === 'editor' && message.chapterId === selectedId ? message : null;

  const timeline = (
    <TimelinePanel
      chapters={chapters}
      selectedId={selectedId}
      premise={project.premise}
      ending={project.ending || ''}
      totalChapters={project.settings.totalChapters}
      timelineBusy={busy?.kind === 'timeline' ? busy : null}
      aiLocked={!!busy}
      lockedChapterId={busyChapterId}
      error={message?.scope === 'timeline' ? message.text : undefined}
      onDismissError={() => setMessage(null)}
      onSelect={id => selectChapter(id)}
      onUpdate={(id, patch) => updateChapter(id, c => ({ ...c, ...patch }))}
      onMove={moveChapter}
      onRemove={removeChapter}
      onAdd={addChapter}
      onFill={() => runTimeline('fill')}
      onRework={instruction => runTimeline('rework', instruction)}
      onPremise={premise => update(p => ({ ...p, premise }))}
      onEnding={ending => update(p => ({ ...p, ending }))}
      armed={armed}
      confirm={confirm}
    />
  );

  return (
    <div className="space-y-6 pb-16 md:pb-0">
      <StepHeader
        eyebrow="Slutför din bok"
        title={project.title || 'Namnlös bok'}
        onBack={async () => { commitEdit(); await flush(); onBack(); }}
        backLabel="Alla projekt"
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <span className="tabular-nums">
              <span className="font-semibold text-ink">{stats.written} av {stats.total}</span> kapitel · {fmt(stats.words)} ord
            </span>
            {project.author && <span className="text-ink/45">av {project.author}</span>}
            <SaveIndicator state={saveState} onRetry={flush} />
          </span>
        }
        actions={
          <>
            {nextPlanned ? (
              <>
                <button type="button" onClick={writeNext} disabled={!!busy} className="btn-action grow sm:grow-0 whitespace-nowrap">
                  <Icon name="auto_awesome" filled size={19} /> Skriv nästa kapitel
                </button>
                {stats.planned > 1 && (
                  <button type="button" onClick={writeAll} disabled={!!busy} className="btn-ghost grow sm:grow-0 whitespace-nowrap">
                    <Icon name="playlist_play" size={20} /> Skriv alla återstående
                  </button>
                )}
              </>
            ) : null}
            <button type="button" onClick={() => setSettingsTab('book')} className="btn-ghost !px-3" aria-label="Inställningar" title="Inställningar och författarspråk">
              <Icon name="tune" size={20} />
            </button>
            <button
              type="button"
              onClick={createBook}
              disabled={!!busy}
              className={`${armed === 'book' ? 'btn-danger !bg-amber-600 hover:!bg-amber-700 animate-pop' : nextPlanned ? 'btn-primary' : 'btn-action'} grow sm:grow-0 whitespace-nowrap`}
            >
              <Icon name="menu_book" size={19} />
              {armed === 'book' ? `${stats.planned} kapitel saknas – skapa ändå?` : 'Gör en bok av texten'}
            </button>
          </>
        }
      />

      {/* Kapitel som staplar */}
      <div className="flex gap-1" aria-hidden>
        {chapters.map(c => (
          <button
            key={c.id}
            type="button"
            tabIndex={-1}
            onClick={() => selectChapter(c.id)}
            title={c.title}
            className={`h-1.5 flex-1 rounded-full transition-all ${
              c.id === busyChapterId ? 'bg-brand/40 animate-pulse' : c.status === 'planned' ? 'bg-ink/10 hover:bg-ink/20' : c.source === 'author' ? 'bg-ink' : 'bg-brand'
            } ${c.id === selectedId ? 'ring-2 ring-offset-2 ring-offset-paper ring-brand/40' : ''}`}
          />
        ))}
      </div>

      {/* Pågående arbete och meddelanden */}
      {run && busy && (
        <BusyNote
          label={`Skriver alla återstående · ${Math.min(run.done + 1, run.total)} av ${run.total}${busyChapter ? ` – ${busyChapter.title}` : ''}`}
          startedAt={busy.startedAt}
          hint={run.stopping ? 'Stoppar när kapitlet är klart' : 'Du kan läsa och redigera andra kapitel under tiden'}
          action={
            <button type="button" onClick={stopAll} disabled={run.stopping} className="btn-ghost !py-2 !px-3.5 text-sm shrink-0">
              <Icon name="stop_circle" size={18} /> {run.stopping ? 'Stoppar...' : 'Stopp'}
            </button>
          }
        />
      )}
      {!run && busy && busyChapterId && busyChapterId !== selectedId && (
        <BusyNote
          label={busy.label}
          startedAt={busy.startedAt}
          hint=""
          action={
            <button type="button" onClick={() => selectChapter(busyChapterId)} className="btn-ghost !py-2 !px-3.5 text-sm shrink-0">Visa</button>
          }
        />
      )}
      {message?.scope === 'top' && (
        <div className={`${message.kind === 'error' ? 'note-error' : 'note-success'} flex items-start gap-2`} role={message.kind === 'error' ? 'alert' : 'status'}>
          <Icon name={message.kind === 'error' ? 'error' : 'celebration'} size={18} className="shrink-0 mt-px" />
          <span className="flex-1">{message.text}</span>
          <button type="button" onClick={() => setMessage(null)} className="shrink-0 -m-1 p-1 rounded-full hover:bg-black/5" aria-label="Stäng">
            <Icon name="close" size={16} />
          </button>
        </div>
      )}

      <div className="lg:grid lg:grid-cols-[minmax(300px,380px)_minmax(0,1fr)] lg:gap-8 xl:gap-10 items-start">
        {isDesktop && (
          <aside className="sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto no-scrollbar -mx-2 px-2 pb-6" aria-label="Tidslinje">
            {timeline}
          </aside>
        )}

        <div className="min-w-0 space-y-4">
          {!isDesktop && (
            <div className="flex items-center gap-2 -mx-4 sm:mx-0">
              <div className="flex-1 min-w-0 flex gap-2 overflow-x-auto no-scrollbar px-4 sm:px-0 py-1">
                {chapters.map((c, i) => {
                  const on = c.id === selectedId;
                  return (
                    <button
                      key={c.id}
                      ref={el => {
                        if (el) chipRefs.current.set(c.id, el);
                        else chipRefs.current.delete(c.id);
                      }}
                      type="button"
                      onClick={() => selectChapter(c.id)}
                      aria-current={on ? 'true' : undefined}
                      className={`shrink-0 inline-flex items-center gap-2 pl-1 pr-3 py-1 rounded-full border text-sm font-medium transition-all max-w-[12rem] ${
                        on ? 'bg-white border-brand/40 shadow-soft text-ink' : 'bg-white/60 border-line text-ink/65'
                      }`}
                    >
                      {c.id === busyChapterId ? (
                        <span className="w-6 h-6 rounded-full bg-brand/10 text-brand flex items-center justify-center"><span className="spinner !w-3.5 !h-3.5" /></span>
                      ) : (
                        <span className="scale-75 -m-1"><ChapterDot chapter={c} number={i + 1} /></span>
                      )}
                      <span className="truncate">{c.title || `Kapitel ${i + 1}`}</span>
                    </button>
                  );
                })}
              </div>
              <button type="button" onClick={() => setSheetOpen(true)} className="btn-ghost !py-2 !px-3.5 text-sm shrink-0 mr-4 sm:mr-0">
                {busy?.kind === 'timeline' ? <span className="spinner !w-4 !h-4" /> : <Icon name="timeline" size={18} />} Tidslinje
              </button>
            </div>
          )}

          <div ref={editorTopRef} className="scroll-mt-24">
            {selected ? (
              <ChapterEditor
                chapter={selected}
                index={selectedIndex}
                count={chapters.length}
                targetWords={project.settings.wordsPerChapter}
                busy={busy && busyChapterId === selected.id && 'chapterId' in busy ? busy : null}
                aiLocked={!!busy}
                truncated={truncated.has(selected.id)}
                error={editorMessage?.kind === 'error' ? editorMessage.text : undefined}
                notice={editorMessage?.kind === 'success' ? editorMessage.text : undefined}
                onDismissMessage={() => setMessage(null)}
                selection={selection?.chapterId === selected.id ? selection : null}
                onSelection={range => setSelection(range ? { ...range, chapterId: selected.id } : null)}
                variants={variants?.chapterId === selected.id ? variants : null}
                focusRange={focusRange}
                onTitle={title => updateChapter(selected.id, c => ({ ...c, title }))}
                onNotes={notes => updateChapter(selected.id, c => ({ ...c, notes }))}
                onText={text => handleText(selected.id, text)}
                onSource={source => updateChapter(selected.id, c => ({ ...c, source }))}
                onWrite={comment => writeChapter(selected.id, comment)}
                onPolish={() => polish(selected.id)}
                onUndo={() => undo(selected.id)}
                onRewriteSelection={rewriteSelection}
                onUseVariant={applyVariant}
                onCloseVariants={() => setVariants(null)}
                onPrev={selectedIndex > 0 ? () => selectChapter(chapters[selectedIndex - 1].id) : undefined}
                onNext={selectedIndex < chapters.length - 1 ? () => selectChapter(chapters[selectedIndex + 1].id) : undefined}
                armed={armed}
                confirm={confirm}
              />
            ) : (
              <div className="rounded-3xl border border-dashed border-ink/20 bg-white/60 px-6 py-16 text-center">
                <Icon name="menu_book" size={30} className="text-ink/35" />
                <h3 className="mt-3 font-heading text-lg font-bold text-ink">Inga kapitel än</h3>
                <p className="text-sm text-ink/55 mt-1">Lägg till ett kapitel eller låt AI:n föreslå en tidslinje.</p>
                <div className="mt-5 flex flex-wrap justify-center gap-2">
                  <button type="button" onClick={() => addChapter(null)} className="btn-ghost"><Icon name="add" size={18} /> Lägg till kapitel</button>
                  <button type="button" onClick={() => runTimeline('fill')} disabled={!!busy} className="btn-action"><Icon name="auto_awesome" size={18} /> Föreslå tidslinje</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Tidslinje som ark på mobil */}
      {!isDesktop && sheetOpen && (
        <div className="fixed inset-0 !m-0 z-50 bg-ink/50 backdrop-blur-sm flex items-end" onClick={() => setSheetOpen(false)} role="dialog" aria-modal="true" aria-label="Tidslinje">
          <div className="relative w-full max-h-[90vh] bg-paper rounded-t-3xl shadow-lift flex flex-col animate-pop" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-3 px-4 pt-3 pb-2 border-b border-line">
              <span className="w-10 h-1 rounded-full bg-ink/15 absolute left-1/2 -translate-x-1/2 top-1.5" aria-hidden />
              <p className="font-heading font-bold text-ink">{project.title || 'Tidslinje'}</p>
              <button type="button" onClick={() => setSheetOpen(false)} className="btn-icon" aria-label="Stäng tidslinjen">
                <Icon name="close" size={22} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-4 pt-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">{timeline}</div>
          </div>
        </div>
      )}

      {settingsTab && (
        <SettingsModal
          project={project}
          voices={voices}
          initialTab={settingsTab}
          onClose={() => setSettingsTab(null)}
          onPatch={patch => update(p => ({ ...p, ...patch }))}
          onSettings={(patch: Partial<FinishSettings>) => update(p => ({ ...p, settings: { ...p.settings, ...patch } }))}
          onVoice={voice => update(p => ({ ...p, voice }))}
          onReanalyze={reanalyzeVoice}
          reanalyzing={busy?.kind === 'voice' ? busy : null}
          canReanalyze={countWords(authorText(chapters)) >= 150}
          onSaveVoice={saveVoice}
          voiceError={message?.scope === 'voice' ? message.text : undefined}
          aiLocked={!!busy}
        />
      )}
    </div>
  );
}

function SaveIndicator({ state, onRetry }: { state: 'saved' | 'saving' | 'error'; onRetry: () => void }) {
  if (state === 'error') {
    return (
      <button type="button" onClick={onRetry} className="inline-flex items-center gap-1 text-xs font-medium text-red-700 hover:underline">
        <Icon name="cloud_off" size={15} /> Kunde inte spara – försök igen
      </button>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs text-ink/40" aria-live="polite">
      {state === 'saving' ? <><span className="spinner !w-3 !h-3 !border" /> Sparar...</> : <><Icon name="cloud_done" size={15} /> Sparat</>}
    </span>
  );
}
