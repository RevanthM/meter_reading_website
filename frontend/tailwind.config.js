/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'dark': {
          900: '#0D1117',
          800: '#161B22',
          700: '#21262D',
          600: '#30363D',
          500: '#484F58',
        },
        'accent': {
          blue: '#58A6FF',
          green: '#3FB950',
          yellow: '#D29922',
          red: '#F85149',
          purple: '#A371F7',
        }
      }
    },
  },
  plugins: [],
}
