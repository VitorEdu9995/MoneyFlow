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
        superficie: '#FFFFFF',
        texto: '#20313D',
        textoSecundario: '#5D6B75',
        atencao: '#D99019',
        erro: '#B74747',
      },
      fontFamily: {
        sans: ['Inter', 'Manrope', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
