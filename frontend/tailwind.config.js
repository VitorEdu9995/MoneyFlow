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
        azulProfundo: '#123047',
        verdeEquilibrio: '#138A63',
        verdeEquilibrioDark: '#0E6B4C',
        mentaClara: '#BFEBDD',
        nevoa: '#F5F8FA',
        superficie: '#FFFFFF',
        superficieSecundaria: '#F8FAFC',
        borda: '#E2E8F0',
        bordaHover: '#CBD5E1',
        texto: '#20313D',
        textoSecundario: '#5D6B75',
        textoMudo: '#8C9BA5',
        atencao: '#D99019',
        erro: '#B74747',
      },
      fontFamily: {
        sans: ['Inter', 'Manrope', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        suave: '0 1px 3px 0 rgba(18, 48, 71, 0.05), 0 1px 2px 0 rgba(18, 48, 71, 0.03)',
        card: '0 4px 6px -1px rgba(18, 48, 71, 0.05), 0 2px 4px -1px rgba(18, 48, 71, 0.03)',
        modal: '0 20px 25px -5px rgba(18, 48, 71, 0.15), 0 10px 10px -5px rgba(18, 48, 71, 0.08)',
      },
    },
  },
  plugins: [],
}
