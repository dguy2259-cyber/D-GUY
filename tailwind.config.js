/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      colors: {
        ivory: '#F7F3EB',
        porcelain: '#FFFCF6',
        cream: '#EDE5D8',
        peach: '#E8B8A5',
        terracotta: {
          DEFAULT: '#B86F5B',
          deep: '#945441',
        },
        slate: '#8296AD',
        charcoal: '#302B29',
        muted: '#827A73',
        stone: '#6B635C',
      },
      borderRadius: {
        clay: '18px',
        'clay-lg': '24px',
      },
      boxShadow: {
        clay: '0 1px 2px rgba(48,43,41,0.05), 0 10px 24px -10px rgba(48,43,41,0.18), inset 0 1px 0 rgba(255,255,255,0.9)',
        'clay-lg': '0 2px 4px rgba(48,43,41,0.05), 0 24px 48px -18px rgba(48,43,41,0.22), inset 0 2px 0 rgba(255,255,255,0.85), inset 0 -4px 8px rgba(148,84,65,0.05)',
        'clay-inset': 'inset 0 2px 5px rgba(48,43,41,0.09), inset 0 -1px 0 rgba(255,255,255,0.7)',
        'clay-button': '0 4px 0 rgba(148,84,65,0.45), 0 12px 20px -10px rgba(148,84,65,0.55), inset 0 1px 0 rgba(255,255,255,0.28)',
        'clay-button-pressed': '0 1px 0 rgba(148,84,65,0.45), 0 4px 8px -4px rgba(148,84,65,0.4), inset 0 2px 4px rgba(89,50,38,0.25)',
        'clay-soft-button': '0 3px 0 rgba(48,43,41,0.08), 0 8px 16px -10px rgba(48,43,41,0.3), inset 0 1px 0 rgba(255,255,255,0.95)',
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'pulse-dot': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.35' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },
      animation: {
        'fade-up': 'fade-up 320ms ease-out both',
        'pulse-dot': 'pulse-dot 1.4s ease-in-out infinite',
        shimmer: 'shimmer 1.8s linear infinite',
      },
    },
  },
  plugins: [],
};
