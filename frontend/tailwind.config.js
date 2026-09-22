/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'brand-white': '#F8FAFC',
        'brand-black': '#121e27', // Leggermente più scuro per il background assoluto
        'brand-blue': '#a9daff', // Nuovo colore accento
        'brand-blue-dark': '#8ac3ed', // Hover per il nuovo accento
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
          900: '#192935', // Il colore richiesto come base per card e pannelli
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
