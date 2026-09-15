'use client';

import Icon from '../Icon';

interface Props {
  count: number;
  liked: boolean;
  onToggle: () => void;
  size?: 'sm' | 'lg';
}

export default function LikeButton({ count, liked, onToggle, size = 'sm' }: Props) {
  const label = liked ? 'Ta bort hjärta' : 'Ge boken ett hjärta';

  if (size === 'lg') {
    return (
      <button
        onClick={onToggle}
        aria-pressed={liked}
        title={label}
        className={`inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-full font-semibold border transition-all duration-150 active:scale-[0.97]
          ${liked
            ? 'bg-rose-50 border-rose-200 text-rose-600 hover:bg-rose-100'
            : 'bg-white border-line text-ink hover:bg-paper hover:border-ink/25'}`}
      >
        <Icon name="favorite" filled={liked} size={21} className={liked ? 'text-rose-500 animate-pop' : 'text-ink/60'} />
        <span className="tabular-nums">{count}</span>
        <span className="sr-only">{count === 1 ? 'hjärta' : 'hjärtan'}</span>
      </button>
    );
  }

  return (
    <button
      onClick={onToggle}
      aria-pressed={liked}
      title={label}
      className={`inline-flex items-center gap-1 h-8 px-2 -mr-1.5 rounded-full text-xs font-semibold shrink-0 transition-all active:scale-95
        ${liked ? 'text-rose-600 hover:bg-rose-50' : 'text-ink/50 hover:text-ink hover:bg-ink/5'}`}
    >
      <Icon name="favorite" filled={liked} size={17} className={liked ? 'text-rose-500' : ''} />
      <span className="tabular-nums">{count}</span>
    </button>
  );
}
