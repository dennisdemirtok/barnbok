'use client';

import { Fragment, useMemo, useState } from 'react';
import { BookProject, Spread } from '@/lib/types';
import Icon from './Icon';

interface Props {
  book: BookProject;
  // Sparar det rättade uppslaget. Returnerar ett felmeddelande, eller null när allt gick bra.
  onSaveSpread: (spread: Spread) => Promise<string | null>;
  // Kort rad om var rättelserna sparas (molnet eller bara enheten)
  saveHint?: string;
}

const spreadName = (s: Spread) =>
  s.pages === 'omslag' ? 'Omslag' : s.pages === 'slutsida' ? 'Slutsida' : `Sida ${s.pages}`;

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Markerar sökordet i texten
function Highlight({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const parts = text.split(new RegExp(`(${escapeRegExp(query)})`, 'gi'));
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1
          ? <mark key={i} className="bg-amber-200/80 text-ink rounded px-0.5">{part}</mark>
          : <Fragment key={i}>{part}</Fragment>
      )}
    </>
  );
}

// Rätta texten uppslag för uppslag utan att röra bilderna
export default function TextCorrections({ book, onSaveSpread, saveHint }: Props) {
  const [query, setQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [savedId, setSavedId] = useState<string | null>(null);

  const q = query.trim();
  const withText = useMemo(() => book.spreads.filter(s => s.textBlocks.some(b => b.text.trim())), [book.spreads]);
  const matches = useMemo(() => {
    if (!q) return withText;
    const needle = q.toLowerCase();
    // Nyss rättade uppslag ligger kvar i listan även om ordet inte finns längre
    return withText.filter(s => s.id === savedId || s.textBlocks.some(b => b.text.toLowerCase().includes(needle)));
  }, [withText, q, savedId]);
  const hitCount = useMemo(() => {
    if (!q) return 0;
    const re = new RegExp(escapeRegExp(q), 'gi');
    return matches.reduce((n, s) => n + s.textBlocks.reduce((m, b) => m + (b.text.match(re)?.length || 0), 0), 0);
  }, [matches, q]);

  const startEdit = (spread: Spread) => {
    setEditingId(spread.id);
    setDraft(spread.textBlocks.map(b => b.text));
    setError('');
    setSavedId(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraft([]);
    setError('');
  };

  const save = async (spread: Spread) => {
    const unchanged = draft.every((t, i) => t === spread.textBlocks[i]?.text);
    if (unchanged) {
      cancelEdit();
      return;
    }
    setSaving(true);
    setError('');
    try {
      const updated: Spread = {
        ...spread,
        textBlocks: spread.textBlocks.map((b, i) => ({ ...b, text: draft[i] ?? b.text })),
      };
      const problem = await onSaveSpread(updated);
      if (problem) {
        setError(problem);
        return;
      }
      setEditingId(null);
      setDraft([]);
      setSavedId(spread.id);
      setTimeout(() => setSavedId(prev => (prev === spread.id ? null : prev)), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rättelsen kunde inte sparas');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="glass rounded-4xl p-4 sm:p-5">
        <h3 className="font-heading font-semibold text-lg text-ink">Rätta texten</h3>
        <p className="mt-1 text-sm text-ink/60 leading-relaxed">
          Sök efter ordet du vill ändra, tryck på <span className="font-medium text-ink">Rätta texten</span> vid uppslaget och spara. Bilderna ändras inte.
        </p>
        <div className="relative mt-3 max-w-md">
          <Icon name="search" size={20} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink/40" />
          <input
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Sök ett ord i boken"
            aria-label="Sök ett ord i boken"
            className="field !pl-11"
          />
        </div>
        <p className="mt-2 text-xs text-ink/55" aria-live="polite">
          {q
            ? matches.length === 0
              ? `Hittade inte "${q}" i boken.`
              : `"${q}" finns ${hitCount} ${hitCount === 1 ? 'gång' : 'gånger'} på ${matches.length} uppslag.`
            : `${withText.length} uppslag med text.`}
          {saveHint ? ` ${saveHint}` : ''}
        </p>
      </div>

      <ul className="space-y-3">
        {matches.map(spread => {
          const editing = editingId === spread.id;
          return (
            <li key={spread.id} className="card-glass hover:!shadow-soft p-4 sm:p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-sm text-ink">{spreadName(spread)}</p>
                  {spread.chapter && <p className="text-xs text-ink/45 truncate">{spread.chapter}</p>}
                </div>
                {!editing && (
                  <div className="flex items-center gap-2">
                    {savedId === spread.id && (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
                        <Icon name="check" size={15} /> Sparad
                      </span>
                    )}
                    <button
                      onClick={() => startEdit(spread)}
                      disabled={saving || (editingId !== null && !editing)}
                      className="btn-ghost !py-1.5 !px-3 !text-sm disabled:opacity-40"
                    >
                      <Icon name="edit" size={16} /> Rätta texten
                    </button>
                  </div>
                )}
              </div>

              {editing ? (
                <div className="mt-3 space-y-2">
                  {draft.map((text, i) => (
                    <textarea
                      key={i}
                      value={text}
                      autoFocus={i === 0}
                      onChange={e => setDraft(prev => prev.map((t, j) => (j === i ? e.target.value : t)))}
                      rows={Math.min(14, Math.max(3, Math.ceil(text.length / 60) + text.split('\n').length))}
                      aria-label={`Text på ${spreadName(spread)}`}
                      className="field text-sm leading-relaxed resize-y"
                    />
                  ))}
                  {error && <div className="note-error">{error}</div>}
                  <div className="flex flex-wrap gap-2">
                    <button onClick={() => save(spread)} disabled={saving} className="btn-action !py-2 !text-sm">
                      {saving ? <span className="spinner !w-4 !h-4" /> : <Icon name="check" size={17} />}
                      {saving ? 'Sparar...' : 'Spara rättelsen'}
                    </button>
                    <button onClick={cancelEdit} disabled={saving} className="btn-ghost !py-2 !text-sm">Avbryt</button>
                  </div>
                </div>
              ) : (
                <div className="mt-2 space-y-2">
                  {spread.textBlocks.filter(b => b.text.trim()).map((block, i) => (
                    <p key={i} className="text-sm text-ink/80 leading-relaxed whitespace-pre-line break-words">
                      <Highlight text={block.text} query={q} />
                    </p>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
