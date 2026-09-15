import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
    // Stilarnas färgmarkeringar (gradientklasser) definieras i lib/styles.ts
    './src/lib/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        heading: ['var(--font-heading)', 'Georgia', 'serif'],
        sans: ['var(--font-body)', 'Be Vietnam Pro', 'sans-serif'],
      },
      colors: {
        // Redaktionell palett: bläck på varmt papper med en djup violett accent
        ink: '#1f1b16',
        paper: '#f7f4ef',
        line: '#e7e1d8',
        brand: {
          DEFAULT: '#5b3fd9',
          dark: '#4a31bd',
          deep: '#3b2799',
        },
        // Äldre accentnamn behålls men tonas ner mot paletten
        magic: '#7a5cf0',
        trust: '#3f5bd9',
        sunset: '#e0704a',
      },
      borderRadius: {
        '4xl': '2rem',
      },
      boxShadow: {
        soft: '0 1px 2px rgba(31, 27, 22, 0.04), 0 4px 14px -6px rgba(31, 27, 22, 0.08)',
        lift: '0 2px 4px rgba(31, 27, 22, 0.04), 0 18px 40px -16px rgba(31, 27, 22, 0.22)',
        // Äldre namn pekar på de neutrala skuggorna
        glow: '0 1px 2px rgba(31, 27, 22, 0.04), 0 4px 14px -6px rgba(31, 27, 22, 0.08)',
        'glow-lg': '0 2px 4px rgba(31, 27, 22, 0.04), 0 18px 40px -16px rgba(31, 27, 22, 0.22)',
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
          '100%': { opacity: '1', transform: 'none' },
        },
        pop: {
          '0%': { opacity: '0', transform: 'scale(0.92)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
      },
      animation: {
        shimmer: 'shimmer 2.5s ease-in-out infinite',
        float: 'float 6s ease-in-out infinite',
        // `backwards` (inte `both`): en kvarhängande transform efter animationen skapar
        // ett nytt containing block och klämmer in position:fixed-modaler i innehållsytan
        'fade-up': 'fade-up 0.45s cubic-bezier(0.22, 1, 0.36, 1) backwards',
        pop: 'pop 0.3s cubic-bezier(0.22, 1, 0.36, 1) both',
      },
    },
  },
  plugins: [],
}
export default config
