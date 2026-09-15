'use client';

import { ReactNode } from 'react';
import Icon from './Icon';

interface Props {
  eyebrow: string;
  title: ReactNode;
  description?: ReactNode;
  onBack?: () => void;
  backLabel?: string;
  actions?: ReactNode;
}

// Gemensam rubrik för alla steg i bokskapandet
export default function StepHeader({ eyebrow, title, description, onBack, backLabel = 'Tillbaka', actions }: Props) {
  return (
    <div className="space-y-3">
      {onBack && (
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1 -ml-1 px-1 text-sm font-medium text-ink/55 hover:text-ink transition-colors"
        >
          <Icon name="arrow_back" size={18} /> {backLabel}
        </button>
      )}
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div className="min-w-0">
          <p className="eyebrow">{eyebrow}</p>
          <h2 className="mt-2 text-3xl sm:text-4xl font-heading font-bold tracking-tight text-ink leading-tight">{title}</h2>
          {description && <p className="mt-2 text-ink/60 max-w-2xl leading-relaxed">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap gap-2 shrink-0">{actions}</div>}
      </div>
    </div>
  );
}
