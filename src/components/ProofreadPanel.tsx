'use client';

import { useState } from 'react';
import { BookProject, ProofIssue, Spread } from '@/lib/types';
import { mergeProofResults, needsProof, proofSummary, resolveProofIssue } from '@/lib/proof';
import { proofreadBook } from '@/lib/proofread-client';
import Icon from './Icon';

interface Props {
  book: BookProject;
  // Sparar ändrade uppslag (lokalt och i molnet). Returnerar ett felmeddelande eller null.
  onChange: (changed: Spread[], next: BookProject) => Promise<string | null>;
}

const KIND_LABEL: Record<ProofIssue['kind'], string> = {
  stavning: 'Stavning',
  böjning: 'Böjning',
  särskrivning: 'Särskrivning',
  skiljetecken: 'Skiljetecken',
  repliker: 'Repliker',
  ordval: 'Ordval',
  övrigt: 'Språk',
};

const spreadName = (s: Spread) =>
  s.pages === 'omslag' ? 'Omslag' : s.pages === 'slutsida' ? 'Slutsida' : `Sida ${s.pages}`;

// Korrekturläsningen: bara språkfel (stavning, böjning, särskrivning, skiljetecken,
// repliker). Text som AI:n skrivit rättas direkt när boken skapas; här syns det
// som är kvar, och ändrad eller äldre text kan läsas på nytt.
export default function ProofreadPanel({ book, onChange }: Props) {
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  const summary = proofSummary(book);
  // Förslag gäller bara uppslag vars text är densamma som när de lästes
  const open = book.spreads
    .filter(s => !needsProof(s))
    .flatMap(s => (s.proof?.issues ?? []).map((issue, i) => ({ spread: s, issue, key: `${s.id}:${i}` })));

  const save = async (changed: Spread[]) => {
    if (changed.length === 0) return;
    const byId = new Map(changed.map(s => [s.id, s]));
    const next = { ...book, spreads: book.spreads.map(s => byId.get(s.id) ?? s) };
    const problem = await onChange(changed, next);
    if (problem) setError(problem);
  };

  const run = async () => {
    setRunning(true);
    setError('');
    try {
      const merged = mergeProofResults(book, await proofreadBook(book));
      await save(merged.spreads.filter((s, i) => s !== book.spreads[i]));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Korrekturläsningen gick inte att göra just nu');
    } finally {
      setRunning(false);
    }
  };

  const resolve = async (spread: Spread, issue: ProofIssue, accept: boolean, key: string) => {
    setBusy(key);
    setError('');
    try {
      await save([resolveProofIssue(spread, issue, accept)]);
    } finally {
      setBusy(null);
    }
  };

  const fixAll = async () => {
    setBusy('all');
    setError('');
    try {
      const changed = new Map<string, Spread>();
      for (const { spread, issue } of open) {
        changed.set(spread.id, resolveProofIssue(changed.get(spread.id) ?? spread, issue, true));
      }
      await save(Array.from(changed.values()));
    } finally {
      setBusy(null);
    }
  };

  if (summary.total === 0) return null;
  const never = summary.unchecked === summary.total;

  return (
    <div className="card-glass hover:!shadow-soft p-4 sm:p-6 space-y-4">
      <div className="flex items-start gap-3">
        <span className="w-10 h-10 shrink-0 rounded-xl bg-ink text-white flex items-center justify-center">
          <Icon name="spellcheck" size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="font-heading text-lg font-bold text-ink">Korrekturläsning</h3>
          <p className="text-sm text-ink/60 leading-relaxed">
            Läser texten ord för ord och letar språkfel: stavning, böjning, särskrivning, skiljetecken och repliker.
            {book.aiWritten ? ' Tydliga fel i AI:ns text rättas direkt.' : ' Varje rättelse är ett förslag - din text ändras bara om du säger ja.'}
          </p>
        </div>
      </div>

      {running ? (
        <div className="flex items-center gap-2.5 text-sm text-ink/70">
          <span className="spinner !w-4 !h-4 text-brand" />
          Korrekturläser {never ? 'boken' : `${summary.unchecked} uppslag`}...
          <span className="text-xs text-ink/45">(brukar ta under en minut)</span>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {summary.unchecked > 0 ? (
            <>
              <span className="text-sm text-ink/70 mr-1">
                {never ? 'Boken är inte korrekturläst än.' : `${summary.unchecked} uppslag har ändrats sedan korrekturläsningen.`}
              </span>
              <button onClick={() => void run()} disabled={busy !== null} className="btn-action !py-2 text-sm">
                <Icon name="spellcheck" size={18} /> {never ? 'Korrekturläs boken' : `Korrekturläs ${summary.unchecked} uppslag`}
              </button>
            </>
          ) : open.length === 0 ? (
            <p className="note-success text-sm w-full">
              Korrekturläst - inga språkfel kvar.{summary.fixed > 0 ? ` ${summary.fixed} fel har rättats.` : ''}
            </p>
          ) : null}
          {open.length > 0 && (
            <>
              <span className="text-xs text-ink/55">
                {open.length} förslag{summary.fixed > 0 ? ` · ${summary.fixed} rättade` : ''}
              </span>
              {open.length > 1 && (
                <button onClick={() => void fixAll()} disabled={busy !== null} className="btn-ghost !py-1.5 !px-3 !text-xs">
                  {busy === 'all' ? <span className="spinner !w-3.5 !h-3.5" /> : <Icon name="done_all" size={15} />}
                  Rätta alla ({open.length})
                </button>
              )}
            </>
          )}
        </div>
      )}

      {open.length > 0 && (
        <ul className="space-y-2">
          {open.map(({ spread, issue, key }) => (
            <li key={key} className="rounded-2xl border border-line bg-white px-3.5 py-3">
              <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-semibold">
                <span className="px-2 py-0.5 rounded-full bg-sky-100 text-sky-800">{KIND_LABEL[issue.kind] || 'Språk'}</span>
                {issue.certain && <span className="px-2 py-0.5 rounded-full bg-red-50 text-red-700">Tydligt fel</span>}
                <span className="text-ink/45">{spread.chapter ? `${spread.chapter} · ` : ''}{spreadName(spread)}</span>
              </div>
              <p className="mt-1.5 text-sm leading-relaxed">
                <span className="line-through decoration-red-400/70 text-ink/55">{issue.quote}</span>
                <Icon name="arrow_forward" size={14} className="mx-1 text-ink/35 align-middle" />
                <span className="text-ink font-medium">{issue.fix}</span>
              </p>
              {issue.reason && <p className="mt-1 text-xs text-ink/55 leading-snug">{issue.reason}</p>}
              <div className="mt-2 flex flex-wrap gap-1.5">
                <button onClick={() => void resolve(spread, issue, true, key)} disabled={busy !== null || running} className="btn-action !py-1.5 !px-3 !text-xs">
                  {busy === key ? <span className="spinner !w-3.5 !h-3.5" /> : <Icon name="check" size={15} />} Rätta
                </button>
                <button onClick={() => void resolve(spread, issue, false, key)} disabled={busy !== null || running} className="btn-ghost !py-1.5 !px-3 !text-xs">
                  Hoppa över
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {error && <div className="note-error">{error}</div>}
    </div>
  );
}
