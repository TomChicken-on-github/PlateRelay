/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{vue,js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        naive: {
          green: '#18a058',
          greenHover: '#36ad6a',
          greenPressed: '#0c7a43',
          card: '#161b22',
          border: '#30363d',
          borderHover: '#484f58',
        }
      }
    },
  },
  plugins: [],
}
