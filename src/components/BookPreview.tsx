'use client';

import { useState, useEffect } from 'react';
import { BookProject, Spread } from '@/lib/types';
import Icon from './Icon';
import StepHeader from './StepHeader';
import { saveBook } from '@/lib/storage';
import { exportBookToPDF } from '@/lib/pdf-export';
import { setBookPublished, getBookPublishState } from '@/lib/supabase-db';
import { useAuth } from '@/lib/auth';
import PageEditor from './PageEditor';
import Workshop from './Workshop';
import BookReader from './BookReader';

const spreadName = (s: Spread) =>
  s.pages === 'omslag' ? 'Omslag' : s.pages === 'slutsida' ? 'Slutsida' : `Sida ${s.pages}`;

interface Props {
  book: BookProject;
  onUpdateSpread: (updatedSpread: Spread) => void;
  onSaveBook: (book: BookProject) => void;
  onBack: () => void;
}

export default function BookPreview({ book, onUpdateSpread, onSaveBook, onBack }: Props) {
  const [selectedSpread, setSelectedSpread] = useState<Spread | null>(null);
  const [viewMode, setViewMode] = useState<'workshop' | 'grid' | 'book'>('book');
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  const [exporting, setExporting] = useState(false);
  const [checking, setChecking] = useState(false);
  const [checkResults, setCheckResults] = useState<Record<string, {
    passed: boolean;
    summary: string;
    issues: Array<{ character: string; issue: string; severity: string }>;
  }>>({});
  const { user } = useAuth();
  const [isPublic, setIsPublic] = useState(false);
  const [publishing, setPublishing] = useState(false);

  // Hämta nuvarande publiceringsstatus när boken öppnas
  useEffect(() => {
    getBookPublishState(book.id).then(setIsPublic).catch(() => {});
  }, [book.id, user]);

  const handlePublishToggle = async () => {
    setPublishing(true);
    setSaveMessage('');
    try {
      const next = !isPublic;
      // Spara först till molnet så boken finns där, sätt sedan publik-flaggan
      const result = await saveBook({ ...book, status: 'reviewing' as const });
      onSaveBook(result.book);
      const authorName = user?.email ? user.email.split('@')[0] : undefined;
      await setBookPublished(result.book.id, next, authorName);
      setIsPublic(next);
      setSaveMessage(next
        ? 'Boken är publicerad i bokhandeln – nu kan alla läsa den! 🎉'
        : 'Boken är avpublicerad och åter privat.');
      setTimeout(() => setSaveMessage(''), 5000);
    } catch (err) {
      setSaveMessage(err instanceof Error ? err.message : 'Kunde inte ändra publicering');
    } finally {
      setPublishing(false);
    }
  };

  const [sharing, setSharing] = useState(false);

  // Dela boken: spara till molnet (auto-publiceras) och kopiera/dela länken
  const handleShare = async () => {
    setSharing(true);
    setSaveMessage('');
    try {
      const result = await saveBook({ ...book, status: 'reviewing' as const });
      onSaveBook(result.book);
      if (result.cloud !== 'synced') {
        throw new Error(`Kunde inte spara boken till molnet: ${result.cloudError || 'okänt fel'}`);
      }
      const url = `${window.location.origin}/?bok=${result.book.id}`;
      if (typeof navigator.share === 'function') {
        try {
          await navigator.share({ title: book.title, url });
          return;
        } catch {
          // Användaren avbröt - fall tillbaka på kopiering
        }
      }
      await navigator.clipboard.writeText(url);
      setSaveMessage('Delningslänk kopierad! Skicka den till vem som helst så öppnas boken direkt. 🔗');
      setTimeout(() => setSaveMessage(''), 6000);
    } catch (err) {
      setSaveMessage(err instanceof Error ? err.message : 'Kunde inte skapa delningslänk');
    } finally {
      setSharing(false);
    }
  };

  const handleSaveSpread = (updatedSpread: Spread) => {
    onUpdateSpread(updatedSpread);
    setSelectedSpread(null);
  };

  const formatSaveMessage = (result: { cloud: string; cloudError?: string }, baseText: string): string => {
    switch (result.cloud) {
      case 'synced': return `${baseText} - lokalt och i molnet ✓`;
      case 'disabled': return `${baseText} lokalt (molnsynk ej konfigurerad)`;
      case 'failed': return `${baseText} lokalt, men molnsynken misslyckades: ${result.cloudError || 'okänt fel'}`;
      default: return baseText;
    }
  };

  const handleSaveBook = async () => {
    setSaving(true);
    setSaveMessage('');
    try {
      const bookToSave = { ...book, status: 'reviewing' as const };
      const result = await saveBook(bookToSave);
      onSaveBook(result.book);
      setSaveMessage(formatSaveMessage(result, 'Boken har sparats'));
      setTimeout(() => setSaveMessage(''), result.cloud === 'failed' ? 8000 : 4000);
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
      alert('PDF-export misslyckades. Kontrollera konsolen för detaljer.');
    } finally {
      setExporting(false);
    }
  };

  const handleMarkDone = async () => {
    const doneBook = { ...book, status: 'done' as const };
    const result = await saveBook(doneBook);
    onSaveBook(result.book);
    setSaveMessage(formatSaveMessage(result, 'Boken är markerad som klar'));
    setTimeout(() => setSaveMessage(''), result.cloud === 'failed' ? 8000 : 4000);
  };

  // ── Character check ──
  const handleCheckCharacters = async () => {
    setChecking(true);
    setCheckResults({});
    const spreadsWithImages = book.spreads.filter(s => s.generatedImage && s.pages !== 'omslag' && s.pages !== 'slutsida');

    for (const spread of spreadsWithImages) {
      try {
        const res = await fetch('/api/check-character', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            generatedImage: spread.generatedImage,
            characters: book.characters.filter(c => c.approved),
          }),
        });

        if (res.ok) {
          const result = await res.json();
          setCheckResults(prev => ({ ...prev, [spread.id]: result }));
        }
      } catch (err) {
        console.error(`Kontroll av sida ${spread.pages}:`, err);
      }
    }
    setChecking(false);
  };

  // ════════════════════════════════════════════════════════
  //  MAIN RENDER
  // ════════════════════════════════════════════════════════
  return (
    <div className="space-y-6">
      {/* Header */}
      <StepHeader
        eyebrow="Steg 4 av 4 · Färdig bok"
        title="Din bok är klar att läsas"
        description="Bläddra i den satta boken precis som den blir i PDF:en. Redigera text eller bilder, spara och dela när du är nöjd."
        onBack={onBack}
      />

      {/* Book info + Action buttons */}
      <div className="glass rounded-4xl p-5 sm:p-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 shrink-0 rounded-2xl bg-ink flex items-center justify-center text-white shadow-soft">
              <Icon name="menu_book" filled size={26} />
            </div>
            <div className="min-w-0">
              <h3 className="text-xl font-heading font-semibold text-ink truncate">{book.title}</h3>
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-sm text-ink/55">
                <span>{book.spreads.length} uppslag</span>
                <span>{book.characters.length} karaktärer</span>
                <span>{book.spreads.filter(s => s.status === 'done').length} bilder klara</span>
                {isPublic && (
                  <span className="inline-flex items-center gap-1 text-emerald-600 font-medium">
                    <Icon name="public" filled size={15} /> I bokhandeln
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Primära åtgärder */}
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={handleSaveBook} disabled={saving} className="btn-primary !py-2.5 text-sm">
            {saving ? <span className="spinner !w-4 !h-4" /> : <Icon name="cloud_upload" filled size={18} />}
            {saving ? 'Sparar...' : 'Spara bok'}
          </button>

          <button onClick={handleShare} disabled={sharing} className="btn-action !py-2.5 text-sm">
            {sharing ? <span className="spinner !w-4 !h-4" /> : <Icon name="share" filled size={18} />}
            {sharing ? 'Vänta...' : 'Dela boken'}
          </button>

          <span className="hidden sm:block w-px h-7 bg-brand/15 mx-1" />

          {/* Sekundära åtgärder */}
          <button onClick={handleExportPDF} disabled={exporting} className="btn-ghost !py-2 text-sm">
            {exporting ? <span className="spinner !w-4 !h-4" /> : <Icon name="download" size={18} />}
            {exporting ? 'Exporterar...' : 'PDF'}
          </button>

          <button onClick={handleCheckCharacters} disabled={checking} className="btn-ghost !py-2 text-sm">
            {checking ? <span className="spinner !w-4 !h-4" /> : <Icon name="verified_user" size={18} />}
            {checking ? 'Kontrollerar...' : 'Kontrollera karaktärer'}
          </button>

          <button onClick={handleMarkDone} className="btn-ghost !py-2 text-sm">
            <Icon name="task_alt" size={18} /> Markera klar
          </button>

          <button
            onClick={handlePublishToggle}
            disabled={publishing}
            className={`btn-ghost !py-2 text-sm ${isPublic ? '!text-ink/55' : ''}`}
          >
            {publishing ? <span className="spinner !w-4 !h-4" /> : <Icon name={isPublic ? 'visibility_off' : 'storefront'} size={18} />}
            {publishing ? 'Vänta...' : isPublic ? 'Avpublicera' : 'Publicera'}
          </button>
        </div>

        {saveMessage && (
          <div className={`mt-3 p-3 rounded-2xl text-sm font-medium text-center ${
            saveMessage.includes('sparats') || saveMessage.includes('klar') ||
            saveMessage.includes('kopierad') || saveMessage.includes('publicerad')
              ? 'bg-green-100/80 text-green-700'
              : 'bg-red-100/80 text-red-700'
          }`}>
            {saveMessage}
          </div>
        )}

        {/* Character check results summary */}
        {Object.keys(checkResults).length > 0 && (
          <div className="mt-3 p-4 rounded-2xl glass">
            <h4 className=" font-semibold text-sm mb-2">Karaktärskontroll:</h4>
            {(() => {
              const passed = Object.values(checkResults).filter(r => r.passed).length;
              const failed = Object.values(checkResults).filter(r => !r.passed).length;
              return (
                <div className="flex gap-4 text-sm">
                  <span className="text-green-600 font-medium">{passed} godkända</span>
                  {failed > 0 && <span className="text-red-600 font-medium">{failed} behöver fixas</span>}
                </div>
              );
            })()}
            {Object.entries(checkResults).filter(([, r]) => !r.passed).map(([spreadId, result]) => {
              const spread = book.spreads.find(s => s.id === spreadId);
              return (
                <div key={spreadId} className="mt-2 p-3 bg-red-50/80 rounded-2xl text-xs text-red-700">
                  <strong>Sida {spread?.pages}:</strong> {result.summary}
                  {result.issues?.map((issue, i) => (
                    <div key={i} className="ml-2 mt-1">
                      - {issue.character}: {issue.issue} ({issue.severity})
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Vyer */}
      <div className="grid grid-cols-3 sm:inline-grid sm:w-auto gap-1 p-1 glass rounded-full">
        {([
          { key: 'book', label: 'Läs boken', icon: 'auto_stories' },
          { key: 'workshop', label: 'Redigera', icon: 'edit_note' },
          { key: 'grid', label: 'Alla sidor', icon: 'grid_view' },
        ] as const).map((v) => (
          <button
            key={v.key}
            onClick={() => setViewMode(v.key)}
            className={`px-2 sm:px-4 py-2 rounded-full text-[13px] sm:text-sm font-semibold whitespace-nowrap transition-all inline-flex items-center justify-center gap-1.5 ${
              viewMode === v.key ? 'bg-ink text-white shadow-soft' : 'text-ink/65 hover:text-ink'
            }`}
          >
            <Icon name={v.icon} filled={viewMode === v.key} size={18} />{v.label}
          </button>
        ))}
      </div>

      {/* ─── Den satta boken - exakt som PDF:en ─── */}
      {viewMode === 'book' && (
        <div className="card-glass hover:!shadow-soft px-2 py-4 sm:p-8 -mx-2 sm:mx-0">
          <BookReader book={book} />
        </div>
      )}

      {/* ─── Verkstad (redigera text och bilder) ─── */}
      {viewMode === 'workshop' && (
        <Workshop book={book} onUpdateSpread={onUpdateSpread} />
      )}

      {/* ─── Alla uppslag ─── */}
      {viewMode === 'grid' && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {book.spreads.map((spread) => (
            <button
              key={spread.id}
              onClick={() => setSelectedSpread(spread)}
              className="card-glass overflow-hidden text-left hover:-translate-y-1 transition-all group"
            >
              <div className="bg-paper aspect-[3/4] relative overflow-hidden">
                {spread.generatedImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`data:image/png;base64,${spread.generatedImage}`}
                    alt={spreadName(spread)}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center h-full text-ink/40">
                    <Icon name="image_not_supported" size={28} />
                    <span className="text-xs mt-1">Ingen bild</span>
                  </div>
                )}
                <span className="absolute bottom-2 right-2 inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-white/95 text-brand text-xs font-semibold shadow-soft opacity-0 group-hover:opacity-100 transition-opacity">
                  <Icon name="edit" size={14} /> Redigera
                </span>
              </div>
              <div className="px-3 py-2.5">
                <p className=" font-semibold text-sm text-ink/80 truncate">{spreadName(spread)}</p>
                {spread.chapter && <p className="text-xs text-ink/40 truncate">{spread.chapter}</p>}
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Page Editor Modal */}
      {selectedSpread && (
        <PageEditor
          spread={selectedSpread}
          characters={book.characters}
          styleGuide={book.styleGuide}
          bookFormat={book.bookFormat}
          illustrationShape={book.illustrationShape}
          onSave={handleSaveSpread}
          onClose={() => setSelectedSpread(null)}
        />
      )}
    </div>
  );
}
