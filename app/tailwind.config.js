/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: 'rgb(var(--color-ink) / <alpha-value>)',
          soft: 'rgb(var(--color-ink-soft) / <alpha-value>)',
        },
        canvas: 'rgb(var(--color-canvas) / <alpha-value>)',
        surface: {
          DEFAULT: 'rgb(var(--color-surface) / <alpha-value>)',
          bright: 'rgb(var(--color-surface-bright) / <alpha-value>)',
        },
        line: 'rgb(var(--color-line) / <alpha-value>)',
        muted: 'rgb(var(--color-muted) / <alpha-value>)',
        accent: {
          DEFAULT: 'rgb(var(--color-accent) / <alpha-value>)',
          strong: 'rgb(var(--color-accent-strong) / <alpha-value>)',
          dark: 'rgb(var(--color-accent-dark) / <alpha-value>)',
          ink: 'rgb(var(--color-accent-ink) / <alpha-value>)',
        },
        coral: 'rgb(var(--color-coral) / <alpha-value>)',
        success: 'rgb(var(--color-success) / <alpha-value>)',
        warning: 'rgb(var(--color-warning) / <alpha-value>)',
        danger: 'rgb(var(--color-danger) / <alpha-value>)',
      },
      fontFamily: {
        display: ['Racing Sans One', 'Arial', 'sans-serif'],
        body: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        md: '0.75rem',
        lg: '1rem',
        xl: '1.25rem',
      },
      boxShadow: {
        panel: '0 1px 2px rgb(var(--color-ink) / 0.04), 0 8px 24px rgb(var(--color-ink) / 0.06)',
        lift: '0 12px 28px rgb(var(--color-ink) / 0.12)',
        accent: '0 0 0 3px rgb(var(--color-accent) / 0.18)',
      },
      transitionTimingFunction: {
        spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
      },
      keyframes: {
        // Rank numerals "rewrite" when the list reorders: fade + rise back in.
        'rank-pop': {
          '0%': { opacity: '0.15', transform: 'translateY(3px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'rank-pop': 'rank-pop 240ms ease-out',
      },
    },
  },
  plugins: [],
}
