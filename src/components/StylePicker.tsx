'use client';

import { useMemo } from 'react';
import { STYLE_PRESETS } from '@/lib/styles';
import { BOOK_FONTS, bookFontFaceCss, fontCss } from '@/lib/book-fonts';
import Icon from './Icon';

interface Props {
  value: string;
  onChange: (id: string) => void;
  // 1 = smal spalt (sidopanel), 3 = full bredd
  columns?: 1 | 3;
}

// Stilkort: varje stil är ett bokkoncept med egen bildform och typografi.
// Ett rubrikprov visas i stilens boktypsnitt så skillnaden syns direkt.
export default function StylePicker({ value, onChange, columns = 3 }: Props) {
  const fontFaces = useMemo(() => bookFontFaceCss(STYLE_PRESETS.map(s => s.fonts.heading)), []);

  return (
    <div className={`grid gap-2 ${columns === 1 ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-1' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'}`}>
      <style>{fontFaces}</style>
      {STYLE_PRESETS.map(style => {
        const on = value === style.id;
        const heading = fontCss({ family: style.fonts.heading, style: 'bold' });
        return (
          <button
            key={style.id}
            type="button"
            onClick={() => onChange(style.id)}
            aria-pressed={on}
            className={`flex items-start gap-3 p-3 rounded-2xl text-left transition-all ${
              on ? 'bg-white ring-2 ring-ink shadow-soft' : 'bg-white ring-1 ring-line hover:ring-ink/25'
            }`}
          >
            <span className={`w-10 h-10 shrink-0 rounded-xl bg-gradient-to-br ${style.swatch} flex items-center justify-center text-white`}>
              {on && <Icon name="check" size={20} />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-ink leading-tight">{style.label}</span>
              <span className="block text-xs text-ink/55 mt-0.5 leading-snug">{style.concept}</span>
              <span className="mt-2 flex items-center justify-between gap-2 text-[11px] text-ink/45">
                <span>{style.book.lengthLabel}</span>
                <span className="text-ink/75 text-[15px] leading-none" style={heading} title={`Typsnitt: ${BOOK_FONTS[style.fonts.heading].name}`}>
                  {style.book.format === 'kapitelbok' ? 'Kapitel 1' : 'Sagan börjar'}
                </span>
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
