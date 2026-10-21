/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          dark: '#004A77',
          light: '#C2E7FF',
          accent: '#0077B6',
          glow: '#0096C7',
        },
        surface: {
          900: '#0A0F19',
          800: '#0D1520',
          700: '#111B2C',
          600: '#162236',
          500: '#1C2A42',
          400: '#243350',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      animation: {
        'fade-in': 'fadeIn 0.2s ease-out',
        'slide-up': 'slideUp 0.25s ease-out',
        'pulse-glow': 'pulseGlow 2s ease-in-out infinite',
        'spin-slow': 'spin 1.5s linear infinite',
        'heartbeat': 'heartbeat 2.2s ease-in-out infinite',
      },
      keyframes: {
        fadeIn: {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        slideUp: {
          from: { opacity: '0', transform: 'translateY(12px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        pulseGlow: {
          '0%, 100%': { boxShadow: '0 0 8px rgba(0, 150, 199, 0.3)' },
          '50%': { boxShadow: '0 0 20px rgba(0, 150, 199, 0.7)' },
        },
        heartbeat: {
          '0%, 100%': {
            transform: 'scale(1)',
            filter: 'drop-shadow(0 0 10px rgba(0, 150, 199, 0.25))',
          },
          '14%': {
            transform: 'scale(1.07)',
            filter: 'drop-shadow(0 0 28px rgba(0, 180, 240, 0.75))',
          },
          '28%': {
            transform: 'scale(1)',
            filter: 'drop-shadow(0 0 12px rgba(0, 150, 199, 0.3))',
          },
          '42%': {
            transform: 'scale(1.04)',
            filter: 'drop-shadow(0 0 22px rgba(0, 180, 240, 0.55))',
          },
          '70%': {
            transform: 'scale(1)',
            filter: 'drop-shadow(0 0 10px rgba(0, 150, 199, 0.25))',
          },
        },
      },
      backdropBlur: {
        xs: '2px',
      },
    },
  },
  plugins: [],
}
