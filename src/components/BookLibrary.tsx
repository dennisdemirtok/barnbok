'use client';

import { useState, useEffect } from 'react';
import { BookProject } from '@/lib/types';
import { listBooks, deleteBook } from '@/lib/storage';
import { getStylePreset } from '@/lib/styles';
import Icon from './Icon';
import Reveal from './Reveal';

interface Props {
  onLoadBook: (book: BookProject) => void;
  onNewBook: () => void;
  onStyleTest: () => void;
  onReuseBook: (book: BookProject) => void;
  onFinishBook: () => void;
}

const STATUS: Record<BookProject['status'], { text: string; className: string }> = {
  importing: { text: 'Utkast', className: 'bg-white text-ink/70' },
  characters: { text: 'Karaktärer', className: 'bg-amber-100 text-amber-800' },
  generating: { text: 'Illustreras', className: 'bg-white text-brand' },
  reviewing: { text: 'Klar att läsa', className: 'bg-emerald-100 text-emerald-800' },
  done: { text: 'Färdig', className: 'bg-emerald-600 text-white' },
};

const STEPS = [
  { title: 'Berättelsen', text: 'Skriv själv, klistra in ditt manus eller låt AI:n skriva utifrån din idé.', icon: 'edit_note' },
  { title: 'Stil & karaktärer', text: 'Prova stilar på din text och godkänn figurer som följer med genom hela boken.', icon: 'palette' },
  { title: 'Illustrationer', text: 'Varje sida målas i vald stil och kvalitetskontrolleras automatiskt.', icon: 'brush' },
  { title: 'Färdig bok', text: 'Satt som en riktig bok – läs, ladda ner som tryckfärdig PDF eller dela.', icon: 'auto_stories' },
];

// Liten tidslinje som illustration i "Slutför din bok"-kortet
const FINISH_PREVIEW: { label: string; kind: 'author' | 'ai' | 'planned' }[] = [
  { label: 'Prolog', kind: 'author' },
  { label: 'Kapitel 1 – Innan försvinnandet', kind: 'author' },
  { label: 'Kapitel 2 – Spåren vid bäcken', kind: 'ai' },
  { label: 'Kapitel 3 – Mormors hemlighet', kind: 'planned' },
  { label: 'Kapitel 4', kind: 'planned' },
];

export default function BookLibrary({ onLoadBook, onNewBook, onStyleTest, onReuseBook, onFinishBook }: Props) {
  const [books, setBooks] = useState<BookProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  useEffect(() => {
    listBooks()
      .then(saved => {
        saved.sort((a, b) =>
          new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime()
        );
        setBooks(saved);
      })
      .catch(err => console.error('Kunde inte ladda sparade böcker:', err))
      .finally(() => setLoading(false));
  }, []);

  // Tvåstegsbekräftelse i stället för window.confirm
  const handleDelete = async (id: string) => {
    if (confirmDeleteId !== id) {
      setConfirmDeleteId(id);
      setTimeout(() => setConfirmDeleteId(prev => (prev === id ? null : prev)), 4000);
      return;
    }
    setConfirmDeleteId(null);
    try {
      await deleteBook(id);
      setBooks(prev => prev.filter(b => b.id !== id));
    } catch (err) {
      console.error('Kunde inte ta bort boken:', err);
    }
  };

  return (
    <div className="space-y-20 sm:space-y-24">
      {/* ── Hero ── */}
      <section className="grid lg:grid-cols-[1.1fr_0.9fr] gap-10 lg:gap-16 items-center pt-2 sm:pt-6">
        <div>
          <p className="eyebrow">Barnböcker med AI</p>
          <h1 className="mt-4 text-[2.6rem] leading-[1.05] sm:text-6xl font-heading font-extrabold text-ink tracking-[-0.035em]">
            Från idé till färdig bok – i din egen stil.
          </h1>
          <p className="mt-5 text-lg text-ink/65 leading-relaxed max-w-xl">
            Skriv eller klistra in berättelsen, välj bland stilar som bygger på riktiga barnböcker, och få en
            illustrerad bok satt som i bokhandeln.
          </p>
          <div className="mt-8 flex flex-col sm:flex-row gap-3">
            <button onClick={onNewBook} className="btn-primary !px-6 !py-3.5 text-base">
              <Icon name="add" size={20} /> Skapa en bok
            </button>
            <button onClick={onStyleTest} className="btn-ghost !px-6 !py-3.5 text-base">
              <Icon name="palette" size={20} /> Prova stilar på din text
            </button>
          </div>
          <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-ink/55">
            <span className="inline-flex items-center gap-1.5"><Icon name="check_circle" size={17} className="text-emerald-600" /> Tryckfärdig PDF</span>
            <span className="inline-flex items-center gap-1.5"><Icon name="check_circle" size={17} className="text-emerald-600" /> Konsekventa karaktärer</span>
            <span className="inline-flex items-center gap-1.5"><Icon name="check_circle" size={17} className="text-emerald-600" /> Dela med en länk</span>
          </div>
        </div>

        <div className="relative mx-auto w-full max-w-md lg:max-w-none">
          <div className="absolute -inset-6 sm:-inset-10 bg-brand/[0.07] rounded-[3rem] -rotate-3" />
          <div className="relative rounded-[2rem] overflow-hidden border border-line shadow-lift bg-white rotate-1">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/hero-book.png" alt="En uppslagen, illustrerad barnbok" className="w-full h-auto" />
          </div>
        </div>
      </section>

      {/* ── Slutför din bok ── */}
      <section
        aria-labelledby="finish-book-heading"
        className="relative overflow-hidden rounded-[2rem] border border-brand/15 bg-gradient-to-br from-brand/[0.09] via-white to-white shadow-soft"
      >
        <div aria-hidden className="absolute -right-24 -top-24 w-72 h-72 rounded-full bg-brand/10 blur-3xl" />
        <div className="relative grid lg:grid-cols-[1.05fr_0.95fr] gap-8 lg:gap-12 items-center p-6 sm:p-10 lg:p-12">
          <div>
            <p className="eyebrow"><Icon name="history_edu" size={16} /> Nytt · Slutför din bok</p>
            <h2 id="finish-book-heading" className="mt-3 text-3xl sm:text-4xl font-heading font-bold tracking-tight text-ink leading-tight">
              Har du början? Vi hjälper dig skriva klart.
            </h2>
            <p className="mt-3 text-lg text-ink/65 leading-relaxed max-w-xl">
              Skriv inledningen och första kapitlet själv – AI:n lär sig ditt språk och hjälper dig skriva klart boken.
            </p>
            <ul className="mt-5 space-y-2 text-sm text-ink/70">
              <li className="flex items-start gap-2"><Icon name="record_voice_over" size={18} className="text-brand mt-px" /> Skriver i din ton, din rytm och dina repliker</li>
              <li className="flex items-start gap-2"><Icon name="timeline" size={18} className="text-brand mt-px" /> Du bestämmer riktningen på en tidslinje</li>
              <li className="flex items-start gap-2"><Icon name="ink_highlighter" size={18} className="text-brand mt-px" /> Markera det som skaver och skriv om just det</li>
            </ul>
            <button onClick={onFinishBook} className="btn-action mt-7 !px-6 !py-3.5 text-base w-full sm:w-auto">
              Slutför din bok <Icon name="arrow_forward" size={20} />
            </button>
          </div>

          <div aria-hidden className="relative rounded-3xl bg-white border border-line shadow-lift p-4 sm:p-5 lg:rotate-1">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold uppercase tracking-[0.12em] text-ink/40">Tidslinje</span>
              <span className="text-xs text-ink/45 tabular-nums">3 av 10 kapitel</span>
            </div>
            <ol className="relative space-y-2">
              <span className="absolute left-[15px] top-4 bottom-4 w-px bg-line" />
              {FINISH_PREVIEW.map((c, i) => (
                <li key={c.label} className="relative flex items-center gap-3 rounded-2xl border border-line bg-white px-2.5 py-2">
                  <span
                    className={`w-[22px] h-[22px] shrink-0 rounded-full flex items-center justify-center text-[10px] font-bold ${
                      c.kind === 'author' ? 'bg-ink text-white' : c.kind === 'ai' ? 'bg-brand text-white' : 'bg-white border-2 border-dashed border-ink/20 text-ink/45'
                    }`}
                  >
                    {i + 1}
                  </span>
                  <span className={`flex-1 min-w-0 truncate text-sm ${c.kind === 'planned' ? 'text-ink/50' : 'font-semibold text-ink'}`}>{c.label}</span>
                  <span
                    className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                      c.kind === 'author' ? 'bg-ink text-white' : c.kind === 'ai' ? 'bg-brand/10 text-brand' : 'border border-dashed border-ink/25 text-ink/45'
                    }`}
                  >
                    {c.kind === 'author' ? 'Din text' : c.kind === 'ai' ? 'AI-skriven' : 'Planerad'}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      {/* ── Mina böcker ── */}
      <section className="space-y-6" id="mina-bocker">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="eyebrow">Ditt bibliotek</p>
            <h2 className="mt-2 text-3xl font-heading font-bold tracking-tight text-ink">Mina böcker</h2>
          </div>
          {books.length > 0 && (
            <button onClick={onNewBook} className="btn-ghost shrink-0">
              <Icon name="add" size={19} /> Ny bok
            </button>
          )}
        </div>

        {loading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-5">
            {[0, 1, 2, 3, 4].map(i => <div key={i} className="skeleton aspect-[3/4] rounded-2xl" />)}
          </div>
        ) : books.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-ink/20 bg-white/60 px-6 py-14 text-center">
            <span className="w-14 h-14 mx-auto rounded-2xl bg-ink/[0.05] text-ink/60 flex items-center justify-center">
              <Icon name="auto_stories" size={28} />
            </span>
            <h3 className="mt-4 text-xl font-heading font-bold text-ink">Här hamnar dina böcker</h3>
            <p className="mt-1 text-ink/55 max-w-sm mx-auto">Allt du skapar sparas automatiskt i webbläsaren, och i molnet när du sparar boken.</p>
            <button onClick={onNewBook} className="btn-primary mt-6">
              <Icon name="add" size={19} /> Skapa din första bok
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-x-5 gap-y-8">
            {books.map(book => {
              const cover = book.spreads.find(s => s.pages === 'omslag' && s.generatedImage)
                || book.spreads.find(s => s.generatedImage);
              const status = STATUS[book.status] || STATUS.importing;
              const images = book.spreads.filter(s => s.generatedImage).length;
              const style = getStylePreset(book.stylePresetId);

              return (
                <div key={book.id} className="group">
                  <button
                    onClick={() => onLoadBook(book)}
                    className="relative block w-full aspect-[3/4] rounded-2xl overflow-hidden bg-white border border-line shadow-soft
                               group-hover:shadow-lift group-hover:-translate-y-1 transition-all duration-200 text-left"
                    title={`Öppna ${book.title}`}
                  >
                    {cover?.generatedImage ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={`data:image/png;base64,${cover.generatedImage}`}
                        alt=""
                        className="absolute inset-0 w-full h-full object-cover"
                      />
                    ) : (
                      <div className="absolute inset-0 flex flex-col justify-between p-4 bg-gradient-to-b from-paper to-white">
                        <Icon name="auto_stories" size={26} className="text-ink/25" />
                        <span className="font-heading text-lg font-semibold text-ink/80 leading-tight line-clamp-4 break-words hyphens-auto">{book.title}</span>
                      </div>
                    )}
                    {/* Bokrygg */}
                    <span className="absolute inset-y-0 left-0 w-2 bg-gradient-to-r from-black/15 to-transparent" />
                    <span className={`absolute bottom-2.5 left-3.5 px-2 py-0.5 rounded-full text-[11px] font-semibold shadow-soft ${status.className}`}>
                      {status.text}
                    </span>
                  </button>

                  <div className="mt-3 flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="font-heading font-semibold text-ink leading-snug truncate" title={book.title}>{book.title}</h3>
                      <p className="text-xs text-ink/50 mt-0.5 truncate">
                        {style ? `${style.label} · ` : ''}{images} {images === 1 ? 'bild' : 'bilder'} · {new Date(book.updatedAt || book.createdAt).toLocaleDateString('sv-SE')}
                      </p>
                    </div>
                    <div className="flex shrink-0 -mr-1.5">
                      <button onClick={() => onReuseBook(book)} title="Skapa en kopia med nya bilder" className="btn-icon !w-8 !h-8">
                        <Icon name="content_copy" size={17} />
                      </button>
                      {confirmDeleteId === book.id ? (
                        <button
                          onClick={() => handleDelete(book.id)}
                          className="px-2.5 h-8 rounded-full bg-red-600 text-white text-xs font-semibold animate-pop"
                        >
                          Ta bort?
                        </button>
                      ) : (
                        <button onClick={() => handleDelete(book.id)} title="Ta bort boken" className="btn-icon !w-8 !h-8 hover:!text-red-600 hover:!bg-red-50">
                          <Icon name="delete" size={17} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ── Så går det till ── */}
      <Reveal as="section" className="space-y-8">
        <div className="max-w-2xl">
          <p className="eyebrow">Så går det till</p>
          <h2 className="mt-2 text-3xl font-heading font-bold tracking-tight text-ink">Fyra steg till en färdig bok</h2>
        </div>
        <ol className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {STEPS.map((s, i) => (
            <li key={s.title} className="card-glass hover:!shadow-soft p-6">
              <div className="flex items-center justify-between">
                <span className="w-11 h-11 rounded-xl bg-paper border border-line text-ink flex items-center justify-center">
                  <Icon name={s.icon} size={22} />
                </span>
                <span className="font-heading text-3xl font-bold tracking-tight text-ink/15">{i + 1}</span>
              </div>
              <h3 className="mt-5 font-heading text-lg font-semibold text-ink">{s.title}</h3>
              <p className="mt-1.5 text-sm text-ink/60 leading-relaxed">{s.text}</p>
            </li>
          ))}
        </ol>
      </Reveal>

      {/* ── Avslutning ── */}
      <Reveal as="section" className="rounded-[2rem] bg-ink text-white px-6 py-12 sm:px-14 sm:py-16 flex flex-col md:flex-row md:items-center md:justify-between gap-8">
        <div className="max-w-xl">
          <h2 className="text-3xl sm:text-4xl font-heading font-bold tracking-tight leading-tight">Har du redan en berättelse?</h2>
          <p className="mt-3 text-white/65 text-lg">Klistra in början och se den i sex olika stilar innan du bestämmer dig.</p>
        </div>
        <button onClick={onStyleTest} className="inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-full bg-white text-ink font-semibold hover:bg-paper transition-colors shrink-0">
          Prova stilar <Icon name="arrow_forward" size={20} />
        </button>
      </Reveal>

    </div>
  );
}
