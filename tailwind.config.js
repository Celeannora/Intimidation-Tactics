/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: "#4f98a3",
      },
      fontFamily: {
        body: ["Inter", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
