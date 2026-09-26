/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        azulFluxo: '#123047',
        verdeEquilibrio: '#138A63',
        mentaClara: '#BFEBDD',
        nevo: '#F5F8FA',
        superficie: '#1E1E1E', // Dark mode background
        texto: '#FFFFFF', // Light text for dark mode
        textoSecundario: '#A0AAB2',
        atencao: '#D99019',
        erro: '#B74747',
        background: '#121212',
      },
      fontFamily: {
        sans: ['Inter', 'Manrope', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
