'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import Icon from './Icon';

interface Props {
  onClose: () => void;
}

export default function LoginModal({ onClose }: Props) {
  const { signInWithPassword, signUp } = useAuth();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setInfo('');
    setBusy(true);
    try {
      if (mode === 'login') {
        const { error } = await signInWithPassword(email.trim(), password);
        if (error) { setError(error); return; }
        onClose();
      } else {
        const { error, needsConfirmation } = await signUp(email.trim(), password);
        if (error) { setError(error); return; }
        if (needsConfirmation) {
          setInfo('Konto skapat! Kolla din e-post och bekräfta adressen innan du loggar in.');
        } else {
          onClose();
        }
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="glass-strong rounded-4xl w-full max-w-md p-7 animate-pop"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-4">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-brand to-magic flex items-center justify-center text-white shadow-glow">
            <Icon name={mode === 'login' ? 'lock_open' : 'person_add'} filled size={24} />
          </div>
          <button onClick={onClose} className="btn-icon" title="Stäng">
            <Icon name="close" size={22} />
          </button>
        </div>
        <h2 className="text-2xl font-heading font-bold text-gray-800 mb-1">
          {mode === 'login' ? 'Välkommen tillbaka!' : 'Skapa konto'}
        </h2>
        <p className="text-sm text-gray-500 mb-5">
          {mode === 'login'
            ? 'Logga in för att spara dina böcker i molnet och nå dem från alla enheter.'
            : 'Skapa ett gratis konto så att dina böcker och figurer sparas säkert.'}
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">E-post</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="namn@exempel.se"
              className="field"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Lösenord</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Minst 6 tecken"
                className="field pr-12"
              />
              <button
                type="button"
                onClick={() => setShowPassword(v => !v)}
                title={showPassword ? 'Dölj lösenord' : 'Visa lösenord'}
                className="absolute right-2 top-1/2 -translate-y-1/2 btn-icon !w-8 !h-8 !text-gray-400 hover:!text-gray-600"
              >
                <Icon name={showPassword ? 'visibility_off' : 'visibility'} size={19} />
              </button>
            </div>
          </div>

          {error && <div className="note-error">{error}</div>}
          {info && <div className="note-success">{info}</div>}

          <button
            type="submit"
            disabled={busy}
            className="btn-primary w-full"
          >
            {busy ? 'Vänta...' : mode === 'login' ? 'Logga in' : 'Skapa konto'}
          </button>
        </form>

        <div className="mt-4 text-center text-sm text-gray-500">
          {mode === 'login' ? (
            <>Har du inget konto?{' '}
              <button onClick={() => { setMode('signup'); setError(''); setInfo(''); }} className="text-brand font-semibold hover:underline">
                Skapa ett
              </button>
            </>
          ) : (
            <>Har du redan ett konto?{' '}
              <button onClick={() => { setMode('login'); setError(''); setInfo(''); }} className="text-brand font-semibold hover:underline">
                Logga in
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
