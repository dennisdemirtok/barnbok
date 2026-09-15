'use client';

import { useState } from 'react';
import type { AuthorVoice, VoiceProfile } from '@/lib/author-types';
import Icon from '../Icon';
import { PROFILE_FIELDS, TENSE_OPTIONS, normalizeProfile } from './finish-utils';

interface Props {
  voice: AuthorVoice;
  onChange: (voice: AuthorVoice) => void;
  showName?: boolean;
}

// Visar och redigerar ett författarspråk: sammanfattning, egenskaper, grepp och utdrag
export default function VoiceProfileEditor({ voice, onChange, showName = true }: Props) {
  const profile = normalizeProfile(voice.profile);
  const [showDetails, setShowDetails] = useState(false);
  const [showSamples, setShowSamples] = useState(false);

  const setProfile = (patch: Partial<VoiceProfile>) => onChange({ ...voice, profile: { ...profile, ...patch } });
  const listValue = (items: string[]) => items.join('\n');
  // Tomma rader behålls medan man skriver och rensas bort när språket skickas till AI:n
  const parseList = (value: string) => value.split('\n');

  return (
    <div className="space-y-5">
      {showName && (
        <div>
          <label htmlFor={`voice-name-${voice.id}`} className="block text-sm font-semibold text-ink/80 mb-2">Namn</label>
          <input
            id={`voice-name-${voice.id}`}
            className="field"
            value={voice.name}
            onChange={e => onChange({ ...voice, name: e.target.value })}
            placeholder="T.ex. Dennis – Bydalen"
          />
        </div>
      )}

      <div>
        <label htmlFor={`voice-summary-${voice.id}`} className="block text-sm font-semibold text-ink/80 mb-2">Så låter du</label>
        <textarea
          id={`voice-summary-${voice.id}`}
          className="field text-[15px] leading-relaxed min-h-[6rem] resize-y bg-brand/[0.03]"
          value={profile.summary}
          onChange={e => setProfile({ summary: e.target.value })}
          placeholder="Två eller tre meningar om hur texten känns."
        />
      </div>

      <div>
        <p className="text-sm font-semibold text-ink/80 mb-2">Tempus</p>
        <div className="flex flex-wrap gap-2">
          {TENSE_OPTIONS.map(t => (
            <button key={t} type="button" onClick={() => setProfile({ tense: t })} className={profile.tense === t ? 'chip-on' : 'chip'} aria-pressed={profile.tense === t}>
              {t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <ListField
          id={`voice-moves-${voice.id}`}
          label="Typiska grepp"
          hint="Ett per rad"
          value={listValue(profile.signatureMoves)}
          onChange={v => setProfile({ signatureMoves: parseList(v) })}
        />
        <ListField
          id={`voice-avoid-${voice.id}`}
          label="Gör aldrig"
          hint="Ett per rad"
          value={listValue(profile.avoid)}
          onChange={v => setProfile({ avoid: parseList(v) })}
        />
      </div>

      <div className="rounded-2xl border border-line">
        <button
          type="button"
          onClick={() => setShowDetails(v => !v)}
          className="w-full flex items-center justify-between gap-2 px-4 py-3 text-sm font-semibold text-ink/80 hover:bg-paper rounded-2xl"
          aria-expanded={showDetails}
        >
          <span className="inline-flex items-center gap-2"><Icon name="tune" size={18} /> Detaljer om språket</span>
          <Icon name={showDetails ? 'expand_less' : 'expand_more'} size={20} />
        </button>
        {showDetails && (
          <div className="grid sm:grid-cols-2 gap-3 px-4 pb-4">
            {PROFILE_FIELDS.map(f => (
              <div key={f.key} className={f.key === 'dialogueMarker' ? '' : 'sm:col-span-1'}>
                <label htmlFor={`voice-${f.key}-${voice.id}`} className="block text-xs font-semibold text-ink/60 mb-1">{f.label}</label>
                {f.key === 'dialogueMarker' ? (
                  <input
                    id={`voice-${f.key}-${voice.id}`}
                    className="field !py-2 text-sm font-mono"
                    value={profile[f.key]}
                    onChange={e => setProfile({ [f.key]: e.target.value })}
                    placeholder={f.placeholder}
                  />
                ) : (
                  <textarea
                    id={`voice-${f.key}-${voice.id}`}
                    className="field !py-2 text-sm min-h-[4.5rem] resize-y"
                    value={profile[f.key]}
                    onChange={e => setProfile({ [f.key]: e.target.value })}
                    placeholder={f.placeholder}
                  />
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-line">
        <button
          type="button"
          onClick={() => setShowSamples(v => !v)}
          className="w-full flex items-center justify-between gap-2 px-4 py-3 text-sm font-semibold text-ink/80 hover:bg-paper rounded-2xl"
          aria-expanded={showSamples}
        >
          <span className="inline-flex items-center gap-2">
            <Icon name="format_quote" size={18} /> Utdrag ur din text
            <span className="text-xs font-medium text-ink/45">({voice.samples.length})</span>
          </span>
          <Icon name={showSamples ? 'expand_less' : 'expand_more'} size={20} />
        </button>
        {showSamples && (
          <div className="px-4 pb-4 space-y-2">
            <p className="text-xs text-ink/55">AI:n läser de här utdragen ordagrant för att träffa din ton. Ta bort sådana som inte är typiska för dig.</p>
            {voice.samples.length === 0 && <p className="text-sm text-ink/45">Inga utdrag sparade.</p>}
            {voice.samples.map((s, i) => (
              <div key={i} className="group flex gap-2 rounded-xl bg-paper border border-line p-3">
                <p className="flex-1 text-sm text-ink/75 whitespace-pre-line leading-relaxed">{s}</p>
                <button
                  type="button"
                  onClick={() => onChange({ ...voice, samples: voice.samples.filter((_, j) => j !== i) })}
                  className="btn-icon !w-8 !h-8 shrink-0 hover:!text-red-600 hover:!bg-red-50"
                  aria-label="Ta bort utdraget"
                  title="Ta bort utdraget"
                >
                  <Icon name="close" size={17} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ListField({ id, label, hint, value, onChange }: { id: string; label: string; hint: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-semibold text-ink/80 mb-2">
        {label} <span className="font-normal text-ink/40">({hint.toLowerCase()})</span>
      </label>
      <textarea id={id} className="field text-sm min-h-[6.5rem] resize-y leading-relaxed" value={value} onChange={e => onChange(e.target.value)} />
    </div>
  );
}
