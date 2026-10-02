'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { BookProject, Spread } from '@/lib/types';
import Icon from './Icon';

// Lektören: läser hela manuset en gång och föreslår rättelser med exakta citat,
// så att varje rättelse går att göra med ett klick.

interface Issue {
  kind: 'logik' | 'språk' | 'tydlighet' | 'konsekvens' | 'lämplighet';
  severity: 'major' | 'minor';
  spread: number;
  quote: string;
  suggestion: string;
  reason: string;
}

interface Review { summary: string; issues: Issue[] }

type Status = 'open' | 'done' | 'skipped';

interface Props {
  book: BookProject;
  // Sparar det rättade uppslaget. Returnerar ett felmeddelande, eller null när allt gick bra.
  onSaveSpread: (spread: Spread) => Promise<string | null>;
}

const KIND_LABEL: Record<Issue['kind'], string> = {
  logik: 'Logik',
  språk: 'Språk',
  tydlighet: 'Tydlighet',
  konsekvens: 'Konsekvens',
  lämplighet: 'Att fundera på',
};

const spreadName = (s: Spread) =>
  s.pages === 'omslag' ? 'Omslag' : s.pages === 'slutsida' ? 'Slutsida' : `Sida ${s.pages}`;

const storageKey = (bookId: string) => `barnbok:lektor:${bookId}`;
// Pågående läsning: sidan kan lämnas och hämtar resultatet när man kommer tillbaka
const taskKey = (bookId: string) => `barnbok:lektor-uppdrag:${bookId}`;

// Uppslaget där citatet faktiskt står: det lektören angav, annars där det finns
function locate(issue: Issue, spreads: Spread[]): Spread | undefined {
  const has = (s: Spread) => s.textBlocks.some(b => b.text.includes(issue.quote));
  const named = spreads.find(s => s.spreadNumber === issue.spread);
  if (named && has(named)) return named;
  return spreads.find(has);
}

export default function ManuscriptReview({ book, onSaveSpread }: Props) {
  const [review, setReview] = useState<Review | null>(null);
  const [status, setStatus] = useState<Record<number, Status>>({});
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<number | 'all' | null>(null);
  const [showMinor, setShowMinor] = useState(false);
  const stopped = useRef(false);

  // En tidigare läsning av samma bok finns kvar på enheten
  useEffect(() => {
    stopped.current = false;
    try {
      const saved = localStorage.getItem(storageKey(book.id));
      if (saved) {
        const parsed = JSON.parse(saved) as { review: Review; status: Record<number, Status> };
        setReview(parsed.review);
        setStatus(parsed.status || {});
      }
    } catch { /* lagring blockerad */ }
    return () => { stopped.current = true; };
  }, [book.id]);

  useEffect(() => {
    if (!review) return;
    try { localStorage.setItem(storageKey(book.id), JSON.stringify({ review, status })); } catch { /* lagring blockerad */ }
  }, [review, status, book.id]);

  const sections = useMemo(() => book.spreads
    .filter(s => s.pages !== 'omslag')
    .map(s => ({ spread: s.spreadNumber, label: spreadName(s), text: s.textBlocks.map(b => b.text).join('\n').trim() }))
    .filter(s => s.text), [book.spreads]);
  const words = sections.reduce((n, s) => n + s.text.split(/\s+/).length, 0);

  // Väntar på en läsning som redan är startad (även efter att sidan lämnats)
  const follow = async (id: string, began: number) => {
    setError('');
    setRunning(true);
    const tick = setInterval(() => setElapsed(Math.round((Date.now() - began) / 1000)), 1000);
    try {
      for (let i = 0; i < 120 && !stopped.current; i++) {
        await new Promise(r => setTimeout(r, 4000));
        if (stopped.current) return;
        const poll = await fetch(`/api/manuscript-review?id=${id}`, { cache: 'no-store' });
        const task = await poll.json().catch(() => null) as { state?: string; review?: Review; error?: string } | null;
        if (task?.state === 'done' && task.review) {
          setReview(task.review);
          setStatus({});
          try { localStorage.removeItem(taskKey(book.id)); } catch { /* lagring blockerad */ }
          return;
        }
        if (task?.state === 'failed') throw new Error(task.error || 'Lektören kunde inte läsa klart');
        if (poll.status === 404) throw new Error('Läsningen tappades bort (servern startade om) - försök igen');
      }
      if (!stopped.current) throw new Error('Lektören blev inte klar i tid - försök igen');
    } catch (err) {
      try { localStorage.removeItem(taskKey(book.id)); } catch { /* lagring blockerad */ }
      setError(err instanceof Error ? err.message : 'Lektören kunde inte läsa boken');
    } finally {
      clearInterval(tick);
      if (!stopped.current) setRunning(false);
    }
  };

  useEffect(() => {
    try {
      const saved = localStorage.getItem(taskKey(book.id));
      if (saved) {
        const { id, began } = JSON.parse(saved) as { id: string; began: number };
        if (Date.now() - began < 30 * 60 * 1000) void follow(id, began);
        else localStorage.removeItem(taskKey(book.id));
      }
    } catch { /* lagring blockerad */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.id]);

  const start = async () => {
    setError('');
    setRunning(true);
    setElapsed(0);
    const began = Date.now();
    try {
      const res = await fetch('/api/manuscript-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: book.title,
          targetAge: book.targetAge,
          characters: book.characters.map(c => ({ name: c.name, role: c.role, note: c.age })),
          sections,
        }),
      });
      const data = await res.json().catch(() => null) as { id?: string; error?: string } | null;
      if (!res.ok || !data?.id) throw new Error(data?.error || 'Lektören kunde inte starta');
      try { localStorage.setItem(taskKey(book.id), JSON.stringify({ id: data.id, began })); } catch { /* lagring blockerad */ }
      // Läsningen tar några minuter (en hel bok med eftertanke)
      await follow(data.id, began);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lektören kunde inte läsa boken');
      setRunning(false);
    }
  };

  // Rättar ett eller flera fynd. Flera fynd i samma uppslag läggs på varandra
  const apply = async (indexes: number[]) => {
    if (!review) return;
    const updated = new Map<string, Spread>();
    const appliedHere: number[] = [];
    let failed = '';
    for (const i of indexes) {
      const issue = review.issues[i];
      const base = locate(issue, book.spreads.map(s => updated.get(s.id) ?? s));
      if (!base) continue;
      const blockIndex = base.textBlocks.findIndex(b => b.text.includes(issue.quote));
      const blocks = base.textBlocks.map((b, j) => (j === blockIndex ? { ...b, text: b.text.replace(issue.quote, issue.suggestion) } : b));
      updated.set(base.id, { ...base, textBlocks: blocks });
      appliedHere.push(i);
    }
    for (const spread of Array.from(updated.values())) {
      const result = await onSaveSpread(spread);
      if (result) failed = result;
    }
    if (failed) setError(failed);
    else setStatus(prev => ({ ...prev, ...Object.fromEntries(appliedHere.map(i => [i, 'done' as Status])) }));
  };

  const applyOne = async (i: number) => {
    setBusy(i);
    setError('');
    try { await apply([i]); } finally { setBusy(null); }
  };

  const issues = review?.issues || [];
  const fixable = (i: number) => !!locate(issues[i], book.spreads);
  const openLanguage = issues.map((issue, i) => i).filter(i => issues[i].kind === 'språk' && status[i] !== 'done' && status[i] !== 'skipped' && fixable(i));
  const majors = issues.map((_, i) => i).filter(i => issues[i].severity === 'major');
  const minors = issues.map((_, i) => i).filter(i => issues[i].severity !== 'major');
  const doneCount = Object.values(status).filter(s => s === 'done').length;

  const row = (i: number) => {
    const issue = issues[i];
    const spread = locate(issue, book.spreads);
    const state = status[i] || 'open';
    return (
      <li key={i} className={`rounded-2xl border px-3.5 py-3 ${state === 'open' ? 'border-line bg-white' : 'border-line bg-paper/60 opacity-70'}`}>
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-semibold">
          <span className={`px-2 py-0.5 rounded-full ${issue.kind === 'logik' ? 'bg-violet-100 text-violet-800' : issue.kind === 'språk' ? 'bg-sky-100 text-sky-800' : issue.kind === 'lämplighet' ? 'bg-amber-100 text-amber-800' : 'bg-ink/[0.06] text-ink/70'}`}>
            {KIND_LABEL[issue.kind] || issue.kind}
          </span>
          {spread && <span className="text-ink/45">{spreadName(spread)}</span>}
          {state === 'done' && <span className="text-emerald-700 inline-flex items-center gap-0.5"><Icon name="check" size={14} /> Rättat</span>}
          {state === 'skipped' && <span className="text-ink/45">Hoppat över</span>}
        </div>
        <p className="mt-1.5 text-sm leading-relaxed">
          <span className="line-through decoration-red-400/70 text-ink/55">{issue.quote}</span>
          <Icon name="arrow_forward" size={14} className="mx-1 text-ink/35 align-middle" />
          <span className="text-ink font-medium">{issue.suggestion || '(stryk)'}</span>
        </p>
        <p className="mt-1 text-xs text-ink/55 leading-snug">{issue.reason}</p>
        {state === 'open' && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {spread ? (
              <button onClick={() => void applyOne(i)} disabled={busy !== null} className="btn-action !py-1.5 !px-3 !text-xs">
                {busy === i ? <span className="spinner !w-3.5 !h-3.5" /> : <Icon name="check" size={15} />} Ändra
              </button>
            ) : (
              <span className="text-[11px] text-ink/45 self-center">Texten hittades inte ordagrant - rätta den själv nedan.</span>
            )}
            <button onClick={() => setStatus(prev => ({ ...prev, [i]: 'skipped' }))} disabled={busy !== null} className="btn-ghost !py-1.5 !px-3 !text-xs">
              Hoppa över
            </button>
          </div>
        )}
      </li>
    );
  };

  return (
    <div className="card-glass hover:!shadow-soft p-4 sm:p-6 space-y-4">
      <div className="flex items-start gap-3">
        <span className="w-10 h-10 shrink-0 rounded-xl bg-ink text-white flex items-center justify-center">
          <Icon name="rate_review" size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="font-heading text-lg font-bold text-ink">Lektören</h3>
          <p className="text-sm text-ink/60 leading-relaxed">
            Läser hela boken som en förlagslektör och hittar logiska glapp, språkfel och otydligheter. Varje förslag går att göra med ett klick - din röst ändras inte.
          </p>
        </div>
      </div>

      {running ? (
        <div className="flex items-center gap-2.5 text-sm text-ink/70">
          <span className="spinner !w-4 !h-4 text-brand" />
          Lektören läser {words.toLocaleString('sv-SE')} ord... {elapsed > 0 ? `${elapsed} s` : ''}
          <span className="text-xs text-ink/45">(brukar ta 3-5 minuter - du kan läsa vidare under tiden)</span>
        </div>
      ) : !review ? (
        <button onClick={() => void start()} disabled={sections.length === 0} className="btn-action">
          <Icon name="rate_review" size={18} /> Låt lektören läsa boken
        </button>
      ) : (
        <>
          {review.summary && <p className="text-sm text-ink/75 leading-relaxed">{review.summary}</p>}
          <div className="flex flex-wrap items-center gap-2 text-xs text-ink/55">
            <span>{issues.length} förslag · {majors.length} viktiga · {doneCount} rättade</span>
            {openLanguage.length > 1 && (
              <button
                onClick={async () => { setBusy('all'); setError(''); try { await apply(openLanguage); } finally { setBusy(null); } }}
                disabled={busy !== null}
                className="btn-ghost !py-1.5 !px-3 !text-xs"
              >
                {busy === 'all' ? <span className="spinner !w-3.5 !h-3.5" /> : <Icon name="spellcheck" size={15} />}
                Rätta alla språkfel ({openLanguage.length})
              </button>
            )}
            <button onClick={() => void start()} disabled={busy !== null} className="btn-ghost !py-1.5 !px-3 !text-xs">
              <Icon name="refresh" size={15} /> Läs igen
            </button>
          </div>
          {issues.length === 0 ? (
            <p className="note-success text-sm">Lektören hittade inget som behöver rättas.</p>
          ) : (
            <>
              <ul className="space-y-2">{majors.map(row)}</ul>
              {minors.length > 0 && (
                <div>
                  <button onClick={() => setShowMinor(v => !v)} className="text-xs font-semibold text-ink/60 hover:text-ink inline-flex items-center gap-1">
                    <Icon name={showMinor ? 'expand_less' : 'expand_more'} size={16} />
                    {showMinor ? 'Dölj finputs' : `Visa finputs (${minors.length})`}
                  </button>
                  {showMinor && <ul className="mt-2 space-y-2">{minors.map(row)}</ul>}
                </div>
              )}
            </>
          )}
        </>
      )}
      {error && <div className="note-error">{error}</div>}
    </div>
  );
}
