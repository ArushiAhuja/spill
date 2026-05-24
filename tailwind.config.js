module.exports = {
  content: ['./src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#0d0f1a',
        surface: '#13161f',
        'surface-2': '#191d2b',
        'surface-3': '#1e2338',
        border: '#1e2535',
        'border-2': '#243047',
        text: '#e2e8f0',
        muted: '#64748b',
        faint: '#334155',
        accent: '#3b82f6',
        'accent-dim': 'rgba(59,130,246,0.12)',
        purple: '#9b8ff7',
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'monospace'],
      },
      borderRadius: {
        xl: '10px',
        '2xl': '14px',
      },
      animation: {
        drift: 'drift var(--duration, 12s) var(--delay, 0s) linear infinite',
        'fade-up': 'fadeUp 0.9s cubic-bezier(0.4,0,0.2,1) both',
        'fade-in': 'fadeIn 0.6s ease both',
        'pulse-dot': 'pulseDot 2s ease-in-out infinite',
        'slide-in': 'slideIn 0.2s ease both',
        blink: 'blink 1s step-end infinite',
        skeleton: 'skeleton 1.5s ease-in-out infinite',
      },
      keyframes: {
        drift: {
          '0%': { transform: 'translateY(110vh)', opacity: '0' },
          '10%': { opacity: '1' },
          '90%': { opacity: '0.6' },
          '100%': { transform: 'translateY(-10vh)', opacity: '0' },
        },
        fadeUp: {
          from: { opacity: '0', transform: 'translateY(12px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        fadeIn: {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        pulseDot: {
          '0%,100%': { opacity: '1', transform: 'scale(1)' },
          '50%': { opacity: '0.4', transform: 'scale(0.75)' },
        },
        slideIn: {
          from: { opacity: '0', transform: 'translateX(-6px)' },
          to: { opacity: '1', transform: 'translateX(0)' },
        },
        blink: {
          '0%,100%': { opacity: '1' },
          '50%': { opacity: '0' },
        },
        skeleton: {
          '0%': { backgroundPosition: '200% 0' },
          '100%': { backgroundPosition: '-200% 0' },
        },
      },
    },
  },
  plugins: [],
}
