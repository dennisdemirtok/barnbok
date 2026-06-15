'use client';

interface Props {
  name: string;
  className?: string;
  filled?: boolean;
  size?: number;
}

// Enhetlig ikon via Material Symbols Rounded (laddas i layout.tsx)
export default function Icon({ name, className = '', filled = false, size }: Props) {
  return (
    <span
      className={`material-symbols-rounded select-none leading-none ${className}`}
      style={{
        fontSize: size ? `${size}px` : undefined,
        fontVariationSettings: `'FILL' ${filled ? 1 : 0}, 'wght' 500, 'GRAD' 0, 'opsz' 24`,
      }}
      aria-hidden="true"
    >
      {name}
    </span>
  );
}
