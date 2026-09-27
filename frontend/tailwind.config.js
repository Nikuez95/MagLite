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
        'brand-white': '#F8FAFC',
        'brand-black': '#121e27', 
        'brand-blue': '#a9daff', 
        'brand-blue-dark': '#8ac3ed',
        slate: {
          50: '#f3f9fe',
          100: '#e2f1fc',
          200: '#c2def2',
          300: '#9cc1df',
          400: '#76a0bf',
          500: '#59809c',
          600: '#42637b',
          700: '#304a5e',
          800: '#233746',
          900: '#192935', 
          950: '#101c25',
        }
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
