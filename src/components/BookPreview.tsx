'use client';

import { useState } from 'react';
import { BookProject, Spread, TextBlock } from '@/lib/types';
import { saveBook } from '@/lib/storage';
import { exportBookToPDF } from '@/lib/pdf-export';
import { pickLunaLayout, LunaLayout } from '@/lib/luna-layouts';
import PageEditor from './PageEditor';

interface Props {
  book: BookProject;
  onUpdateSpread: (updatedSpread: Spread) => void;
  onSaveBook: (book: BookProject) => void;
  onBack: () => void;
}

export default function BookPreview({ book, onUpdateSpread, onSaveBook, onBack }: Props) {
  const [selectedSpread, setSelectedSpread] = useState<Spread | null>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'book'>('grid');
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  const [exporting, setExporting] = useState(false);

  const isSeparateTextFormat = book.bookFormat === 'bildbok-separat-text';

  // Track which spreads are the FIRST of their chapter (to avoid repeating chapter headings)
  const firstChapterSpreadIds = new Set<string>();
  const seenChapters = new Set<string>();
  for (const s of book.spreads) {
    if (s.chapter && !seenChapters.has(s.chapter)) {
      seenChapters.add(s.chapter);
      firstChapterSpreadIds.add(s.id);
    }
  }

  const handleSaveSpread = (updatedSpread: Spread) => {
    onUpdateSpread(updatedSpread);
    setSelectedSpread(null);
  };

  const handleSaveBook = async () => {
    setSaving(true);
    setSaveMessage('');
    try {
      const bookToSave = { ...book, status: 'reviewing' as const };
      await saveBook(bookToSave);
      onSaveBook(bookToSave);
      setSaveMessage('Boken har sparats!');
      setTimeout(() => setSaveMessage(''), 3000);
    } catch (err) {
      setSaveMessage('Kunde inte spara boken');
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const handleExportPDF = async () => {
    setExporting(true);
    try {
      await exportBookToPDF(book);
    } catch (err) {
      console.error('PDF-export misslyckades:', err);
      alert('PDF-export misslyckades. Kontrollera konsolen for detaljer.');
    } finally {
      setExporting(false);
    }
  };

  const handleMarkDone = async () => {
    const doneBook = { ...book, status: 'done' as const };
    await saveBook(doneBook);
    onSaveBook(doneBook);
    setSaveMessage('Boken ar markerad som klar!');
    setTimeout(() => setSaveMessage(''), 3000);
  };

  // ── Helper: render image ──
  const renderImage = (spread: Spread, className: string = 'w-full h-full object-contain') => {
    if (spread.generatedImage) {
      return (
        <img
          src={`data:image/png;base64,${spread.generatedImage}`}
          alt={`Sida ${spread.pages}`}
          className={className}
        />
      );
    }
    return <div className="flex items-center justify-center h-full text-gray-400">Ingen bild</div>;
  };

  // ── Helper: render text blocks ──
  const renderText = (blocks: TextBlock[], truncate: boolean = false) => {
    if (blocks.length === 0) {
      return <p className="text-gray-400 italic text-center text-xs">Ingen text</p>;
    }
    return (
      <div className="space-y-3">
        {blocks.map((block, idx) => (
          <p
            key={idx}
            className={
              truncate
                ? 'text-xs leading-relaxed text-gray-800 font-serif'
                : 'text-sm md:text-base leading-relaxed text-gray-900 font-serif'
            }
          >
            {truncate && block.text.length > 200 ? block.text.substring(0, 200) + '...' : block.text}
          </p>
        ))}
      </div>
    );
  };

  // ── Helper: page number ──
  const pageNum = (num: string, side: 'left' | 'right') => (
    <div className={`px-4 py-1.5 ${side === 'right' ? 'text-right' : 'text-left'}`}>
      <span className="text-xs text-gray-400">{num}</span>
    </div>
  );

  // ── Helper: parse page numbers ──
  const parsePageNums = (pages: string) => {
    const m = pages.match(/(\d+)(?:-(\d+))?/);
    return { left: m ? m[1] : '', right: m?.[2] || '' };
  };

  // ── Helper: edit button overlay ──
  const editBtn = (spread: Spread) => (
    <div className="absolute top-3 right-3 z-10">
      <button
        onClick={(e) => { e.stopPropagation(); setSelectedSpread(spread); }}
        className="px-3 py-1.5 bg-white/90 backdrop-blur-sm text-blue-600 rounded-lg
                   text-sm font-medium hover:bg-blue-50 transition-colors shadow-sm"
      >
        Redigera
      </button>
    </div>
  );

  // ════════════════════════════════════════════════════════
  //  GRID VIEW: Luna layout thumbnails (compact cards)
  // ════════════════════════════════════════════════════════
  const renderGridLuna = (spread: Spread, layout: LunaLayout) => {
    switch (layout) {
      // ┌─────────┬─────────┐
      // │  TEXT   │  IMAGE  │
      // │  (45%) │  (55%)  │
      // └─────────┴─────────┘
      case 'text-left-img-right':
        return (
          <div className="flex aspect-[32/21]">
            <div className="w-[45%] bg-white border-r border-gray-100 p-3 flex flex-col justify-center overflow-hidden">
              {renderText(spread.textBlocks, true)}
            </div>
            <div className="w-[55%] bg-gray-50">
              {renderImage(spread)}
            </div>
          </div>
        );

      // ┌─────────┬─────────┐
      // │  IMAGE  │  TEXT   │
      // │  (55%) │  (45%)  │
      // └─────────┴─────────┘
      case 'img-left-text-right':
        return (
          <div className="flex aspect-[32/21]">
            <div className="w-[55%] bg-gray-50">
              {renderImage(spread)}
            </div>
            <div className="w-[45%] bg-white border-l border-gray-100 p-3 flex flex-col justify-center overflow-hidden">
              {renderText(spread.textBlocks, true)}
            </div>
          </div>
        );

      // ┌─────────┬─────────┐
      // │         │  IMAGE  │
      // │  TEXT   │  (3/4)  │
      // │  (45%) ├─────────┤
      // │         │  text   │
      // └─────────┴─────────┘
      case 'text-left-img-right-3q': {
        const hasSecondary = spread.textBlocks.length > 1;
        return (
          <div className="flex aspect-[32/21]">
            <div className="w-[45%] bg-white border-r border-gray-100 p-3 flex flex-col justify-center overflow-hidden">
              {spread.chapter && (
                <p className="text-[10px] font-semibold text-gray-400 text-center mb-1 uppercase tracking-wide">
                  {spread.chapter}
                </p>
              )}
              {renderText(hasSecondary ? spread.textBlocks.slice(0, -1) : spread.textBlocks, true)}
            </div>
            <div className="w-[55%] flex flex-col">
              <div className="flex-[3] bg-gray-50">
                {renderImage(spread)}
              </div>
              {hasSecondary && (
                <div className="flex-1 bg-white border-t border-gray-100 p-2 overflow-hidden">
                  <p className="text-[9px] leading-tight text-gray-600 font-serif line-clamp-3">
                    {spread.textBlocks[spread.textBlocks.length - 1].text.substring(0, 120)}
                  </p>
                </div>
              )}
            </div>
          </div>
        );
      }

      // ┌─────────┬─────────┐
      // │  IMAGE  │         │
      // │  (3/4)  │  TEXT   │
      // ├─────────┤  (45%) │
      // │  text   │         │
      // └─────────┴─────────┘
      case 'img-left-3q-text-right': {
        const hasSnippet = spread.textBlocks.length > 0;
        return (
          <div className="flex aspect-[32/21]">
            <div className="w-[55%] flex flex-col">
              <div className="flex-[3] bg-gray-50">
                {renderImage(spread)}
              </div>
              {hasSnippet && (
                <div className="flex-1 bg-white border-t border-gray-100 p-2 overflow-hidden">
                  <p className="text-[9px] leading-tight text-gray-600 font-serif line-clamp-3">
                    {spread.textBlocks[0].text.substring(0, 120)}
                  </p>
                </div>
              )}
            </div>
            <div className="w-[45%] bg-white border-l border-gray-100 p-3 flex flex-col justify-center overflow-hidden">
              {renderText(spread.textBlocks.length > 1 ? spread.textBlocks.slice(1) : spread.textBlocks, true)}
            </div>
          </div>
        );
      }

      // ┌────────┬──────┬────────┐
      // │  TEXT  │ IMG  │  TEXT  │
      // │ col 1  │(ctr) │ col 2  │
      // └────────┴──────┴────────┘
      case 'text-around-img-center': {
        const allText = spread.textBlocks.map(b => b.text).join(' ');
        const mid = Math.ceil(allText.length / 2);
        const leftText = allText.substring(0, mid);
        const rightText = allText.substring(mid);
        return (
          <div className="flex aspect-[32/21]">
            <div className="w-[28%] bg-white p-2 flex flex-col justify-center overflow-hidden">
              <p className="text-[9px] leading-tight text-gray-800 font-serif">
                {leftText.substring(0, 180)}...
              </p>
            </div>
            <div className="w-[44%] bg-gray-50 flex items-center justify-center p-2">
              {renderImage(spread, 'max-w-full max-h-full object-contain')}
            </div>
            <div className="w-[28%] bg-white p-2 flex flex-col justify-center overflow-hidden">
              <p className="text-[9px] leading-tight text-gray-800 font-serif">
                {rightText.substring(0, 180)}...
              </p>
            </div>
          </div>
        );
      }
    }
  };

  // ════════════════════════════════════════════════════════
  //  BOOK VIEW: Luna layout full-size spread rendering
  // ════════════════════════════════════════════════════════
  const renderBookLuna = (spread: Spread, layout: LunaLayout) => {
    const nums = parsePageNums(spread.pages);

    switch (layout) {
      // Classic: text left, full image right
      case 'text-left-img-right':
        return (
          <div className="relative flex bg-white" style={{ aspectRatio: '32/21' }}>
            {editBtn(spread)}
            <div className="w-[45%] border-r border-gray-100 flex flex-col">
              <div className="flex-1 px-8 py-6 md:px-12 md:py-8 flex flex-col justify-center overflow-auto">
                <div className="max-w-md mx-auto">
                  {renderText(spread.textBlocks)}
                </div>
              </div>
              {pageNum(nums.left, 'left')}
            </div>
            <div className="w-[55%] bg-gray-50 flex items-center justify-center">
              {renderImage(spread)}
            </div>
          </div>
        );

      // Mirror: full image left, text right
      case 'img-left-text-right':
        return (
          <div className="relative flex bg-white" style={{ aspectRatio: '32/21' }}>
            {editBtn(spread)}
            <div className="w-[55%] bg-gray-50 flex items-center justify-center">
              {renderImage(spread)}
            </div>
            <div className="w-[45%] border-l border-gray-100 flex flex-col">
              <div className="flex-1 px-8 py-6 md:px-12 md:py-8 flex flex-col justify-center overflow-auto">
                <div className="max-w-md mx-auto">
                  {renderText(spread.textBlocks)}
                </div>
              </div>
              {pageNum(nums.right, 'right')}
            </div>
          </div>
        );

      // Text left, image 3/4 right, text snippet below image
      case 'text-left-img-right-3q': {
        const mainBlocks = spread.textBlocks.length > 1
          ? spread.textBlocks.slice(0, -1)
          : spread.textBlocks;
        const bottomBlock = spread.textBlocks.length > 1
          ? spread.textBlocks[spread.textBlocks.length - 1]
          : null;

        return (
          <div className="relative flex bg-white" style={{ aspectRatio: '32/21' }}>
            {editBtn(spread)}
            <div className="w-[45%] border-r border-gray-100 flex flex-col">
              <div className="flex-1 px-8 py-6 md:px-10 md:py-8 flex flex-col justify-center overflow-auto">
                <div className="max-w-sm mx-auto">
                  {renderText(mainBlocks)}
                </div>
              </div>
              {pageNum(nums.left, 'left')}
            </div>
            <div className="w-[55%] flex flex-col">
              <div className={`${bottomBlock ? 'flex-[3]' : 'flex-1'} bg-gray-50 flex items-center justify-center`}>
                {renderImage(spread)}
              </div>
              {bottomBlock && (
                <div className="flex-1 border-t border-gray-100 px-6 py-3 flex items-center overflow-auto">
                  <p className="text-sm leading-relaxed text-gray-700 font-serif">
                    {bottomBlock.text}
                  </p>
                </div>
              )}
              {pageNum(nums.right, 'right')}
            </div>
          </div>
        );
      }

      // Image 3/4 left with snippet below, text right
      case 'img-left-3q-text-right': {
        const snippet = spread.textBlocks.length > 0
          ? spread.textBlocks[0].text.substring(0, 180)
          : '';
        const restBlocks = spread.textBlocks.length > 1
          ? spread.textBlocks.slice(1)
          : spread.textBlocks;

        return (
          <div className="relative flex bg-white" style={{ aspectRatio: '32/21' }}>
            {editBtn(spread)}
            <div className="w-[55%] flex flex-col">
              <div className={`${snippet ? 'flex-[3]' : 'flex-1'} bg-gray-50 flex items-center justify-center`}>
                {renderImage(spread)}
              </div>
              {snippet && (
                <div className="flex-1 border-t border-gray-100 px-6 py-3 flex items-center overflow-auto">
                  <p className="text-sm leading-relaxed text-gray-700 font-serif">
                    {snippet}
                  </p>
                </div>
              )}
              {pageNum(nums.left, 'left')}
            </div>
            <div className="w-[45%] border-l border-gray-100 flex flex-col">
              <div className="flex-1 px-8 py-6 md:px-10 md:py-8 flex flex-col justify-center overflow-auto">
                <div className="max-w-sm mx-auto">
                  {renderText(restBlocks)}
                </div>
              </div>
              {pageNum(nums.right, 'right')}
            </div>
          </div>
        );
      }

      // Portrait image centered, text columns on both sides
      case 'text-around-img-center': {
        const allBlocks = spread.textBlocks;
        const midIdx = Math.ceil(allBlocks.length / 2);
        const leftBlocks = allBlocks.length > 1 ? allBlocks.slice(0, midIdx) : allBlocks;
        const rightBlocks = allBlocks.length > 1 ? allBlocks.slice(midIdx) : [];

        return (
          <div className="relative flex bg-white" style={{ aspectRatio: '32/21' }}>
            {editBtn(spread)}
            {/* Left text column */}
            <div className="w-[28%] border-r border-gray-100 flex flex-col">
              <div className="flex-1 px-6 py-6 md:px-8 md:py-8 flex flex-col justify-center overflow-auto">
                <div className="space-y-3">
                  {leftBlocks.map((block, idx) => (
                    <p key={idx} className="text-sm leading-relaxed text-gray-900 font-serif">
                      {block.text}
                    </p>
                  ))}
                </div>
              </div>
              {pageNum(nums.left, 'left')}
            </div>
            {/* Centered portrait image */}
            <div className="w-[44%] bg-gray-50 flex items-center justify-center p-4">
              {renderImage(spread, 'max-w-full max-h-full object-contain rounded-sm')}
            </div>
            {/* Right text column */}
            <div className="w-[28%] border-l border-gray-100 flex flex-col">
              <div className="flex-1 px-6 py-6 md:px-8 md:py-8 flex flex-col justify-center overflow-auto">
                <div className="space-y-3">
                  {rightBlocks.length > 0 ? (
                    rightBlocks.map((block, idx) => (
                      <p key={idx} className="text-sm leading-relaxed text-gray-900 font-serif">
                        {block.text}
                      </p>
                    ))
                  ) : leftBlocks.length > 0 && leftBlocks[0].text.length > 200 ? (
                    <p className="text-sm leading-relaxed text-gray-900 font-serif">
                      {/* Show continuation for single long text block */}
                    </p>
                  ) : null}
                </div>
              </div>
              {pageNum(nums.right, 'right')}
            </div>
          </div>
        );
      }
    }
  };

  // ════════════════════════════════════════════════════════
  //  MAIN RENDER
  // ════════════════════════════════════════════════════════
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-800 mb-1">
            Steg 4: Granska & redigera
          </h2>
          <p className="text-gray-600">
            Klicka pa ett uppslag for att redigera text eller regenerera bilden.
          </p>
        </div>
        <button onClick={onBack} className="px-4 py-2 text-gray-500 hover:text-gray-700">
          Tillbaka
        </button>
      </div>

      {/* Book info + Action buttons */}
      <div className="bg-gradient-to-r from-blue-50 to-purple-50 rounded-xl p-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h3 className="text-xl font-bold text-gray-800">{book.title}</h3>
            {book.subtitle && <p className="text-gray-600">{book.subtitle}</p>}
            <div className="flex gap-4 mt-2 text-sm text-gray-500">
              <span>{book.spreads.length} uppslag</span>
              <span>{book.characters.length} karaktarer</span>
              <span>{book.spreads.filter(s => s.status === 'done').length} bilder klara</span>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={handleSaveBook}
              disabled={saving}
              className="px-5 py-2.5 bg-green-600 text-white font-semibold rounded-lg
                         hover:bg-green-700 disabled:bg-gray-400 transition-colors
                         flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
              </svg>
              {saving ? 'Sparar...' : 'Spara bok'}
            </button>

            <button
              onClick={handleExportPDF}
              disabled={exporting}
              className="px-5 py-2.5 bg-purple-600 text-white font-semibold rounded-lg
                         hover:bg-purple-700 disabled:bg-gray-400 transition-colors
                         flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              {exporting ? 'Exporterar...' : 'Ladda ner PDF'}
            </button>

            <button
              onClick={handleMarkDone}
              className="px-5 py-2.5 bg-yellow-500 text-white font-semibold rounded-lg
                         hover:bg-yellow-600 transition-colors flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Markera klar
            </button>
          </div>
        </div>

        {saveMessage && (
          <div className={`mt-3 p-2 rounded-lg text-sm font-medium text-center ${
            saveMessage.includes('sparats') || saveMessage.includes('klar')
              ? 'bg-green-100 text-green-700'
              : 'bg-red-100 text-red-700'
          }`}>
            {saveMessage}
          </div>
        )}
      </div>

      {/* View controls */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => setViewMode(viewMode === 'grid' ? 'book' : 'grid')}
          className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
        >
          {viewMode === 'grid' ? 'Bokvy' : 'Rutnat'}
        </button>
      </div>

      {/* ─── GRID VIEW ─── */}
      {viewMode === 'grid' ? (
        <div className={`grid gap-6 ${
          isSeparateTextFormat
            ? 'grid-cols-1 lg:grid-cols-2'
            : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3'
        }`}>
          {book.spreads.map((spread, idx) => {
            const isSpecial = spread.pages === 'omslag' || spread.pages === 'slutsida';
            const showLuna = isSeparateTextFormat && !isSpecial;
            const layout = showLuna ? pickLunaLayout(idx) : null;

            return (
              <div
                key={spread.id}
                onClick={() => setSelectedSpread(spread)}
                className="border-2 border-gray-200 rounded-xl overflow-hidden cursor-pointer
                           hover:border-blue-400 hover:shadow-lg transition-all group"
              >
                {showLuna && layout ? (
                  renderGridLuna(spread, layout)
                ) : (
                  <div className="bg-gray-100 aspect-[3/2]">
                    {renderImage(spread)}
                  </div>
                )}

                {/* Info footer */}
                <div className="p-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-semibold text-gray-700">
                      {spread.pages === 'omslag' ? 'Omslag' :
                       spread.pages === 'slutsida' ? 'Slutsida' :
                       `Sida ${spread.pages}`}
                    </span>
                    <span className="text-xs text-blue-600 opacity-0 group-hover:opacity-100 transition-opacity">
                      Klicka for att redigera
                    </span>
                  </div>
                  {spread.chapter && !showLuna && firstChapterSpreadIds.has(spread.id) && (
                    <p className="text-xs text-gray-500">{spread.chapter}</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* ─── BOOK VIEW ─── */
        <div className="space-y-8">
          {book.spreads.map((spread, idx) => {
            const isSpecial = spread.pages === 'omslag' || spread.pages === 'slutsida';
            const showLuna = isSeparateTextFormat && !isSpecial;
            const layout = showLuna ? pickLunaLayout(idx) : null;

            return (
              <div
                key={spread.id}
                className="border rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-shadow"
              >
                {/* Chapter heading bar - only for non-Luna formats, only first spread of each chapter */}
                {spread.chapter && !showLuna && firstChapterSpreadIds.has(spread.id) && (
                  <div className="bg-gray-800 text-white px-6 py-2 text-sm font-semibold">
                    {spread.chapter}
                  </div>
                )}

                {showLuna && layout ? (
                  renderBookLuna(spread, layout)
                ) : (
                  /* Standard: full spread image */
                  <div className="relative bg-gray-50">
                    {renderImage(spread, 'w-full object-contain')}
                    <div className="absolute top-4 right-4">
                      <button
                        onClick={() => setSelectedSpread(spread)}
                        className="px-3 py-1.5 bg-white/90 backdrop-blur-sm text-blue-600 rounded-lg
                                   text-sm font-medium hover:bg-blue-50 transition-colors shadow-sm"
                      >
                        Redigera
                      </button>
                    </div>
                  </div>
                )}

                {/* Page label for standard view */}
                {!showLuna && (
                  <div className="px-6 py-2 bg-gray-50 text-center border-t">
                    <span className="text-sm font-medium text-gray-500">
                      {spread.pages === 'omslag' ? 'Omslag' :
                       spread.pages === 'slutsida' ? 'Slutsida' :
                       `Sida ${spread.pages}`}
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Page Editor Modal */}
      {selectedSpread && (
        <PageEditor
          spread={selectedSpread}
          characters={book.characters}
          styleGuide={book.styleGuide}
          bookFormat={book.bookFormat}
          onSave={handleSaveSpread}
          onClose={() => setSelectedSpread(null)}
        />
      )}
    </div>
  );
}
