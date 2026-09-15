'use client';

import { useEffect, useRef, useState } from 'react';
import Icon from './Icon';

export type NavTarget = 'library' | 'create' | 'characterStudio' | 'bookstore';

interface NavProps {
  active: NavTarget;
  onNavigate: (target: NavTarget) => void;
}

interface HeaderProps extends NavProps {
  userEmail?: string | null;
  authLoading: boolean;
  onLogin: () => void;
  onLogout: () => void;
  // Internt verktyg - visas bara för administratörer
  onOpenReferences?: () => void;
}

const LINKS: { target: Exclude<NavTarget, 'create'>; label: string; icon: string }[] = [
  { target: 'library', label: 'Mina böcker', icon: 'collections_bookmark' },
  { target: 'characterStudio', label: 'Karaktärer', icon: 'face' },
  { target: 'bookstore', label: 'Bokhandeln', icon: 'storefront' },
];

// ── Toppmeny: full navigering på desktop, bara logga + konto på mobil ──
export function SiteHeader({ active, onNavigate, userEmail, authLoading, onLogin, onLogout, onOpenReferences }: HeaderProps) {
  return (
    <header className="sticky top-0 z-30 bg-paper/85 backdrop-blur-md border-b border-line">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 md:h-16 flex items-center justify-between gap-3">
        <button onClick={() => onNavigate('library')} className="flex items-center gap-2.5 min-w-0 group" title="Till startsidan">
          <span className="w-9 h-9 shrink-0 rounded-xl bg-ink text-white flex items-center justify-center group-hover:bg-brand transition-colors">
            <Icon name="auto_stories" filled size={20} />
          </span>
          <span className="font-heading text-lg font-bold text-ink tracking-tight truncate">Bokverktyget</span>
        </button>

        <nav className="hidden md:flex items-center gap-1" aria-label="Huvudmeny">
          {LINKS.map(link => (
            <button
              key={link.target}
              onClick={() => onNavigate(link.target)}
              aria-current={active === link.target ? 'page' : undefined}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-sm font-medium transition-colors ${
                active === link.target ? 'bg-ink/[0.07] text-ink' : 'text-ink/60 hover:text-ink hover:bg-ink/[0.04]'
              }`}
            >
              <Icon name={link.icon} filled={active === link.target} size={18} /> {link.label}
            </button>
          ))}
        </nav>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => onNavigate('create')}
            className={`hidden md:inline-flex btn-action !px-4 !py-2 text-sm ${active === 'create' ? 'ring-2 ring-brand/30 ring-offset-2 ring-offset-paper' : ''}`}
          >
            <Icon name="add" size={18} /> Skapa bok
          </button>
          {!authLoading && (
            userEmail
              ? <AccountMenu email={userEmail} onLogout={onLogout} onOpenReferences={onOpenReferences} />
              : (
                <>
                  {onOpenReferences && (
                    <button onClick={onOpenReferences} className="btn-icon" title="Referensdatabas (admin)">
                      <Icon name="tune" size={20} />
                    </button>
                  )}
                  <button onClick={onLogin} className="btn-ghost !px-4 !py-2 text-sm whitespace-nowrap">
                    Logga in
                  </button>
                </>
              )
          )}
        </div>
      </div>
    </header>
  );
}

function AccountMenu({ email, onLogout, onOpenReferences }: { email: string; onLogout: () => void; onOpenReferences?: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onClick); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const item = 'w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm text-ink/80 hover:bg-paper text-left';
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(v => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={email}
        className="w-9 h-9 rounded-full bg-ink text-white flex items-center justify-center text-sm font-semibold uppercase hover:bg-brand transition-colors"
      >
        {email.charAt(0)}
      </button>
      {open && (
        <div role="menu" className="absolute right-0 mt-2 w-60 p-1.5 rounded-2xl bg-white border border-line shadow-lift animate-pop z-40">
          <p className="px-3 pt-2 pb-2.5 text-xs text-ink/50 truncate border-b border-line mb-1">Inloggad som<br /><span className="text-ink/80 font-medium">{email}</span></p>
          {onOpenReferences && (
            <button role="menuitem" onClick={() => { setOpen(false); onOpenReferences(); }} className={item}>
              <Icon name="tune" size={18} /> Referensdatabas <span className="ml-auto text-[10px] font-semibold uppercase text-ink/35">Admin</span>
            </button>
          )}
          <button role="menuitem" onClick={() => { setOpen(false); onLogout(); }} className={item}>
            <Icon name="logout" size={18} /> Logga ut
          </button>
        </div>
      )}
    </div>
  );
}

// ── Flikrad längst ner på mobil ──
export function MobileTabBar({ active, onNavigate }: NavProps) {
  const tabs: { target: NavTarget; label: string; icon: string }[] = [
    { target: 'library', label: 'Böcker', icon: 'collections_bookmark' },
    { target: 'create', label: 'Skapa', icon: 'add' },
    { target: 'characterStudio', label: 'Karaktärer', icon: 'face' },
    { target: 'bookstore', label: 'Bokhandel', icon: 'storefront' },
  ];
  return (
    <nav
      aria-label="Huvudmeny"
      className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-white/95 backdrop-blur-md border-t border-line pb-[env(safe-area-inset-bottom)]"
    >
      <div className="grid grid-cols-4 h-16">
        {tabs.map(tab => {
          const on = active === tab.target;
          return (
            <button
              key={tab.target}
              onClick={() => onNavigate(tab.target)}
              aria-current={on ? 'page' : undefined}
              className={`flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors ${on ? 'text-ink' : 'text-ink/45'}`}
            >
              {tab.target === 'create' ? (
                <span className={`w-9 h-7 rounded-full flex items-center justify-center ${on ? 'bg-brand text-white' : 'bg-ink text-white'}`}>
                  <Icon name="add" size={20} />
                </span>
              ) : (
                <span className={`w-12 h-7 rounded-full flex items-center justify-center ${on ? 'bg-ink/[0.07]' : ''}`}>
                  <Icon name={tab.icon} filled={on} size={22} />
                </span>
              )}
              {tab.label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

// ── Sidfot ──
interface FooterProps {
  onNavigate: (target: NavTarget) => void;
  onStyleTest: () => void;
}

export function SiteFooter({ onNavigate, onStyleTest }: FooterProps) {
  const link = 'text-sm text-ink/60 hover:text-ink transition-colors text-left';
  const columns: { title: string; items: { label: string; onClick?: () => void }[] }[] = [
    {
      title: 'Skapa',
      items: [
        { label: 'Skriv en bok med AI', onClick: () => onNavigate('create') },
        { label: 'Prova stilar på din text', onClick: onStyleTest },
        { label: 'Karaktärer', onClick: () => onNavigate('characterStudio') },
      ],
    },
    {
      title: 'Upptäck',
      items: [
        { label: 'Bokhandeln', onClick: () => onNavigate('bookstore') },
        { label: 'Mina böcker', onClick: () => onNavigate('library') },
      ],
    },
    {
      title: 'Snart',
      items: [
        { label: 'Ljudböcker' },
        { label: 'Tryckta böcker' },
      ],
    },
  ];

  return (
    <footer className="border-t border-line bg-white/70 pb-20 md:pb-0">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10 sm:py-14 grid gap-10 md:grid-cols-[1.4fr_2fr]">
        <div className="max-w-sm">
          <div className="flex items-center gap-2.5">
            <span className="w-9 h-9 rounded-xl bg-ink text-white flex items-center justify-center">
              <Icon name="auto_stories" filled size={20} />
            </span>
            <span className="font-heading text-lg font-bold text-ink tracking-tight">Bokverktyget</span>
          </div>
          <p className="mt-4 text-sm text-ink/60 leading-relaxed">
            Illustrerade barnböcker i din egen stil – från idé eller färdigt manus till en bok satt som i bokhandeln.
          </p>
          <button onClick={() => onNavigate('create')} className="btn-primary !py-2.5 text-sm mt-5">
            <Icon name="add" size={18} /> Skapa en bok
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-8">
          {columns.map(col => (
            <div key={col.title}>
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-ink/40">{col.title}</p>
              <ul className="mt-3 space-y-2.5">
                {col.items.map(item => (
                  <li key={item.label}>
                    {item.onClick
                      ? <button onClick={item.onClick} className={link}>{item.label}</button>
                      : <span className="text-sm text-ink/40">{item.label}</span>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      <div className="border-t border-line">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-5 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-ink/45">
          <span>© {new Date().getFullYear()} Bokverktyget</span>
          <span className="inline-flex items-center gap-1.5">
            <Icon name="auto_awesome" size={14} /> Illustrationer skapas med AI · Texten är din
          </span>
        </div>
      </div>
    </footer>
  );
}
