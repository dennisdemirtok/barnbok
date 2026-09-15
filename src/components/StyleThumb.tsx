'use client';

import { getStylePreset } from '@/lib/styles';
import Icon from './Icon';

interface Props {
  styleId: string;
  // Sidlängd i px
  size?: number;
  selected?: boolean;
  className?: string;
}

// Stilens ikon: en liten exempelbild med samma motiv i varje stil (public/styles),
// med färgmarkeringen som reserv om bilden saknas
export default function StyleThumb({ styleId, size = 40, selected = false, className = '' }: Props) {
  const preset = getStylePreset(styleId);
  return (
    <span
      className={`relative shrink-0 overflow-hidden bg-gradient-to-br ${preset?.swatch ?? 'from-ink/20 to-ink/40'} ${className}`}
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.28) }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/styles/${styleId}.jpg`}
        alt=""
        loading="lazy"
        className="absolute inset-0 w-full h-full object-cover"
        onError={e => { e.currentTarget.style.display = 'none'; }}
      />
      {selected && (
        <span className="absolute inset-0 bg-ink/35 flex items-center justify-center text-white">
          <Icon name="check" size={Math.max(14, Math.round(size * 0.45))} />
        </span>
      )}
    </span>
  );
}
