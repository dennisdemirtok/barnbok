'use client';

import { useEffect, useState } from 'react';
import {
  AuthorFollowState, getAuthorFollowState, listPublicBooksByAuthor, PublicBookSummary, setFollowAuthor,
} from '@/lib/supabase-db';
import { useAuth } from '@/lib/auth';
import Icon from '../Icon';
import LoginModal from '../LoginModal';
import BookCard from './BookCard';
import { initials, LikesState } from './shared';

interface Props {
  authorUserId: string;
  authorName: string;
  likes: LikesState;
  openingId: string | null;
  openError?: string;
  backLabel: string;
  onBack: () => void;
  onOpenBook: (id: string) => void;
}

export default function AuthorPage({ authorUserId, authorName, likes, openingId, openError, backLabel, onBack, onOpenBook }: Props) {
  const { user } = useAuth();
  const [books, setBooks] = useState<PublicBookSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [follow, setFollow] = useState<AuthorFollowState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showLogin, setShowLogin] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listPublicBooksByAuthor(authorUserId)
      .then(list => { if (!cancelled) setBooks(list); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [authorUserId]);

  // Följ-läget beror på inloggningen - hämta om när användaren loggar in/ut
  useEffect(() => {
    let cancelled = false;
    getAuthorFollowState(authorUserId)
      .then(state => { if (!cancelled) setFollow(state); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [authorUserId, user?.id]);

  const toggleFollow = async () => {
    if (!follow) return;
    const next = !follow.following;
    const previous = follow;
    setError('');
    setBusy(true);
    setFollow({ ...follow, following: next, followers: Math.max(0, follow.followers + (next ? 1 : -1)) });
    try {
      await setFollowAuthor(authorUserId, next);
    } catch (err) {
      setFollow(previous);
      setError(err instanceof Error ? err.message : 'Något gick fel');
    } finally {
      setBusy(false);
    }
  };

  const isMe = user?.id === authorUserId;
  const totalLikes = likes.supported ? books.reduce((sum, b) => sum + (likes.counts[b.id] ?? 0), 0) : 0;

  const stats = [
    loading ? null : `${books.length} ${books.length === 1 ? 'bok' : 'böcker'}`,
    follow?.supported ? `${follow.followers} följare` : null,
    likes.supported && totalLikes > 0 ? `${totalLikes} ${totalLikes === 1 ? 'hjärta' : 'hjärtan'}` : null,
  ].filter(Boolean);

  return (
    <div className="space-y-8">
      <div className="space-y-4">
        <button onClick={onBack} className="inline-flex items-center gap-1 -ml-1 px-1 text-sm font-medium text-ink/55 hover:text-ink transition-colors">
          <Icon name="arrow_back" size={18} /> {backLabel}
        </button>

        <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-6">
          <span className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-brand/10 text-brand font-heading font-bold text-2xl sm:text-3xl flex items-center justify-center shrink-0">
            {initials(authorName)}
          </span>
          <div className="min-w-0 flex-1">
            <p className="eyebrow">Skapare</p>
            <h2 className="mt-1 text-3xl sm:text-4xl font-heading font-bold tracking-tight text-ink leading-tight break-words">{authorName}</h2>
            {stats.length > 0 && <p className="mt-1 text-sm text-ink/55">{stats.join(' · ')}</p>}
          </div>

          {follow?.supported && (
            <div className="shrink-0">
              {isMe ? (
                <span className="magic-chip">Det här är du</span>
              ) : !user ? (
                <button onClick={() => setShowLogin(true)} className="btn-ghost">
                  <Icon name="person_add" size={19} /> Logga in för att följa
                </button>
              ) : (
                <button
                  onClick={toggleFollow}
                  disabled={busy}
                  aria-pressed={follow.following}
                  className={follow.following ? 'btn-ghost' : 'btn-action'}
                >
                  <Icon name={follow.following ? 'check' : 'person_add'} size={19} />
                  {follow.following ? 'Följer' : 'Följ'}
                </button>
              )}
            </div>
          )}
        </div>
        {error && <div className="note-error">{error}</div>}
        {openError && <div className="note-error">{openError}</div>}
      </div>

      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-5">
          {[0, 1, 2, 3, 4].map(i => <div key={i} className="skeleton aspect-[3/4] rounded-2xl" />)}
        </div>
      ) : books.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-ink/20 bg-white/60 px-6 py-14 text-center">
          <Icon name="auto_stories" size={32} className="text-ink/30" />
          <h3 className="mt-3 text-xl font-heading font-bold text-ink">Inga publicerade böcker</h3>
          <p className="mt-1 text-ink/55">{authorName} har inga böcker i bokhandeln just nu.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-x-5 gap-y-8">
          {books.map(b => (
            <BookCard
              key={b.id}
              book={b}
              likes={likes}
              opening={openingId === b.id}
              disabled={!!openingId}
              onOpen={() => onOpenBook(b.id)}
              showAuthor={false}
            />
          ))}
        </div>
      )}

      {showLogin && <LoginModal onClose={() => setShowLogin(false)} />}
    </div>
  );
}
