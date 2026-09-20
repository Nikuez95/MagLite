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
        'brand-black': '#0F172A',
        'brand-blue': '#0EA5E9', // Celeste/Light Blue (Sky-500)
        'brand-blue-dark': '#0284C7', // Sky-600 per hover
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
