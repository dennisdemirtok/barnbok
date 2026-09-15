'use client';

import { ReactNode, useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { TimelineChapter } from '@/lib/author-types';
import Icon from '../Icon';

// ── Modal i samma stil som CharacterStudio (bottenark på mobil) ──
export function Modal({
  eyebrow,
  title,
  onClose,
  children,
  footer,
  wide = false,
  closeDisabled = false,
}: {
  eyebrow?: string;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  closeDisabled?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !closeDisabled) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, closeDisabled]);
  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  return (
    <div
      className="fixed inset-0 !m-0 bg-ink/50 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center sm:p-4"
      onClick={() => !closeDisabled && onClose()}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className={`bg-white w-full ${wide ? 'sm:max-w-3xl' : 'sm:max-w-xl'} max-h-[92vh] sm:max-h-[88vh] rounded-t-3xl sm:rounded-3xl shadow-lift flex flex-col overflow-hidden animate-pop outline-none`}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 px-4 sm:px-6 py-3 sm:py-4 border-b border-line">
          <div className="min-w-0">
            {eyebrow && <p className="eyebrow">{eyebrow}</p>}
            <h3 className="font-heading text-xl font-bold text-ink truncate">{title}</h3>
          </div>
          <button onClick={onClose} className="btn-icon shrink-0" aria-label="Stäng" disabled={closeDisabled}>
            <Icon name="close" size={22} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-5">{children}</div>
        {footer && (
          <div className="px-4 sm:px-6 py-3 border-t border-line bg-paper/60 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:pb-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Tvåstegsbekräftelse i stället för window.confirm ──
export function useArmed(timeout = 4000) {
  const [armed, setArmed] = useState<string | null>(null);
  const timer = useRef<number>();
  const arm = useCallback((key: string | null) => {
    window.clearTimeout(timer.current);
    setArmed(key);
    if (key) timer.current = window.setTimeout(() => setArmed(prev => (prev === key ? null : prev)), timeout);
  }, [timeout]);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  // Returnerar true om nyckeln redan var armerad (andra klicket)
  const confirm = useCallback((key: string) => {
    if (armed === key) {
      arm(null);
      return true;
    }
    arm(key);
    return false;
  }, [armed, arm]);
  return { armed, arm, confirm };
}

// ── Sekunder sedan start, för långa AI-anrop ──
export function useElapsed(startedAt: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!startedAt) return;
    setNow(Date.now());
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [startedAt]);
  return startedAt ? Math.max(0, Math.round((now - startedAt) / 1000)) : 0;
}

function formatSeconds(s: number) {
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`;
}

// Lägesruta med roterande meddelanden och tid
export function BusyNote({
  label,
  stages,
  startedAt,
  hint = 'Det kan ta upp till ett par minuter.',
  action,
  compact = false,
}: {
  label: string;
  stages?: string[];
  startedAt: number;
  hint?: string;
  action?: ReactNode;
  compact?: boolean;
}) {
  const seconds = useElapsed(startedAt);
  const stage = stages?.length ? stages[Math.min(stages.length - 1, Math.floor(seconds / 12))] : null;
  return (
    <div className={`rounded-2xl bg-brand/5 border border-brand/15 text-brand flex items-center gap-3 ${compact ? 'p-3' : 'p-4'}`} role="status" aria-live="polite">
      <span className="spinner shrink-0" />
      <span className="flex-1 min-w-0">
        <span className="block font-medium text-sm sm:text-[15px] truncate">{label}</span>
        <span className="block text-xs text-brand/70 mt-0.5">
          {stage ? `${stage} · ` : ''}{formatSeconds(seconds)}{hint && seconds > 20 ? ` · ${hint}` : ''}
        </span>
      </span>
      {action}
    </div>
  );
}

// ── Statusmärke för kapitel ──
export function ChapterBadge({ chapter, className = '' }: { chapter: Pick<TimelineChapter, 'status' | 'source'>; className?: string }) {
  const base = 'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap';
  if (chapter.status === 'planned') {
    return <span className={`${base} border border-dashed border-ink/25 text-ink/50 ${className}`}>Planerad</span>;
  }
  if (chapter.source === 'author') {
    return <span className={`${base} bg-ink text-white ${className}`}><Icon name="edit" size={12} /> Din text</span>;
  }
  return <span className={`${base} bg-brand/10 text-brand ${className}`}><Icon name="auto_awesome" size={12} /> AI-skriven</span>;
}

// Siffra i tidslinjen, färgad efter status
export function ChapterDot({ chapter, number, active }: { chapter: Pick<TimelineChapter, 'status' | 'source'>; number: number; active?: boolean }) {
  const cls = chapter.status === 'planned'
    ? 'bg-white border-2 border-dashed border-ink/20 text-ink/50'
    : chapter.source === 'author'
      ? 'bg-ink text-white'
      : 'bg-brand text-white';
  return (
    <span className={`w-8 h-8 shrink-0 rounded-full flex items-center justify-center text-xs font-bold tabular-nums ${cls} ${active ? 'ring-4 ring-brand/20' : ''}`}>
      {number}
    </span>
  );
}

// ── Stegväljare för tal ──
export function Stepper({
  value,
  onChange,
  min,
  max,
  step = 1,
  label,
  suffix,
}: {
  value: number;
  onChange: (n: number) => void;
  min: number;
  max: number;
  step?: number;
  label: string;
  suffix?: string;
}) {
  const clamp = (n: number) => Math.min(max, Math.max(min, Number.isFinite(n) ? n : min));
  return (
    <div className="inline-flex items-center rounded-full border border-line bg-white p-1">
      <button type="button" className="btn-icon !w-9 !h-9" onClick={() => onChange(clamp(value - step))} disabled={value <= min} aria-label={`Minska ${label}`}>
        <Icon name="remove" size={20} />
      </button>
      <label className="flex items-baseline gap-1 px-1">
        <span className="sr-only">{label}</span>
        <input
          type="number"
          inputMode="numeric"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={e => onChange(clamp(parseInt(e.target.value, 10)))}
          className="w-14 text-center font-semibold text-ink bg-transparent outline-none tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
        {suffix && <span className="text-sm text-ink/50 pr-1">{suffix}</span>}
      </label>
      <button type="button" className="btn-icon !w-9 !h-9" onClick={() => onChange(clamp(value + step))} disabled={value >= max} aria-label={`Öka ${label}`}>
        <Icon name="add" size={20} />
      </button>
    </div>
  );
}

export function FieldLabel({ htmlFor, children, hint }: { htmlFor?: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="mb-2">
      <label htmlFor={htmlFor} className="block text-sm font-semibold text-ink/80">{children}</label>
      {hint && <p className="text-xs text-ink/55 mt-0.5">{hint}</p>}
    </div>
  );
}

// ── Mediafråga (renderar bara en tidslinje åt gången) ──
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    onChange => {
      const mql = window.matchMedia(query);
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}
