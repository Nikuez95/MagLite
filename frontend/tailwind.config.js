/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  safelist: [
    { pattern: /^(bg|text|border)-(brand|slate|rose|amber|emerald|sky|green|purple|fuchsia)-[0-9]{2,3}(\/[0-9]{1,2})?$/, variants: ['hover'] },
    'md:flex', 'md:hidden', 'md:grid', 'md:grid-cols-2', 'md:w-72', 'md:whitespace-normal', 'md:sticky', 'md:h-screen', 'md:bg-slate-900/50', 'md:p-8', 'md:flex-row'
  ],
  theme: {
    extend: {
      colors: {
        'brand-white': 'rgb(var(--color-brand-white) / <alpha-value>)',
        'brand-black': 'rgb(var(--color-brand-black) / <alpha-value>)',
        'brand-blue': 'rgb(var(--color-brand-blue) / <alpha-value>)',
        'brand-blue-dark': 'rgb(var(--color-brand-blue-dark) / <alpha-value>)',
        slate: {
          50: 'rgb(var(--color-slate-50) / <alpha-value>)',
          100: 'rgb(var(--color-slate-100) / <alpha-value>)',
          200: 'rgb(var(--color-slate-200) / <alpha-value>)',
          300: 'rgb(var(--color-slate-300) / <alpha-value>)',
          400: 'rgb(var(--color-slate-400) / <alpha-value>)',
          500: 'rgb(var(--color-slate-500) / <alpha-value>)',
          600: 'rgb(var(--color-slate-600) / <alpha-value>)',
          700: 'rgb(var(--color-slate-700) / <alpha-value>)',
          800: 'rgb(var(--color-slate-800) / <alpha-value>)',
          900: 'rgb(var(--color-slate-900) / <alpha-value>)',
          950: 'rgb(var(--color-slate-950) / <alpha-value>)',
        }
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
