'use client';

import { useEffect, useRef, useState } from 'react';
import type { TimelineChapter } from '@/lib/author-types';
import Icon from '../Icon';
import { BusyNote, ChapterBadge, ChapterDot } from './ui';
import { countWords, fmt } from './finish-utils';

export interface TimelineBusy {
  label: string;
  startedAt: number;
}

interface Props {
  chapters: TimelineChapter[];
  selectedId: string | null;
  premise: string;
  ending: string;
  totalChapters: number;
  // Pågående tidslinjeanrop (eller null); aiLocked = något annat AI-jobb pågår
  timelineBusy: TimelineBusy | null;
  aiLocked: boolean;
  lockedChapterId?: string | null;
  error?: string;
  onDismissError: () => void;
  onSelect: (id: string) => void;
  onUpdate: (id: string, patch: Partial<Pick<TimelineChapter, 'title' | 'notes'>>) => void;
  onMove: (id: string, dir: -1 | 1) => void;
  onRemove: (id: string) => void;
  onAdd: (afterId: string | null) => void;
  onFill: () => void;
  onRework: (instruction: string) => Promise<boolean>;
  onPremise: (premise: string) => void;
  onEnding: (ending: string) => void;
  armed: string | null;
  confirm: (key: string) => boolean;
}

const TIMELINE_STAGES = ['Läser din början', 'Följer trådarna i berättelsen', 'Planerar kapitlen', 'Knyter ihop mot slutet'];

export default function TimelinePanel(props: Props) {
  const {
    chapters, selectedId, premise, ending, totalChapters, timelineBusy, aiLocked, lockedChapterId, error,
    onDismissError, onSelect, onUpdate, onMove, onRemove, onAdd, onFill, onRework, onPremise, onEnding, armed, confirm,
  } = props;

  const [showDirection, setShowDirection] = useState(!premise.trim());
  const [reworkOpen, setReworkOpen] = useState(false);
  const [instruction, setInstruction] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const reworkRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (reworkOpen) reworkRef.current?.focus();
  }, [reworkOpen]);

  const planned = chapters.filter(c => c.status === 'planned');
  const emptyPlans = planned.filter(c => !c.notes.trim()).length;
  const missing = Math.max(0, totalChapters - chapters.length);
  const locked = !!timelineBusy || aiLocked;

  const toggle = (id: string) =>
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const handleDelete = (ch: TimelineChapter) => {
    // Författarens egna kapitel kräver ett extra klick
    if (ch.source === 'author' && ch.status === 'written') {
      if (armed === `del2:${ch.id}`) {
        confirm(`del2:${ch.id}`);
        onRemove(ch.id);
      } else if (armed === `del:${ch.id}`) {
        confirm(`del2:${ch.id}`);
      } else {
        confirm(`del:${ch.id}`);
      }
      return;
    }
    if (confirm(`del:${ch.id}`)) onRemove(ch.id);
  };

  const submitRework = async () => {
    if (!instruction.trim() || locked) return;
    if (await onRework(instruction.trim())) {
      setReworkOpen(false);
      setInstruction('');
    }
  };

  return (
    <div className="space-y-4">
      {/* Bokens riktning */}
      <section className="rounded-2xl bg-white border border-line">
        <button
          type="button"
          onClick={() => setShowDirection(v => !v)}
          className="w-full flex items-center justify-between gap-2 px-4 py-3 text-left rounded-2xl hover:bg-paper/60"
          aria-expanded={showDirection}
        >
          <span className="min-w-0">
            <span className="flex items-center gap-2 text-sm font-semibold text-ink">
              <Icon name="flag" size={18} className="text-brand" /> Bokens riktning
            </span>
            {!showDirection && (
              <span className="block text-xs text-ink/50 mt-0.5 truncate">{premise.trim() || 'Beskriv vart boken är på väg'}</span>
            )}
          </span>
          <Icon name={showDirection ? 'expand_less' : 'expand_more'} size={20} className="text-ink/50" />
        </button>
        {showDirection && (
          <div className="px-4 pb-4 space-y-3">
            <div>
              <label htmlFor="tl-premise" className="block text-xs font-semibold text-ink/60 mb-1">Vad handlar boken om och vart är den på väg?</label>
              <textarea
                id="tl-premise"
                value={premise}
                onChange={e => onPremise(e.target.value)}
                className="field !py-2.5 text-sm min-h-[5.5rem] resize-y"
                placeholder="T.ex. Otis letar efter sin försvunna storasyster och upptäcker att skogen bakom Bydalen gömmer en hemlighet."
              />
            </div>
            <div>
              <label htmlFor="tl-ending" className="block text-xs font-semibold text-ink/60 mb-1">Hur slutar den? <span className="font-normal text-ink/40">(valfritt)</span></label>
              <textarea
                id="tl-ending"
                value={ending}
                onChange={e => onEnding(e.target.value)}
                className="field !py-2.5 text-sm min-h-[4rem] resize-y"
                placeholder="Lämna tomt om du vill att AI:n föreslår ett slut."
              />
            </div>
          </div>
        )}
      </section>

      {/* Rubrik + verktyg */}
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="font-heading text-lg font-bold text-ink">Tidslinje</h3>
          <p className="text-xs text-ink/50">{chapters.length} kapitel · {planned.length} planerade</p>
        </div>
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => setReworkOpen(v => !v)}
            disabled={locked || planned.length === 0}
            className={`${reworkOpen ? 'chip-on' : 'chip'} !px-3 !py-1.5 disabled:opacity-40`}
            aria-expanded={reworkOpen}
            title={planned.length === 0 ? 'Alla kapitel är skrivna' : 'Be AI:n ändra de planerade kapitlen'}
          >
            <Icon name="edit_road" size={17} /> Ändra
          </button>
          <button
            type="button"
            onClick={onFill}
            disabled={locked}
            className="chip !px-3 !py-1.5 disabled:opacity-40"
            title="Fyll i tomma planer och lägg till kapitel upp till önskat antal"
          >
            <Icon name="auto_awesome" size={17} /> Föreslå
          </button>
        </div>
      </div>

      {reworkOpen && (
        <div className="rounded-2xl border border-brand/20 bg-brand/[0.04] p-3 space-y-2 animate-pop">
          <label htmlFor="tl-rework" className="block text-sm font-semibold text-ink">Ändra tidslinjen</label>
          <p className="text-xs text-ink/55">Kapitel som redan är skrivna ändras inte – bara planerna framåt.</p>
          <textarea
            id="tl-rework"
            ref={reworkRef}
            value={instruction}
            onChange={e => setInstruction(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submitRework();
              if (e.key === 'Escape') setReworkOpen(false);
            }}
            className="field !py-2.5 text-sm min-h-[4.5rem] resize-y"
            placeholder="T.ex. Låt Otis hitta ett spår efter Allie redan i kapitel 4, och gör mormor till en viktigare figur."
            disabled={locked}
          />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setReworkOpen(false)} className="btn-ghost !py-2 !px-3.5 text-sm">Avbryt</button>
            <button type="button" onClick={submitRework} disabled={locked || !instruction.trim()} className="btn-action !py-2 !px-4 text-sm">
              <Icon name="auto_awesome" size={17} /> Ändra planen
            </button>
          </div>
        </div>
      )}

      {timelineBusy && <BusyNote label={timelineBusy.label} stages={TIMELINE_STAGES} startedAt={timelineBusy.startedAt} compact hint="" />}

      {error && (
        <div className="note-error flex items-start gap-2" role="alert">
          <span className="flex-1">{error}</span>
          <button type="button" onClick={onDismissError} className="shrink-0 -m-1 p-1 rounded-full hover:bg-red-100" aria-label="Stäng felmeddelandet">
            <Icon name="close" size={16} />
          </button>
        </div>
      )}

      {!timelineBusy && (emptyPlans > 0 || missing > 0) && (
        <button
          type="button"
          onClick={onFill}
          disabled={locked}
          className="w-full text-left rounded-2xl border border-dashed border-brand/30 bg-brand/[0.03] px-4 py-3 hover:bg-brand/[0.06] transition-colors disabled:opacity-50"
        >
          <span className="flex items-center gap-2 text-sm font-semibold text-brand">
            <Icon name="auto_awesome" size={18} /> Föreslå tidslinje
          </span>
          <span className="block text-xs text-ink/55 mt-0.5">
            {[
              emptyPlans > 0 && `${emptyPlans} kapitel saknar plan`,
              missing > 0 && `${missing} kapitel kvar till ${totalChapters}`,
            ].filter(Boolean).join(' · ')}
          </span>
        </button>
      )}

      {/* Kapitel */}
      {chapters.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-ink/20 bg-white/60 px-4 py-8 text-center">
          <Icon name="timeline" size={28} className="text-ink/35" />
          <p className="mt-2 text-sm text-ink/60">Tidslinjen är tom.</p>
          <button type="button" onClick={() => onAdd(null)} className="btn-ghost mt-3 text-sm">
            <Icon name="add" size={18} /> Lägg till kapitel
          </button>
        </div>
      ) : (
        <ol className="relative space-y-2">
          {chapters.map((ch, i) => {
            const active = ch.id === selectedId;
            const open = active || expanded.has(ch.id);
            const words = countWords(ch.text);
            const deleteArmed = armed === `del:${ch.id}` || armed === `del2:${ch.id}`;
            const isLocked = lockedChapterId === ch.id;
            return (
              <li key={ch.id} className="relative">
                {i < chapters.length - 1 && <span aria-hidden className="absolute left-[27px] top-12 bottom-[-10px] w-px bg-line" />}
                <div
                  className={`relative rounded-2xl border transition-all ${
                    active ? 'bg-white border-brand/40 shadow-soft' : 'bg-white/70 border-line hover:bg-white hover:border-ink/20'
                  }`}
                >
                  <div className="flex items-start gap-3 p-3">
                    <button
                      type="button"
                      onClick={() => onSelect(ch.id)}
                      className="shrink-0 rounded-full"
                      aria-label={`Öppna ${ch.title}`}
                      aria-current={active ? 'true' : undefined}
                    >
                      {isLocked ? (
                        <span className="w-8 h-8 rounded-full bg-brand/10 text-brand flex items-center justify-center"><span className="spinner !w-4 !h-4" /></span>
                      ) : (
                        <ChapterDot chapter={ch} number={i + 1} active={active} />
                      )}
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <input
                          value={ch.title}
                          onChange={e => onUpdate(ch.id, { title: e.target.value })}
                          onFocus={() => !active && onSelect(ch.id)}
                          className="flex-1 min-w-0 bg-transparent font-semibold text-[15px] text-ink outline-none rounded-md px-1 -mx-1 py-0.5 focus:bg-paper"
                          aria-label={`Titel för kapitel ${i + 1}`}
                        />
                        <button
                          type="button"
                          onClick={() => (active ? toggle(ch.id) : onSelect(ch.id))}
                          className="shrink-0"
                          tabIndex={-1}
                        >
                          <ChapterBadge chapter={ch} />
                        </button>
                      </div>

                      {open ? (
                        <textarea
                          value={ch.notes}
                          onChange={e => onUpdate(ch.id, { notes: e.target.value })}
                          onFocus={() => !active && onSelect(ch.id)}
                          rows={3}
                          className="mt-1.5 w-full text-sm text-ink/75 leading-relaxed bg-paper/70 border border-transparent rounded-xl px-2.5 py-2 outline-none resize-y focus:bg-white focus:border-brand focus:ring-4 focus:ring-brand/15 placeholder:text-ink/35"
                          placeholder="Vad händer i kapitlet? Några stödord räcker."
                          aria-label={`Plan för ${ch.title}`}
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={() => onSelect(ch.id)}
                          className={`mt-0.5 block w-full text-left text-[13px] leading-snug line-clamp-2 ${ch.notes.trim() ? 'text-ink/55' : 'text-ink/35 italic'}`}
                        >
                          {ch.notes.trim() || 'Ingen plan än'}
                        </button>
                      )}

                      <div className="mt-1.5 flex items-center justify-between gap-2">
                        <span className="text-[11px] text-ink/40 tabular-nums">
                          {ch.status === 'written' ? `${fmt(words)} ord` : ''}
                        </span>
                        {open ? (
                          <div className="flex items-center -mr-1.5">
                            <button type="button" onClick={() => onMove(ch.id, -1)} disabled={i === 0} className="btn-icon !w-8 !h-8 disabled:opacity-30" aria-label="Flytta upp" title="Flytta upp">
                              <Icon name="arrow_upward" size={17} />
                            </button>
                            <button type="button" onClick={() => onMove(ch.id, 1)} disabled={i === chapters.length - 1} className="btn-icon !w-8 !h-8 disabled:opacity-30" aria-label="Flytta ner" title="Flytta ner">
                              <Icon name="arrow_downward" size={17} />
                            </button>
                            <button type="button" onClick={() => onAdd(ch.id)} className="btn-icon !w-8 !h-8" aria-label="Nytt kapitel efter det här" title="Nytt kapitel efter det här">
                              <Icon name="add" size={18} />
                            </button>
                            {deleteArmed ? (
                              <button
                                type="button"
                                onClick={() => handleDelete(ch)}
                                disabled={isLocked}
                                className="ml-0.5 px-2.5 h-8 rounded-full bg-red-600 text-white text-xs font-semibold animate-pop whitespace-nowrap"
                              >
                                {ch.source === 'author' && ch.status === 'written'
                                  ? armed === `del2:${ch.id}` ? 'Texten försvinner – säker?' : 'Din egen text – ta bort?'
                                  : 'Ta bort?'}
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleDelete(ch)}
                                disabled={isLocked}
                                className="btn-icon !w-8 !h-8 hover:!text-red-600 hover:!bg-red-50 disabled:opacity-30"
                                aria-label={`Ta bort ${ch.title}`}
                                title="Ta bort kapitlet"
                              >
                                <Icon name="delete" size={17} />
                              </button>
                            )}
                            {!active && (
                              <button type="button" onClick={() => toggle(ch.id)} className="btn-icon !w-8 !h-8" aria-label="Fäll ihop" title="Fäll ihop">
                                <Icon name="expand_less" size={18} />
                              </button>
                            )}
                          </div>
                        ) : (
                          <button type="button" onClick={() => toggle(ch.id)} className="btn-icon !w-7 !h-7 -mr-1" aria-label={`Visa planen för ${ch.title}`} title="Redigera planen">
                            <Icon name="expand_more" size={18} />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {chapters.length > 0 && (
        <button type="button" onClick={() => onAdd(selectedId)} className="w-full btn-ghost !rounded-2xl border-dashed text-sm">
          <Icon name="add" size={18} /> Lägg till kapitel{selectedId ? ' efter valt' : ''}
        </button>
      )}
    </div>
  );
}
