'use client';

import { useState } from 'react';
import type { AuthorVoice, FinishProject, FinishSettings } from '@/lib/author-types';
import Icon from '../Icon';
import VoiceProfileEditor from './VoiceProfileEditor';
import { BusyNote, Modal, Stepper } from './ui';
import { AGE_OPTIONS, FREEDOM_OPTIONS, fmt, formatUpdated } from './finish-utils';

export type SettingsTab = 'book' | 'voice';

interface Props {
  project: FinishProject;
  voices: AuthorVoice[];
  initialTab?: SettingsTab;
  onClose: () => void;
  onPatch: (patch: Partial<Pick<FinishProject, 'title' | 'author'>>) => void;
  onSettings: (patch: Partial<FinishSettings>) => void;
  onVoice: (voice: AuthorVoice | undefined) => void;
  onReanalyze: () => void;
  reanalyzing: { startedAt: number } | null;
  canReanalyze: boolean;
  onSaveVoice: (asNew: boolean) => Promise<boolean>;
  voiceError?: string;
  aiLocked: boolean;
}

export default function SettingsModal({
  project, voices, initialTab = 'book', onClose, onPatch, onSettings, onVoice, onReanalyze, reanalyzing, canReanalyze,
  onSaveVoice, voiceError, aiLocked,
}: Props) {
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [picking, setPicking] = useState(false);
  const { settings, voice } = project;
  const inLibrary = !!voice && voices.some(v => v.id === voice.id);
  const otherVoices = voices.filter(v => v.id !== voice?.id);
  const diff = settings.totalChapters - project.chapters.length;

  const save = async (asNew: boolean) => {
    setSaving(true);
    setSaved(false);
    const ok = await onSaveVoice(asNew);
    setSaving(false);
    if (ok) {
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2500);
    }
  };

  return (
    <Modal
      eyebrow="Inställningar"
      title={project.title || 'Boken'}
      onClose={onClose}
      wide
      footer={
        <div className="flex justify-end">
          <button type="button" onClick={onClose} className="btn-primary !py-2.5">Klar</button>
        </div>
      }
    >
      <div className="inline-flex p-1 rounded-full bg-paper border border-line mb-6" role="tablist">
        {([['book', 'Boken', 'menu_book'], ['voice', 'Författarspråk', 'record_voice_over']] as const).map(([key, label, icon]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-semibold transition-all ${tab === key ? 'bg-white text-ink shadow-soft' : 'text-ink/55 hover:text-ink'}`}
          >
            <Icon name={icon} size={18} /> {label}
          </button>
        ))}
      </div>

      {tab === 'book' ? (
        <div className="space-y-6">
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="set-title" className="block text-sm font-semibold text-ink/80 mb-2">Titel</label>
              <input id="set-title" className="field" value={project.title} onChange={e => onPatch({ title: e.target.value })} />
            </div>
            <div>
              <label htmlFor="set-author" className="block text-sm font-semibold text-ink/80 mb-2">Författare</label>
              <input id="set-author" className="field" value={project.author} onChange={e => onPatch({ author: e.target.value })} />
            </div>
          </div>

          <div>
            <p className="text-sm font-semibold text-ink/80 mb-2">Ålder</p>
            <div className="flex flex-wrap gap-2">
              {AGE_OPTIONS.map(age => (
                <button key={age} type="button" onClick={() => onSettings({ targetAge: age })} className={settings.targetAge === age ? 'chip-on' : 'chip'} aria-pressed={settings.targetAge === age}>
                  {age}
                </button>
              ))}
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-5">
            <div>
              <p className="text-sm font-semibold text-ink/80 mb-2">Antal kapitel</p>
              <Stepper value={settings.totalChapters} min={1} max={60} label="antal kapitel" onChange={n => onSettings({ totalChapters: n })} />
              {diff > 0 && (
                <p className="text-xs text-ink/55 mt-2">Tidslinjen har {project.chapters.length} kapitel. Tryck på <span className="font-semibold">Föreslå</span> i tidslinjen för att lägga till {diff} till.</p>
              )}
              {diff < 0 && (
                <p className="text-xs text-ink/55 mt-2">Tidslinjen har {project.chapters.length} kapitel – ta bort de du inte vill ha kvar.</p>
              )}
            </div>
            <div>
              <p className="text-sm font-semibold text-ink/80 mb-2">Ord per kapitel</p>
              <Stepper value={settings.wordsPerChapter} min={100} max={8000} step={50} label="ord per kapitel" suffix="ord" onChange={n => onSettings({ wordsPerChapter: n })} />
            </div>
          </div>

          <div>
            <p className="text-sm font-semibold text-ink/80 mb-2">Hur fritt får AI:n skriva?</p>
            <FreedomPicker value={settings.freedom} onChange={freedom => onSettings({ freedom })} />
          </div>

          <div>
            <label htmlFor="set-genre" className="block text-sm font-semibold text-ink/80 mb-2">Genre <span className="font-normal text-ink/40">(valfritt)</span></label>
            <input id="set-genre" className="field" value={settings.genre || ''} onChange={e => onSettings({ genre: e.target.value || undefined })} placeholder="T.ex. spänning, fantasy, vardagsrealism" />
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          {reanalyzing && <BusyNote label="Lär sig ditt språk från dina kapitel..." startedAt={reanalyzing.startedAt} stages={['Läser din text', 'Lyssnar på rytmen', 'Plockar ut typiska utdrag']} />}
          {voiceError && <div className="note-error" role="alert">{voiceError}</div>}

          {voice ? (
            <div className="rounded-2xl bg-paper border border-line p-4 flex flex-col sm:flex-row sm:items-center gap-3">
              <span className="w-11 h-11 shrink-0 rounded-2xl bg-ink text-white flex items-center justify-center">
                <Icon name="record_voice_over" size={22} />
              </span>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-ink truncate">{voice.name || 'Namnlöst språk'}</p>
                <p className="text-xs text-ink/55">
                  {inLibrary ? 'Sparat i ditt bibliotek' : 'Bara i den här boken'}
                  {voice.createdAt ? ` · analyserat ${formatUpdated(voice.createdAt)}` : ''} · {fmt(voice.samples.length)} utdrag
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {inLibrary ? (
                  <>
                    <button type="button" onClick={() => save(false)} disabled={saving} className="btn-action !py-2 !px-4 text-sm">
                      {saving ? <span className="spinner !w-4 !h-4" /> : <Icon name={saved ? 'check' : 'save'} size={17} />}
                      {saved ? 'Sparat' : 'Uppdatera sparat'}
                    </button>
                    <button type="button" onClick={() => save(true)} disabled={saving} className="btn-ghost !py-2 !px-3.5 text-sm">Spara som nytt</button>
                  </>
                ) : (
                  <button type="button" onClick={() => save(false)} disabled={saving} className="btn-action !py-2 !px-4 text-sm">
                    {saving ? <span className="spinner !w-4 !h-4" /> : <Icon name={saved ? 'check' : 'bookmark_add'} size={17} />}
                    {saved ? 'Sparat' : 'Spara författarspråket'}
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-ink/20 bg-white/60 px-5 py-8 text-center">
              <Icon name="record_voice_over" size={30} className="text-ink/35" />
              <h4 className="mt-2 font-heading font-semibold text-ink">Inget författarspråk än</h4>
              <p className="text-sm text-ink/55 mt-1 max-w-sm mx-auto">Utan ett språk skriver AI:n i en neutral ton. Låt den lära sig från dina kapitel eller välj ett sparat.</p>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={onReanalyze} disabled={aiLocked || !canReanalyze} className="btn-ghost text-sm" title={canReanalyze ? undefined : 'Det behövs mer av din egen text'}>
              <Icon name="psychology" size={18} /> {voice ? 'Analysera igen från min text' : 'Analysera från min text'}
            </button>
            {otherVoices.length > 0 && (
              <button type="button" onClick={() => setPicking(v => !v)} className={`${picking ? 'chip-on !py-2.5' : 'btn-ghost'} text-sm`} aria-expanded={picking}>
                <Icon name="swap_horiz" size={18} /> Byt till ett sparat språk
              </button>
            )}
          </div>
          {!canReanalyze && (
            <p className="text-xs text-ink/45 -mt-3">Markera minst ett kapitel som din text (ca 150 ord) för att kunna analysera.</p>
          )}

          {picking && (
            <div className="grid sm:grid-cols-2 gap-2 animate-pop">
              {otherVoices.map(v => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => { onVoice({ ...v }); setPicking(false); }}
                  className="text-left rounded-2xl border border-line bg-white p-3 hover:border-brand/40 hover:shadow-soft transition-all"
                >
                  <p className="font-semibold text-ink text-sm truncate">{v.name}</p>
                  <p className="text-xs text-ink/55 line-clamp-2 mt-0.5">{v.profile?.summary || 'Ingen sammanfattning'}</p>
                </button>
              ))}
            </div>
          )}

          {voice && (
            <div className="pt-2 border-t border-line">
              <p className="text-xs text-ink/50 my-4">Ändringar här gäller den här boken. Spara för att kunna använda språket i andra böcker.</p>
              <VoiceProfileEditor voice={voice} onChange={onVoice} />
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

export function FreedomPicker({ value, onChange, stacked = false }: { value: FinishSettings['freedom']; onChange: (v: FinishSettings['freedom']) => void; stacked?: boolean }) {
  return (
    <div className={`grid grid-cols-1 gap-2 ${stacked ? '' : 'sm:grid-cols-3'}`} role="radiogroup">
      {FREEDOM_OPTIONS.map(o => {
        const on = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={`flex items-center gap-3 text-left rounded-2xl border p-3 transition-all ${stacked ? "" : "sm:flex-col sm:items-start sm:gap-2"} ${
              on ? 'border-ink bg-ink text-white' : 'border-line bg-white hover:border-ink/30'
            }`}
          >
            <Icon name={o.icon} size={22} className={on ? 'text-white' : 'text-ink/50'} />
            <span className="min-w-0">
              <span className="block text-sm font-semibold">{o.label}</span>
              <span className={`block text-xs mt-0.5 ${on ? 'text-white/70' : 'text-ink/55'}`}>{o.hint}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
