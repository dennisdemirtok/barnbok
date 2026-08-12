import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        heading: ['var(--font-heading)', 'Quicksand', 'sans-serif'],
        sans: ['var(--font-body)', 'Be Vietnam Pro', 'sans-serif'],
      },
      colors: {
        // Stitch "Lumina Creative Studio"-palett
        brand: {
          DEFAULT: '#7C3AED', // magisk lila
          dark: '#630ED4',
          deep: '#5a00c6',
        },
        magic: '#D946EF',   // magisk rosa
        trust: '#2563EB',   // tillitsfull blå
        sunset: '#FB923C',  // handlingsaccent
      },
      borderRadius: {
        '4xl': '2rem',
      },
      boxShadow: {
        glow: '0 8px 30px rgba(124, 58, 237, 0.18)',
        'glow-lg': '0 12px 45px rgba(124, 58, 237, 0.25)',
      },
      keyframes: {
        shimmer: {
          '0%, 100%': { opacity: '0.7' },
          '50%': { opacity: '1' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-6px)' },
        },
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(14px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        pop: {
          '0%': { opacity: '0', transform: 'scale(0.92)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
      },
      animation: {
        shimmer: 'shimmer 2.5s ease-in-out infinite',
        float: 'float 6s ease-in-out infinite',
        'fade-up': 'fade-up 0.45s cubic-bezier(0.22, 1, 0.36, 1) both',
        pop: 'pop 0.3s cubic-bezier(0.22, 1, 0.36, 1) both',
      },
    },
  },
  plugins: [],
}
export default config
