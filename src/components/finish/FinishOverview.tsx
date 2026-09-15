'use client';

import { useState } from 'react';
import type { AuthorVoice, FinishProject } from '@/lib/author-types';
import { deleteAuthorVoice, deleteFinishProject, saveAuthorVoice } from '@/lib/storage';
import Icon from '../Icon';
import StepHeader from '../StepHeader';
import VoiceProfileEditor from './VoiceProfileEditor';
import { Modal, useArmed } from './ui';
import { errorText, fmt, formatUpdated, projectStats } from './finish-utils';

export type OverviewTab = 'projects' | 'voices';

interface Props {
  projects: FinishProject[] | null; // null = laddar
  voices: AuthorVoice[];
  loadError?: string;
  tab: OverviewTab;
  onTab: (tab: OverviewTab) => void;
  onBack: () => void;
  onNew: () => void;
  onOpen: (project: FinishProject) => void;
  onProjectsChanged: () => void;
  onVoicesChanged: () => void;
}

const HOW = [
  { icon: 'content_paste', title: 'Klistra in din början', text: 'Inledningen och början av första kapitlet. AI:n lär sig hur du skriver.' },
  { icon: 'timeline', title: 'Fyll i tidslinjen', text: 'Stödord om vad som händer i varje kapitel – AI:n föreslår resten.' },
  { icon: 'edit_note', title: 'Skriv klart och förbättra', text: 'Skriv kapitel för kapitel, markera det som skaver och skriv om just det.' },
];

export default function FinishOverview({ projects, voices, loadError, tab, onTab, onBack, onNew, onOpen, onProjectsChanged, onVoicesChanged }: Props) {
  const { armed, confirm } = useArmed();
  const [openVoice, setOpenVoice] = useState<AuthorVoice | null>(null);
  const [error, setError] = useState('');

  const removeProject = async (id: string) => {
    if (!confirm(`project:${id}`)) return;
    try {
      await deleteFinishProject(id);
      onProjectsChanged();
    } catch (err) {
      setError(errorText(err, 'Projektet kunde inte tas bort'));
    }
  };

  return (
    <div className="space-y-8 pb-16 md:pb-0">
      <StepHeader
        eyebrow="Slutför din bok"
        title="Skriv klart din bok"
        description="Du har början – AI:n lär sig ditt språk och hjälper dig hitta riktningen och skriva resten, kapitel för kapitel. Allt kan förbättras hela vägen."
        onBack={onBack}
        actions={
          <button type="button" onClick={onNew} className="btn-action w-full sm:w-auto">
            <Icon name="add" size={20} /> Ny bok att slutföra
          </button>
        }
      />

      <div className="inline-flex p-1 rounded-full bg-white border border-line" role="tablist" aria-label="Visa">
        {([
          ['projects', 'Mina projekt', projects?.length],
          ['voices', 'Sparade författarspråk', voices.length],
        ] as const).map(([key, label, n]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => onTab(key)}
            className={`inline-flex items-center gap-1.5 px-3.5 sm:px-4 py-2 rounded-full text-sm font-semibold transition-all ${tab === key ? 'bg-ink text-white' : 'text-ink/60 hover:text-ink'}`}
          >
            {label}
            {!!n && <span className={`text-xs tabular-nums ${tab === key ? 'text-white/60' : 'text-ink/40'}`}>{n}</span>}
          </button>
        ))}
      </div>

      {(error || loadError) && <div className="note-error" role="alert">{error || loadError}</div>}

      {tab === 'projects' ? (
        projects === null ? (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[0, 1, 2].map(i => <div key={i} className="skeleton h-44 !rounded-3xl" />)}
          </div>
        ) : projects.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-ink/20 bg-white/60 px-5 py-10 sm:px-10 sm:py-14">
            <div className="text-center max-w-lg mx-auto">
              <span className="w-14 h-14 mx-auto rounded-2xl bg-brand text-white flex items-center justify-center">
                <Icon name="history_edu" size={28} />
              </span>
              <h3 className="mt-4 text-xl font-heading font-bold text-ink">Börja med det du redan har skrivit</h3>
              <p className="mt-1 text-ink/55">Du behöver inte veta allt. En början och en känsla för vart boken är på väg räcker.</p>
            </div>
            <ol className="mt-8 grid sm:grid-cols-3 gap-3 max-w-3xl mx-auto">
              {HOW.map((s, i) => (
                <li key={s.title} className="rounded-2xl bg-white border border-line p-4">
                  <div className="flex items-center justify-between">
                    <span className="w-9 h-9 rounded-xl bg-paper border border-line flex items-center justify-center text-ink/70"><Icon name={s.icon} size={20} /></span>
                    <span className="font-heading text-2xl font-bold text-ink/15">{i + 1}</span>
                  </div>
                  <p className="mt-3 font-semibold text-ink text-sm">{s.title}</p>
                  <p className="mt-1 text-xs text-ink/55 leading-relaxed">{s.text}</p>
                </li>
              ))}
            </ol>
            <div className="mt-8 text-center">
              <button type="button" onClick={onNew} className="btn-action">
                <Icon name="add" size={20} /> Ny bok att slutföra
              </button>
            </div>
          </div>
        ) : (
          <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {projects.map(p => {
              const s = projectStats(p);
              return (
                <li key={p.id} className="card-glass p-5 flex flex-col group">
                  <button type="button" onClick={() => onOpen(p)} className="text-left flex-1 min-w-0" aria-label={`Öppna ${p.title}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="font-heading text-lg font-bold text-ink leading-snug truncate group-hover:text-brand transition-colors">{p.title}</h3>
                        <p className="text-xs text-ink/50 truncate">{[p.author, p.settings.targetAge].filter(Boolean).join(' · ')}</p>
                      </div>
                      {s.planned === 0 && s.total > 0 && (
                        <span className="shrink-0 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[11px] font-semibold">Klar</span>
                      )}
                    </div>
                    {p.premise && <p className="mt-2 text-sm text-ink/60 line-clamp-2 leading-relaxed">{p.premise}</p>}
                    <div className="mt-4 flex gap-0.5" aria-hidden>
                      {p.chapters.map(c => (
                        <span key={c.id} className={`h-1.5 flex-1 rounded-full ${c.status === 'planned' ? 'bg-ink/10' : c.source === 'author' ? 'bg-ink' : 'bg-brand'}`} />
                      ))}
                    </div>
                    <p className="mt-2 text-sm text-ink/70 tabular-nums">
                      <span className="font-semibold text-ink">{s.written} av {s.total}</span> kapitel · {fmt(s.words)} ord
                    </p>
                  </button>
                  <div className="mt-3 pt-3 border-t border-line flex items-center justify-between gap-2">
                    <span className="text-xs text-ink/45 truncate">Ändrad {formatUpdated(p.updatedAt)}</span>
                    <div className="flex items-center gap-1 -mr-1.5 shrink-0">
                      {armed === `project:${p.id}` ? (
                        <button type="button" onClick={() => removeProject(p.id)} className="px-2.5 h-8 rounded-full bg-red-600 text-white text-xs font-semibold animate-pop">
                          Ta bort?
                        </button>
                      ) : (
                        <button type="button" onClick={() => removeProject(p.id)} className="btn-icon !w-8 !h-8 hover:!text-red-600 hover:!bg-red-50" aria-label={`Ta bort ${p.title}`} title="Ta bort projektet">
                          <Icon name="delete" size={17} />
                        </button>
                      )}
                      <button type="button" onClick={() => onOpen(p)} className="btn-ghost !py-1.5 !px-3 text-sm">
                        Öppna <Icon name="arrow_forward" size={16} />
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )
      ) : voices.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-ink/20 bg-white/60 px-6 py-14 text-center">
          <span className="w-14 h-14 mx-auto rounded-2xl bg-ink/[0.05] text-ink/60 flex items-center justify-center">
            <Icon name="record_voice_over" size={28} />
          </span>
          <h3 className="mt-4 text-xl font-heading font-bold text-ink">Inga sparade författarspråk än</h3>
          <p className="mt-1 text-ink/55 max-w-md mx-auto">
            När du startar en bok lär sig AI:n hur du skriver. Spara språket så kan du använda det i fler böcker – även när AI:n skriver en ny bok åt dig.
          </p>
          <button type="button" onClick={onNew} className="btn-primary mt-6">
            <Icon name="add" size={19} /> Ny bok att slutföra
          </button>
        </div>
      ) : (
        <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {voices.map(v => (
            <li key={v.id} className="card-glass p-5 flex flex-col">
              <button type="button" onClick={() => setOpenVoice(v)} className="text-left flex-1 min-w-0">
                <div className="flex items-center gap-3">
                  <span className="w-10 h-10 shrink-0 rounded-xl bg-ink text-white flex items-center justify-center"><Icon name="record_voice_over" size={20} /></span>
                  <div className="min-w-0">
                    <h3 className="font-heading font-bold text-ink truncate">{v.name}</h3>
                    <p className="text-xs text-ink/50 truncate">
                      {[v.sourceTitle && `Från ${v.sourceTitle}`, `${v.samples.length} utdrag`, v.profile?.tense].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                </div>
                <p className="mt-3 text-sm text-ink/65 line-clamp-3 leading-relaxed">{v.profile?.summary || 'Ingen sammanfattning.'}</p>
              </button>
              <div className="mt-3 pt-3 border-t border-line flex items-center justify-between gap-2">
                <span className="text-xs text-ink/45 truncate">Sparad {formatUpdated(v.updatedAt || v.createdAt)}</span>
                <button type="button" onClick={() => setOpenVoice(v)} className="btn-ghost !py-1.5 !px-3 text-sm shrink-0">
                  <Icon name="visibility" size={16} /> Visa
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {openVoice && (
        <VoiceModal
          key={openVoice.id}
          voice={openVoice}
          onClose={() => setOpenVoice(null)}
          onSaved={() => { setOpenVoice(null); onVoicesChanged(); }}
        />
      )}
    </div>
  );
}

function VoiceModal({ voice, onClose, onSaved }: { voice: AuthorVoice; onClose: () => void; onSaved: () => void }) {
  const [draft, setDraft] = useState<AuthorVoice>(voice);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const { armed, confirm } = useArmed();
  const changed = JSON.stringify(draft) !== JSON.stringify(voice);

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      await saveAuthorVoice({ ...draft, name: draft.name.trim() || voice.name });
      onSaved();
    } catch (err) {
      setError(errorText(err, 'Språket kunde inte sparas'));
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!confirm('delete')) return;
    try {
      await deleteAuthorVoice(voice.id);
      onSaved();
    } catch (err) {
      setError(errorText(err, 'Språket kunde inte tas bort'));
    }
  };

  // Stäng utan att spara bara efter en andra bekräftelse om något ändrats
  const requestClose = () => {
    if (changed && !confirm('discard')) return;
    onClose();
  };

  return (
    <Modal
      eyebrow="Författarspråk"
      title={draft.name || 'Namnlöst språk'}
      onClose={requestClose}
      wide
      footer={
        <div className="flex items-center justify-between gap-2">
          <button type="button" onClick={remove} className={armed === 'delete' ? 'btn-danger !py-2 !px-4 text-sm animate-pop' : 'btn-ghost !py-2 !px-3.5 text-sm hover:!text-red-600'}>
            <Icon name="delete" size={17} /> {armed === 'delete' ? 'Ta bort för gott?' : 'Ta bort'}
          </button>
          <div className="flex gap-2">
            <button type="button" onClick={requestClose} className="btn-ghost !py-2 !px-3.5 text-sm">
              {armed === 'discard' ? 'Släng ändringar?' : 'Avbryt'}
            </button>
            <button type="button" onClick={save} disabled={saving || !changed} className="btn-primary !py-2 !px-4 text-sm">
              {saving ? <span className="spinner !w-4 !h-4" /> : <Icon name="check" size={17} />} Spara
            </button>
          </div>
        </div>
      }
    >
      {error && <div className="note-error mb-4" role="alert">{error}</div>}
      <p className="text-sm text-ink/55 mb-5">
        Så här har AI:n uppfattat språket{voice.sourceTitle ? ` i ${voice.sourceTitle}` : ''}. Justera det som inte stämmer – ändringarna gäller nya böcker som använder språket.
      </p>
      <VoiceProfileEditor voice={draft} onChange={setDraft} />
    </Modal>
  );
}
