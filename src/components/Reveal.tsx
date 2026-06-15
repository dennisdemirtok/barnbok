'use client';

import { useEffect, useRef, useState, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  className?: string;
  delay?: number; // ms
  as?: 'div' | 'section';
}

// Tonar in barnet mjukt när det scrollas in i vyn
export default function Reveal({ children, className = '', delay = 0, as = 'div' }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          obs.disconnect();
        }
      },
      { threshold: 0.12 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const Tag = as;
  return (
    <Tag
      ref={ref as React.RefObject<HTMLDivElement> & React.RefObject<HTMLElement>}
      className={`reveal ${visible ? 'is-visible' : ''} ${className}`}
      style={{ transitionDelay: visible ? `${delay}ms` : '0ms' }}
    >
      {children}
    </Tag>
  );
}
