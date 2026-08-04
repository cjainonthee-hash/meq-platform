import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        // Matched to the Faculty of Veterinary Medicine (CMU) logo blues.
        brand: {
          DEFAULT: "#1c66a0",
          dark: "#114e7b",
          light: "#e7f1f9",
        },
      },
    },
  },
  plugins: [],
};

export default config;
