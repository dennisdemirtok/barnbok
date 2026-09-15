'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { TimelineChapter } from '@/lib/author-types';
import { findAiTells } from '@/lib/writing';
import { pasteManuscript } from '@/lib/dialogue';
import Icon from '../Icon';
import { BusyNote, ChapterBadge } from './ui';
import { countWords, fmt } from './finish-utils';

export interface TextRange {
  start: number;
  end: number;
}

export interface VariantsState {
  chapterId: string;
  start: number;
  end: number;
  original: string;
  mode: 'comment' | 'variants';
  comment?: string;
  list: string[];
}

export interface EditorBusy {
  kind: 'chapter' | 'polish' | 'selection';
  label: string;
  startedAt: number;
}

interface Props {
  chapter: TimelineChapter;
  index: number;
  count: number;
  targetWords: number;
  busy: EditorBusy | null; // AI-jobb på just det här kapitlet
  aiLocked: boolean; // något AI-jobb pågår (här eller någon annanstans)
  truncated: boolean;
  error?: string;
  notice?: string;
  onDismissMessage: () => void;
  selection: TextRange | null;
  onSelection: (range: TextRange | null) => void;
  variants: VariantsState | null;
  focusRange: (TextRange & { key: number }) | null;
  onTitle: (title: string) => void;
  onNotes: (notes: string) => void;
  onText: (text: string) => void;
  onSource: (source: TimelineChapter['source']) => void;
  onWrite: (comment?: string) => Promise<boolean>;
  onPolish: () => void;
  onUndo: () => void;
  onRewriteSelection: (mode: 'comment' | 'variants', comment?: string) => void;
  onUseVariant: (text: string) => void;
  onCloseVariants: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  armed: string | null;
  confirm: (key: string) => boolean;
  // Repliker som saknar talstreck i det här kapitlet / i hela boken
  missingDialogue: number;
  missingDialogueAll: number;
  onRestoreDialogue: (scope: 'chapter' | 'all') => void;
}

const WRITE_STAGES = ['Läser tidslinjen och kapitlen före', 'Lyssnar på ditt språk', 'Skriver scenerna', 'Putsar på meningarna', 'Nästan klart'];
const POLISH_STAGES = ['Läser kapitlet', 'Stryker det som låter som AI', 'Putsar på rytmen'];

export default function ChapterEditor(props: Props) {
  const {
    chapter, index, count, targetWords, busy, aiLocked, truncated, error, notice, onDismissMessage,
    selection, onSelection, variants, focusRange, onTitle, onNotes, onText, onSource, onWrite, onPolish, onUndo,
    onRewriteSelection, onUseVariant, onCloseVariants, onPrev, onNext, armed, confirm,
    missingDialogue, missingDialogueAll, onRestoreDialogue,
  } = props;

  const textRef = useRef<HTMLTextAreaElement>(null);
  const [rewriteOpen, setRewriteOpen] = useState(false);
  const [rewriteComment, setRewriteComment] = useState('');
  const [writeComment, setWriteComment] = useState('');
  const [showWriteComment, setShowWriteComment] = useState(false);
  const [selComment, setSelComment] = useState('');
  const [showTells, setShowTells] = useState(false);
  const [hideTells, setHideTells] = useState(false);

  const isEmpty = !chapter.text.trim();
  const isAuthor = chapter.source === 'author' && !isEmpty;
  const words = countWords(chapter.text);
  const busyWhole = busy && busy.kind !== 'selection';
  const busySelection = busy?.kind === 'selection';

  // Nytt kapitel → nollställ lokala paneler
  useEffect(() => {
    setRewriteOpen(false);
    setRewriteComment('');
    setWriteComment('');
    setShowWriteComment(false);
    setShowTells(false);
    setHideTells(false);
  }, [chapter.id]);

  // Textrutan växer med texten så att sidan scrollar (och markeringsraden kan klistra fast)
  const resize = () => {
    const el = textRef.current;
    if (!el) return;
    const y = window.scrollY;
    el.style.height = 'auto';
    el.style.height = `${Math.max(el.scrollHeight + 2, isEmpty ? 240 : 420)}px`;
    if (window.scrollY !== y) window.scrollTo({ top: y });
  };
  useLayoutEffect(resize);
  useEffect(() => {
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  });

  // Markera den nya texten efter "Använd"
  useEffect(() => {
    const el = textRef.current;
    if (!focusRange || !el) return;
    el.focus({ preventScroll: true });
    el.setSelectionRange(focusRange.start, focusRange.end);
  }, [focusRange]);

  const tells = useMemo(
    () => (chapter.source === 'ai' && !isEmpty ? findAiTells(chapter.text) : []),
    [chapter.source, chapter.text, isEmpty],
  );

  const readSelection = () => {
    const el = textRef.current;
    if (!el) return;
    const { selectionStart: start, selectionEnd: end } = el;
    if (end > start && el.value.slice(start, end).trim()) {
      if (!selection || selection.start !== start || selection.end !== end) onSelection({ start, end });
    } else if (document.activeElement === el && selection) {
      onSelection(null);
    }
  };

  const selectedText = selection ? chapter.text.slice(selection.start, selection.end) : '';
  const selectedWords = countWords(selectedText);
  const showSelectionBar = !isEmpty && (!!selection || !!variants || busySelection) && !busyWhole;

  const handleRewrite = async () => {
    if (isAuthor && !confirm(`rewrite:${chapter.id}`)) return;
    const ok = await onWrite(rewriteComment.trim() || undefined);
    if (ok) {
      setRewriteOpen(false);
      setRewriteComment('');
    }
  };

  const handlePolish = () => {
    if (isAuthor && !confirm(`polish:${chapter.id}`)) return;
    onPolish();
  };

  const submitSelection = (mode: 'comment' | 'variants') => {
    if (aiLocked || !selection) return;
    if (mode === 'comment' && !selComment.trim()) return;
    onRewriteSelection(mode, mode === 'comment' ? selComment.trim() : undefined);
  };

  const progress = targetWords > 0 ? Math.min(1, words / targetWords) : 0;

  return (
    <div className="space-y-4">
      {/* Huvud */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <p className="eyebrow whitespace-nowrap">Kapitel {index + 1} av {count}</p>
          <ChapterBadge chapter={chapter} />
        </div>
        <div className="flex items-center shrink-0 -mr-1.5">
          <button type="button" onClick={onPrev} disabled={!onPrev} className="btn-icon disabled:opacity-30" aria-label="Föregående kapitel" title="Föregående kapitel">
            <Icon name="chevron_left" size={22} />
          </button>
          <button type="button" onClick={onNext} disabled={!onNext} className="btn-icon disabled:opacity-30" aria-label="Nästa kapitel" title="Nästa kapitel">
            <Icon name="chevron_right" size={22} />
          </button>
        </div>
      </div>

      <div className="space-y-2">
        <input
          value={chapter.title}
          onChange={e => onTitle(e.target.value)}
          className="w-full bg-transparent text-2xl sm:text-3xl font-heading font-bold tracking-tight text-ink outline-none rounded-lg px-1 -mx-1 focus:bg-white"
          aria-label="Kapitlets titel"
          placeholder="Kapitlets titel"
        />
        <div className="flex items-start gap-2 rounded-2xl bg-white/70 border border-line px-3 py-2 focus-within:border-brand focus-within:ring-4 focus-within:ring-brand/15 transition-all">
          <Icon name="sticky_note_2" size={18} className="text-ink/35 mt-1 shrink-0" />
          <textarea
            value={chapter.notes}
            onChange={e => onNotes(e.target.value)}
            rows={Math.min(4, Math.max(1, Math.ceil(chapter.notes.length / 90)))}
            className="flex-1 bg-transparent text-sm text-ink/70 leading-relaxed outline-none resize-none py-0.5 placeholder:text-ink/35"
            placeholder="Plan för kapitlet – vad ska hända?"
            aria-label="Plan för kapitlet"
          />
        </div>
      </div>

      {/* Meddelanden */}
      {error && (
        <div className="note-error flex items-start gap-2" role="alert">
          <Icon name="error" size={18} className="shrink-0 mt-px" />
          <span className="flex-1">{error}</span>
          <button type="button" onClick={onDismissMessage} className="shrink-0 -m-1 p-1 rounded-full hover:bg-red-100" aria-label="Stäng">
            <Icon name="close" size={16} />
          </button>
        </div>
      )}
      {notice && !error && (
        <div className="note-success flex items-start gap-2" role="status">
          <Icon name="check_circle" size={18} className="shrink-0 mt-px" />
          <span className="flex-1">{notice}</span>
          {chapter.history.length > 0 && (
            <button type="button" onClick={onUndo} className="shrink-0 text-emerald-900 underline underline-offset-2 font-semibold">Ångra</button>
          )}
          <button type="button" onClick={onDismissMessage} className="shrink-0 -m-1 p-1 rounded-full hover:bg-emerald-100" aria-label="Stäng">
            <Icon name="close" size={16} />
          </button>
        </div>
      )}
      {truncated && !busyWhole && (
        <div className="note-warning flex items-start gap-2">
          <Icon name="content_cut" size={18} className="shrink-0 mt-px" />
          <span>Kapitlet blev avbrutet innan det var klart. Skriv om det, eller skriv klart slutet själv.</span>
        </div>
      )}

      {busyWhole && busy && (
        <BusyNote label={busy.label} stages={busy.kind === 'polish' ? POLISH_STAGES : WRITE_STAGES} startedAt={busy.startedAt} />
      )}

      {/* Tomt kapitel: skriv med AI eller själv */}
      {isEmpty && !busyWhole && (
        <div className="rounded-3xl border border-dashed border-brand/30 bg-gradient-to-br from-brand/[0.05] to-white p-5 sm:p-6">
          <div className="flex items-start gap-3">
            <span className="w-11 h-11 shrink-0 rounded-2xl bg-brand text-white flex items-center justify-center">
              <Icon name="edit_note" size={24} />
            </span>
            <div className="min-w-0 flex-1">
              <h4 className="font-heading font-semibold text-ink text-lg leading-snug">Kapitlet är inte skrivet än</h4>
              <p className="text-sm text-ink/60 mt-0.5">
                {chapter.notes.trim()
                  ? 'AI:n skriver det i ditt språk utifrån planen ovan och kapitlen före.'
                  : 'Skriv några stödord i planen ovan så vet AI:n vad som ska hända – eller låt den följa tidslinjen.'}
              </p>
            </div>
          </div>
          {showWriteComment && (
            <input
              value={writeComment}
              onChange={e => setWriteComment(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !aiLocked && onWrite(writeComment.trim() || undefined)}
              className="field mt-4 text-sm"
              placeholder="Något särskilt att tänka på? T.ex. mer dialog, sluta med en cliffhanger"
              autoFocus
            />
          )}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => onWrite(writeComment.trim() || undefined)} disabled={aiLocked} className="btn-action">
              <Icon name="auto_awesome" filled size={19} /> Skriv kapitlet
            </button>
            {!showWriteComment && (
              <button type="button" onClick={() => setShowWriteComment(true)} className="btn-ghost text-sm">
                <Icon name="chat" size={18} /> Lägg till önskemål
              </button>
            )}
            <span className="text-xs text-ink/45">ca {fmt(targetWords)} ord · eller skriv själv nedan</span>
          </div>
        </div>
      )}

      {/* Verktyg för skrivet kapitel */}
      {!isEmpty && !busyWhole && (
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar -mx-4 px-4 sm:mx-0 sm:px-0 pb-0.5">
          <button type="button" onClick={onUndo} disabled={chapter.history.length === 0 || aiLocked} className="btn-ghost !py-2 !px-3.5 text-sm shrink-0" title="Återställ föregående version">
            <Icon name="undo" size={18} /> Ångra{chapter.history.length > 0 && <span className="text-ink/40 tabular-nums">{chapter.history.length}</span>}
          </button>
          <button
            type="button"
            onClick={handlePolish}
            disabled={aiLocked}
            className={`${armed === `polish:${chapter.id}` ? 'btn-action animate-pop' : 'btn-ghost'} !py-2 !px-3.5 text-sm shrink-0`}
          >
            <Icon name="auto_fix_high" size={18} />
            {armed === `polish:${chapter.id}` ? 'Din text – förbättra ändå?' : 'Förbättra språket'}
          </button>
          <button
            type="button"
            onClick={() => setRewriteOpen(v => !v)}
            disabled={aiLocked}
            className={`${rewriteOpen ? 'chip-on !py-2' : 'btn-ghost !py-2'} !px-3.5 text-sm shrink-0`}
            aria-expanded={rewriteOpen}
          >
            <Icon name="refresh" size={18} /> Skriv om kapitlet
          </button>
        </div>
      )}

      {rewriteOpen && !isEmpty && !busyWhole && (
        <div className="rounded-2xl border border-brand/20 bg-brand/[0.04] p-3 sm:p-4 space-y-2.5 animate-pop">
          <label htmlFor="rewrite-comment" className="block text-sm font-semibold text-ink">Vad ska bli annorlunda? <span className="font-normal text-ink/45">(valfritt)</span></label>
          <input
            id="rewrite-comment"
            value={rewriteComment}
            onChange={e => setRewriteComment(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') handleRewrite();
              if (e.key === 'Escape') setRewriteOpen(false);
            }}
            className="field text-sm"
            placeholder="T.ex. mindre beskrivningar, mer spänning mot slutet"
            autoFocus
          />
          {isAuthor && (
            <p className="text-xs text-amber-800 flex items-center gap-1.5">
              <Icon name="info" size={15} /> Det här är din egen text. Den sparas i historiken så att du kan ångra.
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setRewriteOpen(false)} className="btn-ghost !py-2 !px-3.5 text-sm">Avbryt</button>
            <button type="button" onClick={handleRewrite} disabled={aiLocked} className="btn-action !py-2 !px-4 text-sm">
              <Icon name="auto_awesome" size={17} />
              {armed === `rewrite:${chapter.id}` ? 'Tryck igen för att skriva om' : 'Skriv om'}
            </button>
          </div>
        </div>
      )}

      {/* Repliker utan talstreck */}
      {missingDialogue > 0 && !busyWhole && (
        <div className="note-warning !font-normal flex flex-col sm:flex-row sm:items-center gap-2">
          <p className="flex-1 min-w-0 flex items-start gap-2">
            <Icon name="format_quote" size={18} className="shrink-0 mt-px" />
            <span>
              <span className="font-semibold">{missingDialogue} {missingDialogue === 1 ? 'replik saknar' : 'repliker saknar'} talstreck.</span>{' '}
              Det händer ofta när repliker skrivits som punktlista i Word eller Pages.
            </span>
          </p>
          <div className="flex flex-wrap gap-2 shrink-0">
            <button type="button" onClick={() => onRestoreDialogue('chapter')} disabled={aiLocked} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-900 text-white text-xs font-semibold hover:bg-amber-950 disabled:opacity-40">
              <Icon name="format_list_bulleted" size={15} /> Lägg till talstreck
            </button>
            {missingDialogueAll > missingDialogue && (
              <button type="button" onClick={() => onRestoreDialogue('all')} disabled={aiLocked} className="px-3 py-1.5 rounded-full text-xs font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-40">
                I alla kapitel ({missingDialogueAll})
              </button>
            )}
          </div>
        </div>
      )}

      {/* AI-tecken */}
      {tells.length > 0 && !hideTells && !busyWhole && (
        <div className="note-warning !font-normal">
          <div className="flex items-start gap-2">
            <Icon name="troubleshoot" size={18} className="shrink-0 mt-px" />
            <p className="flex-1 min-w-0">
              <span className="font-semibold">Möjliga AI-tecken: </span>
              {tells.map(t => `${t.label} (${t.count})`).join(', ')}
            </p>
            <button type="button" onClick={() => setHideTells(true)} className="shrink-0 -m-1 p-1 rounded-full hover:bg-amber-100" aria-label="Dölj">
              <Icon name="close" size={16} />
            </button>
          </div>
          {showTells && (
            <ul className="mt-2 ml-6 space-y-1.5 text-xs text-amber-900/80">
              {tells.flatMap(t => t.examples.slice(0, 2).map((ex, i) => (
                <li key={`${t.id}-${i}`} className="leading-relaxed"><span className="font-semibold">{t.label}:</span> ”…{ex}…”</li>
              )))}
            </ul>
          )}
          <div className="mt-2 ml-6 flex flex-wrap gap-2">
            <button type="button" onClick={onPolish} disabled={aiLocked} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-900 text-white text-xs font-semibold hover:bg-amber-950 disabled:opacity-40">
              <Icon name="auto_fix_high" size={15} /> Förbättra
            </button>
            <button type="button" onClick={() => setShowTells(v => !v)} className="px-3 py-1.5 rounded-full text-xs font-semibold text-amber-900 hover:bg-amber-100">
              {showTells ? 'Dölj exempel' : 'Visa exempel'}
            </button>
          </div>
        </div>
      )}

      {/* Texten */}
      <div className="relative">
        {busyWhole && isEmpty ? (
          <div className="rounded-3xl bg-white border border-line p-6 sm:p-8 space-y-3" aria-hidden>
            {[92, 100, 84, 97, 60, 0, 95, 88, 100, 70].map((w, i) =>
              w === 0 ? <div key={i} className="h-3" /> : <div key={i} className="skeleton h-3.5 !rounded-full" style={{ width: `${w}%` }} />,
            )}
          </div>
        ) : (
          <textarea
            ref={textRef}
            value={chapter.text}
            onChange={e => onText(e.target.value)}
            onPaste={e => { const v = pasteManuscript(e, chapter.text); if (v !== null) onText(v); }}
            onSelect={readSelection}
            onMouseUp={readSelection}
            onKeyUp={readSelection}
            readOnly={!!busy}
            spellCheck
            lang="sv"
            className={`block w-full rounded-3xl bg-white border border-line shadow-soft px-5 py-6 sm:px-8 sm:py-8 text-[16px] sm:text-[17px] leading-[1.85] text-ink/90
                        outline-none resize-none overflow-hidden focus:border-brand/40 focus:ring-4 focus:ring-brand/10 transition-[border,box-shadow] placeholder:text-ink/30
                        ${busyWhole ? 'opacity-50' : ''}`}
            placeholder={isEmpty ? 'Eller skriv kapitlet själv här...' : ''}
            aria-label={`Text för ${chapter.title}`}
          />
        )}

        {/* Ordräkning */}
        <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-1 text-xs text-ink/50">
          <span className="inline-flex items-center gap-2 tabular-nums">
            <span className="w-16 h-1 rounded-full bg-ink/[0.08] overflow-hidden" aria-hidden>
              <span className="block h-full bg-brand/60 rounded-full" style={{ width: `${progress * 100}%` }} />
            </span>
            {fmt(words)} ord · mål ca {fmt(targetWords)}
          </span>
          {!isEmpty && (
            <button
              type="button"
              onClick={() => onSource(chapter.source === 'author' ? 'ai' : 'author')}
              className="inline-flex items-center gap-1 hover:text-ink underline-offset-2 hover:underline"
              title="AI:n lär sig av kapitel som är markerade som din text"
            >
              <Icon name="swap_horiz" size={15} />
              {chapter.source === 'author' ? 'Markera som AI-text' : 'Markera som min text'}
            </button>
          )}
        </div>

        {/* Markeringsverktyg */}
        {showSelectionBar && (
          <div className="sticky z-20 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] md:bottom-4 mt-3">
            <div className="rounded-3xl bg-white border border-ink/15 shadow-lift p-3 sm:p-4 space-y-3 animate-pop">
              {variants ? (
                <>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-ink flex items-center gap-1.5">
                      <Icon name="style" size={18} className="text-brand" />
                      {variants.list.length === 1 ? 'Nytt förslag' : `${variants.list.length} förslag`}
                      {variants.comment && <span className="font-normal text-ink/50 truncate max-w-[12rem] sm:max-w-xs">· ”{variants.comment}”</span>}
                    </p>
                    <button type="button" onClick={onCloseVariants} className="btn-ghost !py-1.5 !px-3 text-sm">Stäng</button>
                  </div>
                  <div className="max-h-[45vh] overflow-y-auto space-y-2 -mx-1 px-1">
                    <details className="rounded-2xl bg-paper/70 border border-line px-3 py-2 text-sm text-ink/55">
                      <summary className="cursor-pointer text-xs font-semibold text-ink/55">Visa originalet</summary>
                      <p className="mt-1.5 whitespace-pre-line leading-relaxed">{variants.original.trim()}</p>
                    </details>
                    {variants.list.map((v, i) => (
                      <div key={i} className="rounded-2xl border border-brand/20 bg-brand/[0.03] p-3">
                        <p className="text-[15px] text-ink/85 whitespace-pre-line leading-relaxed">{v.trim()}</p>
                        <div className="mt-2 flex items-center justify-between gap-2">
                          <span className="text-[11px] text-ink/40">{fmt(countWords(v))} ord</span>
                          <button type="button" onClick={() => onUseVariant(v)} className="btn-action !py-1.5 !px-3.5 text-sm">
                            <Icon name="check" size={17} /> Använd
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                  {selection && !busySelection && (
                    <button type="button" onClick={() => submitSelection(variants.mode)} disabled={aiLocked} className="text-xs font-semibold text-brand hover:underline inline-flex items-center gap-1">
                      <Icon name="casino" size={15} /> Försök igen
                    </button>
                  )}
                </>
              ) : busySelection && busy ? (
                <BusyNote label={busy.label} startedAt={busy.startedAt} compact hint="" />
              ) : selection ? (
                <>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-ink">
                        Markerat: {fmt(selectedWords)} ord
                      </p>
                      <p className="text-xs text-ink/50 truncate max-w-full">”{selectedText.trim().slice(0, 120)}{selectedText.trim().length > 120 ? '…' : ''}”</p>
                    </div>
                    <button type="button" onClick={() => onSelection(null)} className="btn-icon !w-8 !h-8 shrink-0" aria-label="Avmarkera" title="Avmarkera">
                      <Icon name="close" size={18} />
                    </button>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      value={selComment}
                      onChange={e => setSelComment(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') submitSelection('comment');
                        if (e.key === 'Escape') onSelection(null);
                      }}
                      className="field !py-2.5 text-sm flex-1"
                      placeholder="Vad ska ändras? T.ex. kortare, mer känsla"
                      aria-label="Vad ska ändras?"
                    />
                    <div className="flex gap-2">
                      <button type="button" onClick={() => submitSelection('comment')} disabled={aiLocked || !selComment.trim()} className="btn-action !py-2.5 !px-4 text-sm flex-1 sm:flex-none">
                        <Icon name="edit" size={17} /> Skriv om
                      </button>
                      <button type="button" onClick={() => submitSelection('variants')} disabled={aiLocked} className="btn-ghost !py-2.5 !px-4 text-sm flex-1 sm:flex-none whitespace-nowrap">
                        <Icon name="casino" size={17} /> Slumpa ny version
                      </button>
                    </div>
                  </div>
                </>
              ) : null}
            </div>
          </div>
        )}

        {!isEmpty && !selection && !variants && !busy && (
          <p className="mt-3 px-1 text-xs text-ink/40 flex items-center gap-1.5">
            <Icon name="ink_highlighter" size={15} /> Markera en del av texten som inte känns rätt för att skriva om just den.
          </p>
        )}
      </div>
    </div>
  );
}
