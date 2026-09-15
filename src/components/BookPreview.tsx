'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { BookProject, Spread } from '@/lib/types';
import Icon from './Icon';
import StepHeader from './StepHeader';
import { saveBook, SaveResult } from '@/lib/storage';
import { exportBookToPDF } from '@/lib/pdf-export';
import { getBookPublishState, updateBookInfoInCloud } from '@/lib/supabase-db';
import { useAuth } from '@/lib/auth';
import PageEditor from './PageEditor';
import Workshop from './Workshop';
import BookReader from './BookReader';

const spreadName = (s: Spread) =>
  s.pages === 'omslag' ? 'Omslag' : s.pages === 'slutsida' ? 'Slutsida' : `Sida ${s.pages}`;

// Sparning får aldrig backa en färdigmarkerad bok till 'reviewing'
const withReviewStatus = (b: BookProject): BookProject =>
  ({ ...b, status: b.status === 'done' ? 'done' : 'reviewing' });

// unknown = okänt (molnet ej nåbart), local = finns inte i molnet än
type CloudState = 'loading' | 'unknown' | 'local' | 'private' | 'public';
type Busy = 'share' | 'save' | 'publish' | 'done' | 'check' | null;
type Notice = { tone: 'success' | 'warning' | 'error'; text: string } | null;

interface Props {
  book: BookProject;
  onUpdateSpread: (updatedSpread: Spread) => void;
  onSaveBook: (book: BookProject) => void;
  onBack: () => void;
}

export default function BookPreview({ book, onUpdateSpread, onSaveBook, onBack }: Props) {
  const [selectedSpread, setSelectedSpread] = useState<Spread | null>(null);
  const [viewMode, setViewMode] = useState<'workshop' | 'grid' | 'book'>('book');
  const [busy, setBusy] = useState<Busy>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [exporting, setExporting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [checkResults, setCheckResults] = useState<Record<string, {
    passed: boolean;
    summary: string;
    issues: Array<{ character: string; issue: string; severity: string }>;
  }>>({});
  const { user } = useAuth();
  const [cloudState, setCloudState] = useState<CloudState>('loading');
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout>>();

  // Bokinfo som redigeras direkt i kortet
  const [titleDraft, setTitleDraft] = useState(book.title);
  const [authorDraft, setAuthorDraft] = useState(book.author || '');
  useEffect(() => { setTitleDraft(book.title); }, [book.title]);
  useEffect(() => { setAuthorDraft(book.author || ''); }, [book.author]);

  const showNotice = useCallback((next: Notice, ms = 5000) => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    setNotice(next);
    if (next && next.tone !== 'error') noticeTimer.current = setTimeout(() => setNotice(null), ms);
  }, []);
  useEffect(() => () => { if (noticeTimer.current) clearTimeout(noticeTimer.current); }, []);

  const refreshCloudState = useCallback(async (bookId: string) => {
    try {
      const state = await getBookPublishState(bookId);
      setCloudState(state === null ? 'local' : state ? 'public' : 'private');
    } catch {
      setCloudState('unknown');
    }
  }, []);

  // Hämta nuvarande molnstatus när boken öppnas
  useEffect(() => {
    refreshCloudState(book.id);
  }, [book.id, user, refreshCloudState]);

  // Stäng "Mer"-menyn vid klick utanför eller Escape
  useEffect(() => {
    if (!menuOpen) return;
    const onPointer = (e: MouseEvent | TouchEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMenuOpen(false);
        menuButtonRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('touchstart', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('touchstart', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  // Spara lokalt + i molnet. publish: true/false ändrar publiceringen, utelämnat lämnar den orörd.
  const saveToCloud = async (bookToSave: BookProject, publish?: boolean): Promise<SaveResult> => {
    const result = await saveBook(bookToSave, { publish });
    onSaveBook(result.book);
    if (result.cloud === 'synced' || result.cloud === 'failed') await refreshCloudState(result.book.id);
    return result;
  };

  const resultNotice = (result: SaveResult, successText: string): Notice => {
    switch (result.cloud) {
      case 'synced': return { tone: 'success', text: successText };
      case 'disabled': return { tone: 'warning', text: 'Sparad lokalt – molnsynk är inte konfigurerad.' };
      case 'failed': return {
        tone: 'error',
        text: `Sparad lokalt, men molnsparningen misslyckades: ${result.cloudError || 'okänt fel'}`,
      };
      default: return { tone: 'success', text: 'Sparad lokalt.' };
    }
  };

  // ── Bokinfo: titel och författare ──
  // Boken med ev. ännu ej inskickade ändringar i titel-/författarfälten
  const bookWithInfo = (): BookProject => ({
    ...book,
    title: titleDraft.trim() || book.title,
    author: authorDraft.trim() || undefined,
  });

  const commitBookInfo = async () => {
    const updated = bookWithInfo();
    if (updated.title !== titleDraft) setTitleDraft(updated.title);
    if (updated.title === book.title && updated.author === (book.author?.trim() || undefined)) return;

    onSaveBook(updated);
    // Finns boken redan i molnet uppdateras titel/författare direkt (utan bilduppladdning)
    if (cloudState === 'public' || cloudState === 'private') {
      try {
        await updateBookInfoInCloud(updated);
      } catch (err) {
        showNotice({ tone: 'error', text: err instanceof Error ? err.message : 'Kunde inte uppdatera bokinfo i molnet' });
      }
    }
  };

  // ── Dela boken: spara i molnet, publicera och dela/kopiera länken ──
  const handleShare = async () => {
    setBusy('share');
    showNotice(null);
    try {
      const result = await saveToCloud(withReviewStatus(bookWithInfo()), true);
      if (result.cloud === 'disabled') throw new Error('Molnsynk är inte konfigurerad – boken kan inte delas.');
      if (result.cloud !== 'synced') {
        throw new Error(`Kunde inte spara boken i molnet: ${result.cloudError || 'okänt fel'}`);
      }
      const url = `${window.location.origin}/?bok=${result.book.id}`;
      if (typeof navigator.share === 'function') {
        try {
          await navigator.share({ title: result.book.title, url });
          showNotice({ tone: 'success', text: 'Boken är publicerad i Bokhandeln och delad.' });
          return;
        } catch (err) {
          // Avbrutet av användaren - boken är ändå publicerad
          if (err instanceof DOMException && err.name === 'AbortError') return;
          // Annat fel - fall tillbaka på kopiering
        }
      }
      try {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
        showNotice({ tone: 'success', text: 'Länken är kopierad – skicka den till vem som helst så öppnas boken direkt.' });
      } catch {
        window.prompt('Kopiera länken:', url);
      }
    } catch (err) {
      showNotice({ tone: 'error', text: err instanceof Error ? err.message : 'Kunde inte skapa delningslänk' });
    } finally {
      setBusy(null);
    }
  };

  const handleSaveBook = async () => {
    setBusy('save');
    showNotice(null);
    try {
      const result = await saveToCloud(withReviewStatus(bookWithInfo()));
      showNotice(resultNotice(result, 'Boken är sparad i molnet.'));
    } catch (err) {
      console.error(err);
      showNotice({ tone: 'error', text: 'Kunde inte spara boken' });
    } finally {
      setBusy(null);
    }
  };

  const handlePublishToggle = async () => {
    const next = cloudState !== 'public';
    setBusy('publish');
    showNotice(null);
    try {
      const result = await saveToCloud(withReviewStatus(bookWithInfo()), next);
      showNotice(resultNotice(result, next
        ? 'Boken är publicerad i Bokhandeln – nu kan alla läsa den.'
        : 'Boken är avpublicerad och syns inte längre i Bokhandeln.'));
    } catch (err) {
      showNotice({ tone: 'error', text: err instanceof Error ? err.message : 'Kunde inte ändra publicering' });
    } finally {
      setBusy(null);
    }
  };

  const handleSaveSpread = (updatedSpread: Spread) => {
    onUpdateSpread(updatedSpread);
    setSelectedSpread(null);
  };

  const handleExportPDF = async () => {
    setExporting(true);
    try {
      await exportBookToPDF(bookWithInfo());
    } catch (err) {
      console.error('PDF-export misslyckades:', err);
      showNotice({ tone: 'error', text: 'PDF-exporten misslyckades. Försök igen.' });
    } finally {
      setExporting(false);
    }
  };

  const handleMarkDone = async () => {
    setBusy('done');
    showNotice(null);
    try {
      const result = await saveToCloud({ ...bookWithInfo(), status: 'done' });
      showNotice(resultNotice(result, 'Boken är markerad som klar.'));
    } catch (err) {
      console.error(err);
      showNotice({ tone: 'error', text: 'Kunde inte markera boken som klar' });
    } finally {
      setBusy(null);
    }
  };

  // ── Character check ──
  const handleCheckCharacters = async () => {
    setBusy('check');
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
    setBusy(null);
  };

  const runMenuAction = (action: () => void) => {
    setMenuOpen(false);
    action();
  };

  const isPublic = cloudState === 'public';
  const busyText: Record<Exclude<Busy, null>, string> = {
    share: 'Sparar och publicerar…',
    save: 'Sparar i molnet…',
    publish: isPublic ? 'Avpublicerar…' : 'Publicerar…',
    done: 'Markerar som klar…',
    check: 'Kontrollerar karaktärer…',
  };
  const statusText =
    cloudState === 'public' ? 'Sparad i molnet · Publicerad i Bokhandeln'
    : cloudState === 'private' ? 'Sparad i molnet · Inte publicerad'
    : cloudState === 'local' ? 'Inte sparad i molnet än · Inte publicerad'
    : cloudState === 'unknown' ? 'Sparad på den här enheten'
    : 'Hämtar status…';

  const menuItems: Array<{ key: string; label: string; icon: string; onClick: () => void; disabled?: boolean }> = [
    { key: 'save', label: 'Spara i molnet', icon: 'cloud_upload', onClick: handleSaveBook },
    { key: 'check', label: 'Kontrollera karaktärer', icon: 'verified_user', onClick: handleCheckCharacters },
    {
      key: 'audio',
      label: 'Skapa ljudbok (kommer snart)',
      icon: 'headphones',
      onClick: () => showNotice({ tone: 'warning', text: 'Ljudböcker kommer snart – boken ska kunna läsas upp med en naturlig svensk röst, sida för sida.' }, 6000),
    },
    {
      key: 'done',
      label: book.status === 'done' ? 'Markerad som klar' : 'Markera som klar',
      icon: 'task_alt',
      onClick: handleMarkDone,
      disabled: book.status === 'done',
    },
    {
      key: 'publish',
      label: isPublic ? 'Avpublicera' : 'Publicera i Bokhandeln',
      icon: isPublic ? 'visibility_off' : 'storefront',
      onClick: handlePublishToggle,
      disabled: cloudState === 'loading',
    },
  ];

  // ════════════════════════════════════════════════════════
  //  MAIN RENDER
  // ════════════════════════════════════════════════════════
  return (
    <div className="space-y-6">
      {/* Header */}
      <StepHeader
        eyebrow="Steg 4 av 4 · Färdig bok"
        title="Din bok är klar att läsas"
        description="Bläddra i den satta boken precis som den blir i PDF:en. Redigera text eller bilder och dela när du är nöjd."
        onBack={onBack}
      />

      {/* Book info + Action buttons */}
      <div className="glass rounded-4xl p-5 sm:p-6">
        <div className="flex items-start gap-3 mb-4">
          <div className="hidden sm:flex w-12 h-12 shrink-0 rounded-2xl bg-ink items-center justify-center text-white shadow-soft">
            <Icon name="menu_book" filled size={26} />
          </div>
          <div className="min-w-0 flex-1">
            {/* Titel och författare - sparas när fältet lämnas */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <label className="block min-w-0">
                <span className="text-xs font-medium text-ink/55">Titel</span>
                <input
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  onBlur={commitBookInfo}
                  onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                  className="field !py-2 !px-3 mt-1 font-heading font-bold"
                />
              </label>
              <label className="block min-w-0">
                <span className="text-xs font-medium text-ink/55">Författare</span>
                <input
                  value={authorDraft}
                  onChange={(e) => setAuthorDraft(e.target.value)}
                  onBlur={commitBookInfo}
                  onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                  placeholder="Valfritt – lämna tomt för ingen författare"
                  className="field !py-2 !px-3 mt-1 text-sm"
                />
              </label>
            </div>
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-sm text-ink/55">
              <span>{book.spreads.length} uppslag</span>
              <span>{book.characters.length} karaktärer</span>
              <span>{book.spreads.filter(s => s.status === 'done').length} bilder klara</span>
              {book.status === 'done' && (
                <span className="inline-flex items-center gap-1 text-ink/70 font-medium">
                  <Icon name="task_alt" size={15} /> Klar
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Åtgärder: en primär, en sekundär, resten under "Mer" */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleShare}
            disabled={busy !== null}
            className="btn-action !py-2.5 text-sm w-full sm:w-auto"
          >
            {busy === 'share'
              ? <span className="spinner !w-4 !h-4" />
              : <Icon name={copied ? 'check' : 'ios_share'} size={18} />}
            {busy === 'share' ? 'Delar...' : copied ? 'Länken är kopierad' : 'Dela boken'}
          </button>

          <button onClick={handleExportPDF} disabled={exporting} className="btn-ghost !py-2 text-sm flex-1 sm:flex-none">
            {exporting ? <span className="spinner !w-4 !h-4" /> : <Icon name="download" size={18} />}
            {exporting ? 'Exporterar...' : 'Ladda ner PDF'}
          </button>

          <div ref={menuRef} className="relative flex-1 sm:flex-none">
            <button
              ref={menuButtonRef}
              onClick={() => setMenuOpen(o => !o)}
              disabled={busy !== null}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-controls="bokmeny"
              className="btn-ghost !py-2 text-sm w-full"
            >
              {busy !== null && busy !== 'share'
                ? <span className="spinner !w-4 !h-4" />
                : <Icon name="more_horiz" size={18} />}
              Mer
            </button>
            {menuOpen && (
              <div
                id="bokmeny"
                role="menu"
                aria-label="Fler åtgärder"
                className="absolute right-0 top-full mt-2 w-64 max-w-[calc(100vw-3rem)] glass-strong rounded-2xl p-1.5 z-30"
              >
                {menuItems.map((item, i) => (
                  <div key={item.key}>
                    {i === menuItems.length - 1 && <div className="my-1 h-px bg-line" />}
                    <button
                      role="menuitem"
                      onClick={() => runMenuAction(item.onClick)}
                      disabled={item.disabled}
                      className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium text-ink text-left hover:bg-paper focus:bg-paper outline-none disabled:opacity-40 disabled:pointer-events-none transition-colors"
                    >
                      <Icon name={item.icon} size={18} className="text-ink/55" />
                      {item.label}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Statusrad: molnsparning och publicering */}
        <p className="mt-3 flex items-center gap-1.5 text-xs sm:text-sm text-ink/55" aria-live="polite">
          {busy ? (
            <><span className="spinner !w-3.5 !h-3.5" /> {busyText[busy]}</>
          ) : (
            <>
              <Icon
                name={isPublic ? 'public' : cloudState === 'private' ? 'lock' : 'cloud_off'}
                size={16}
                className={isPublic ? 'text-emerald-600' : ''}
              />
              {statusText}
            </>
          )}
        </p>

        {notice && (
          <div role={notice.tone === 'error' ? 'alert' : 'status'} className={`mt-3 flex items-start gap-2 ${
            notice.tone === 'success' ? 'note-success' : notice.tone === 'warning' ? 'note-warning' : 'note-error'
          }`}>
            <span className="flex-1">{notice.text}</span>
            {notice.tone === 'error' && (
              <button onClick={() => setNotice(null)} aria-label="Stäng meddelandet" className="btn-icon !w-6 !h-6 -mr-1 shrink-0">
                <Icon name="close" size={16} />
              </button>
            )}
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
