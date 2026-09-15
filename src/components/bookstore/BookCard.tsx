'use client';

import { PublicBookSummary } from '@/lib/supabase-db';
import Icon from '../Icon';
import LikeButton from './LikeButton';
import { formatLabel, LikesState } from './shared';

interface Props {
  book: PublicBookSummary;
  likes: LikesState;
  opening: boolean;
  disabled?: boolean;
  onOpen: () => void;
  // Visa skaparens namn (döljs på skaparens egen sida)
  showAuthor?: boolean;
}

export default function BookCard({ book: b, likes, opening, disabled, onOpen, showAuthor = true }: Props) {
  return (
    <div className="group min-w-0">
      <button
        onClick={onOpen}
        disabled={disabled}
        className="relative block w-full aspect-[3/4] rounded-2xl overflow-hidden bg-white border border-line shadow-soft
                   group-hover:shadow-lift group-hover:-translate-y-1 transition-all duration-200"
        title={`Öppna ${b.title}`}
      >
        {b.coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={b.coverUrl} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
        ) : (
          <div className="absolute inset-0 flex flex-col justify-between p-4 bg-gradient-to-b from-paper to-white text-left">
            <Icon name="auto_stories" size={26} className="text-ink/25" />
            <span className="font-heading text-lg font-semibold text-ink/80 leading-tight line-clamp-4 break-words hyphens-auto">{b.title}</span>
          </div>
        )}
        <span className="absolute inset-y-0 left-0 w-2 bg-gradient-to-r from-black/15 to-transparent" />
        {opening && (
          <span className="absolute inset-0 bg-white/70 flex items-center justify-center text-ink">
            <span className="spinner !w-7 !h-7" />
          </span>
        )}
      </button>
      <div className="mt-3 flex items-start justify-between gap-1">
        <button onClick={onOpen} disabled={disabled} className="min-w-0 text-left">
          <h3 className="font-heading font-semibold text-ink leading-snug truncate" title={b.title}>{b.title}</h3>
          <p className="text-xs text-ink/50 mt-0.5 truncate">
            {showAuthor && b.authorName ? `${b.authorName} · ` : ''}{formatLabel(b.bookFormat)}
          </p>
        </button>
        {likes.supported && (
          <LikeButton
            count={likes.counts[b.id] ?? 0}
            liked={likes.liked.has(b.id)}
            onToggle={() => likes.toggle(b.id)}
          />
        )}
      </div>
      {b.description && (
        <p className="mt-1.5 text-xs leading-relaxed text-ink/60 line-clamp-2">{b.description}</p>
      )}
    </div>
  );
}
