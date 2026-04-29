/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'amber-team': '#f39c12',
        'sapphire-team': '#3498db',
      },
    },
  },
  plugins: [
    require('tailwindcss-text-fill-stroke'),
  ],
}
