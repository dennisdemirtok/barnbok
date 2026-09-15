'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BookProject } from '@/lib/types';
import { BookLayout, LayoutPage, PAGE_H, PAGE_W, PT } from '@/lib/book-layout';
import { BOOK_FONTS, bookFontFaceCss, fontCss } from '@/lib/book-fonts';
import { exportBookToPDF, layoutBook } from '@/lib/pdf-export';
import Icon from './Icon';

// ── En boksida ritad i webbläsaren (samma sidmodell som PDF:en) ──
export function BookPageView({ page, width }: { page: LayoutPage | null; width: number }) {
  const k = width / PAGE_W; // px per mm
  const height = PAGE_H * k;
  if (!page) return <div style={{ width, height }} aria-hidden />;

  return (
    <div
      className="relative overflow-hidden bg-white select-none"
      style={{ width, height, background: page.background || '#ffffff' }}
    >
      {page.els.map((el, i) => {
        if (el.kind === 'image') {
          return (
            <div
              key={i}
              className="absolute overflow-hidden"
              style={{ left: el.box.x * k, top: el.box.y * k, width: el.box.w * k, height: el.box.h * k }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={el.src}
                alt=""
                draggable={false}
                className="absolute max-w-none"
                style={{
                  left: (el.draw.x - el.box.x) * k,
                  top: (el.draw.y - el.box.y) * k,
                  width: el.draw.w * k,
                  height: el.draw.h * k,
                }}
              />
            </div>
          );
        }
        if (el.kind === 'rect') {
          return (
            <div
              key={i}
              className="absolute"
              style={{
                left: el.box.x * k, top: el.box.y * k, width: el.box.w * k, height: el.box.h * k,
                background: el.color, opacity: el.opacity, borderRadius: el.radius * k,
              }}
            />
          );
        }
        const sizePx = el.size * PT * k;
        const css = fontCss(el.font);
        return (
          <div
            key={i}
            className="absolute whitespace-pre"
            style={{
              left: el.x * k,
              top: (el.y - el.size * PT * BOOK_FONTS[el.font.family].baseline) * k,
              width: el.width * k,
              fontSize: sizePx,
              lineHeight: 1,
              color: el.color,
              textAlign: el.align === 'center' ? 'center' : 'left',
              wordSpacing: el.wordSpacing ? el.wordSpacing * k : undefined,
              letterSpacing: el.tracking ? el.tracking * k : undefined,
              fontKerning: 'none',
              ...css,
            }}
          >
            {el.text}
          </div>
        );
      })}
    </div>
  );
}

// ── Hook: sätt boken (typsnitt + bildmått laddas asynkront) ──
export function useBookLayout(book: BookProject | null) {
  const [layout, setLayout] = useState<BookLayout | null>(null);
  const [error, setError] = useState('');

  // Sätt om bara när innehållet ändras - inte vid varje ny objektreferens
  const signature = useMemo(() => {
    if (!book) return '';
    return JSON.stringify([
      book.title, book.author, book.stylePresetId, book.illustrationShape, book.bookFormat,
      book.spreads.map(s => [s.id, s.pages, s.chapter, s.textBlocks.map(b => b.text), s.generatedImage?.length, (s as { imageUrl?: string }).imageUrl]),
    ]);
  }, [book]);

  useEffect(() => {
    if (!book) return;
    let cancelled = false;
    setError('');
    layoutBook(book)
      .then(l => { if (!cancelled) setLayout(l); })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : 'Kunde inte sätta boken'); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  return { layout, error };
}

// ── Läsare med uppslag, bläddring och PDF ──
interface ReaderProps {
  book: BookProject;
  showDownload?: boolean;
}

export default function BookReader({ book, showDownload = true }: ReaderProps) {
  const { layout, error } = useBookLayout(book);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerW, setContainerW] = useState(0);
  const [index, setIndex] = useState(0); // uppslag (desktop) eller sida (mobil)
  const [exporting, setExporting] = useState(false);
  const touchStart = useRef<number | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => setContainerW(entries[0].contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const twoUp = containerW >= 700;
  const pages = layout?.pages ?? [];

  // Uppslag: omslaget ensamt till höger, sedan [2,3], [4,5] ... baksidan ensam till vänster
  const spreads = useMemo(() => {
    if (!twoUp) return pages.map((_, i) => [i]);
    const out: (number | null)[][] = [[null, 0]];
    for (let i = 1; i < pages.length; i += 2) out.push([i, i + 1 < pages.length ? i + 1 : null]);
    return out;
  }, [pages, twoUp]);

  // Behåll ungefär samma plats när man växlar mellan mobil- och uppslagsvy
  const lastTwoUp = useRef(twoUp);
  useEffect(() => {
    if (lastTwoUp.current === twoUp) return;
    setIndex(i => (twoUp ? Math.ceil(i / 2) : Math.max(0, i * 2 - 1)));
    lastTwoUp.current = twoUp;
  }, [twoUp]);

  const count = spreads.length;
  const go = useCallback((dir: 1 | -1) => {
    setIndex(i => Math.min(Math.max(0, i + dir), Math.max(0, count - 1)));
  }, [count]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('input, textarea, [contenteditable]')) return;
      if (e.key === 'ArrowRight') go(1);
      if (e.key === 'ArrowLeft') go(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go]);

  const handleDownload = async () => {
    setExporting(true);
    try {
      await exportBookToPDF(book, layout ?? undefined);
    } finally {
      setExporting(false);
    }
  };

  // Sidstorlek: ryms i bredd och i ungefär skärmhöjden
  const maxH = typeof window !== 'undefined' ? Math.max(360, window.innerHeight - 320) : 700;
  const pageW = Math.floor(Math.min(
    twoUp ? (containerW - 8) / 2 : containerW,
    maxH * (PAGE_W / PAGE_H),
    twoUp ? 520 : 560,
  ));

  const current = spreads[Math.min(index, count - 1)] || [];
  const firstPage = current.find(p => p !== null);
  const pageInfo = firstPage === undefined || firstPage === null
    ? ''
    : current.filter((p): p is number => p !== null).map(p => pages[p]?.label).join(' – ');

  // Bokens typsnitt laddas bara när en bok faktiskt visas
  const fontFaces = useMemo(() => layout
    ? bookFontFaceCss(layout.pages.flatMap(p => p.els.flatMap(el => (el.kind === 'text' ? [el.font.family] : []))))
    : '', [layout]);

  return (
    <div className="space-y-4">
      {fontFaces && <style>{fontFaces}</style>}
      <div ref={containerRef} className="w-full">
        {error ? (
          <div className="note-error">{error}</div>
        ) : !layout || containerW === 0 ? (
          <div className="skeleton mx-auto rounded-2xl" style={{ width: Math.min(containerW || 600, 900), aspectRatio: '32 / 21' }} />
        ) : (
          <div
            className="flex justify-center"
            onTouchStart={e => { touchStart.current = e.touches[0].clientX; }}
            onTouchEnd={e => {
              if (touchStart.current === null) return;
              const dx = e.changedTouches[0].clientX - touchStart.current;
              if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1);
              touchStart.current = null;
            }}
          >
            <div className="relative flex animate-fade-up" key={index}>
              {current.map((p, i) => (
                <div key={i} className={`relative ${p === null ? '' : 'shadow-[0_18px_50px_-12px_rgba(40,20,80,0.35)]'}`}>
                  <BookPageView page={p === null ? null : pages[p]} width={pageW} />
                  {/* Diskret falsskugga mellan sidorna */}
                  {twoUp && p !== null && (
                    <div
                      className={`absolute top-0 bottom-0 w-6 pointer-events-none ${
                        i === 0 ? 'right-0 bg-gradient-to-l' : 'left-0 bg-gradient-to-r'
                      } from-black/10 to-transparent`}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {layout && (
        <div className="flex flex-wrap items-center justify-center gap-3">
          <button onClick={() => go(-1)} disabled={index === 0} className="btn-icon !w-11 !h-11 bg-white shadow-soft border border-line disabled:opacity-40" title="Föregående">
            <Icon name="chevron_left" size={26} />
          </button>
          <div className="min-w-[9rem] text-center">
            <p className="text-sm font-semibold text-ink">{pageInfo}</p>
            <p className="text-xs text-ink/45">
              {layout.pages.length} sidor · {layout.mode === 'chapter' ? 'kapitelbok' : layout.mode === 'picture' ? 'bilderbok' : 'serieformat'}
            </p>
          </div>
          <button onClick={() => go(1)} disabled={index >= count - 1} className="btn-icon !w-11 !h-11 bg-white shadow-soft border border-line disabled:opacity-40" title="Nästa">
            <Icon name="chevron_right" size={26} />
          </button>
          {showDownload && (
            <button onClick={handleDownload} disabled={exporting} className="btn-ghost !py-2 text-sm sm:ml-4">
              {exporting ? <span className="spinner !w-4 !h-4" /> : <Icon name="download" size={18} />}
              {exporting ? 'Skapar PDF...' : 'Ladda ner PDF'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
