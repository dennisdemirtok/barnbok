'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/auth';

interface Props {
  onClose: () => void;
}

export default function LoginModal({ onClose }: Props) {
  const { signInWithPassword, signUp } = useAuth();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-xl font-bold text-gray-800">
            {mode === 'login' ? 'Logga in' : 'Skapa konto'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
        </div>
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
              className="w-full px-3 py-2 border-2 border-gray-300 rounded-lg
                         focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Lösenord</label>
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Minst 6 tecken"
              className="w-full px-3 py-2 border-2 border-gray-300 rounded-lg
                         focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none"
            />
          </div>

          {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>}
          {info && <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm">{info}</div>}

          <button
            type="submit"
            disabled={busy}
            className="w-full py-2.5 bg-blue-600 text-white font-semibold rounded-lg
                       hover:bg-blue-700 disabled:bg-gray-400 transition-colors"
          >
            {busy ? 'Vänta...' : mode === 'login' ? 'Logga in' : 'Skapa konto'}
          </button>
        </form>

        <div className="mt-4 text-center text-sm text-gray-500">
          {mode === 'login' ? (
            <>Har du inget konto?{' '}
              <button onClick={() => { setMode('signup'); setError(''); setInfo(''); }} className="text-blue-600 font-medium hover:underline">
                Skapa ett
              </button>
            </>
          ) : (
            <>Har du redan ett konto?{' '}
              <button onClick={() => { setMode('login'); setError(''); setInfo(''); }} className="text-blue-600 font-medium hover:underline">
                Logga in
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
