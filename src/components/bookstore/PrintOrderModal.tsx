'use client';

import { useEffect, useState } from 'react';
import { BookProject } from '@/lib/types';
import { isPrintInterestSupported, registerPrintInterest } from '@/lib/supabase-db';
import { useAuth } from '@/lib/auth';
import Icon from '../Icon';

interface Props {
  book: BookProject;
  kind?: 'print' | 'audio';
  onDownload: () => Promise<void>;
  downloading: boolean;
  onClose: () => void;
}

// Ärlig "kommer snart"-ruta för tryckt bok och ljudbok - inget går att beställa än.
// Erbjuder tryckfärdig PDF (tryck) och, om tabellen finns, en intresseanmälan.
export default function PrintOrderModal({ book, kind = 'print', onDownload, downloading, onClose }: Props) {
  const audio = kind === 'audio';
  const { user } = useAuth();
  const [interestSupported, setInterestSupported] = useState(false);
  const [email, setEmail] = useState(user?.email || '');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    isPrintInterestSupported().then(ok => { if (!cancelled) setInterestSupported(ok); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSending(true);
    try {
      await registerPrintInterest(book.id, email, kind);
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Något gick fel');
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      className="fixed inset-0 !m-0 bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center z-50 p-3 sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="print-title"
    >
      <div
        className="glass-strong rounded-4xl w-full max-w-md p-6 sm:p-7 animate-pop max-h-[92vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-4">
          <div className="w-12 h-12 rounded-2xl bg-ink flex items-center justify-center text-white shadow-soft">
            <Icon name={audio ? 'headphones' : 'print'} filled size={24} />
          </div>
          <button onClick={onClose} className="btn-icon" title="Stäng">
            <Icon name="close" size={22} />
          </button>
        </div>

        <p className="eyebrow">Kommer snart</p>
        <h2 id="print-title" className="mt-1 text-2xl font-heading font-bold text-ink">{audio ? 'Ljudbok' : 'Tryckt bok'}</h2>
        {audio ? (
          <p className="mt-2 text-sm text-ink/65 leading-relaxed">
            Snart kan <span className="font-semibold text-ink">{book.title}</span> läsas upp med en naturlig svensk röst –
            sida för sida, medan bilderna bläddras fram. Vi jobbar på det.
          </p>
        ) : (
          <p className="mt-2 text-sm text-ink/65 leading-relaxed">
            Det går inte att beställa tryckta exemplar av <span className="font-semibold text-ink">{book.title}</span> ännu - vi jobbar på det.
            Under tiden kan du ladda ner en tryckfärdig PDF i bokformat 16×21 cm och skriva ut själv eller lämna den till ett tryckeri.
          </p>
        )}

        {!audio && (
          <button onClick={onDownload} disabled={downloading} className="btn-primary w-full mt-5">
            {downloading ? <span className="spinner !w-4 !h-4" /> : <Icon name="download" size={19} />}
            {downloading ? 'Skapar PDF...' : 'Ladda ner tryckfärdig PDF'}
          </button>
        )}

        {interestSupported && (
          <div className="mt-6 pt-5 border-t border-line">
            {sent ? (
              <div className="note-success">
                Tack! Vi meddelar dig när {audio ? 'ljudböcker finns' : 'tryckta böcker går att beställa'}. Ingen beställning har lagts och inget kostar något.
              </div>
            ) : (
              <form onSubmit={submit} className="space-y-3">
                <div>
                  <label htmlFor="print-email" className="block text-sm font-semibold text-ink">{audio ? 'Vill du veta när ljudböcker finns?' : 'Vill du veta när det går att beställa?'}</label>
                  <p className="text-xs text-ink/50 mt-0.5">Frivilligt. Adressen används bara för att meddela dig om {audio ? 'ljudböcker' : 'tryckta böcker'}.</p>
                </div>
                <input
                  id="print-email"
                  type="email"
                  required
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="namn@exempel.se"
                  className="field"
                  autoComplete="email"
                />
                {error && <div className="note-error">{error}</div>}
                <button type="submit" disabled={sending || !email.trim()} className="btn-ghost w-full">
                  {sending ? <span className="spinner !w-4 !h-4" /> : <Icon name="notifications" size={19} />}
                  Meddela mig
                </button>
              </form>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
