/**
 * PostCSS. Tailwind CSS v4 ships its own PostCSS plugin package
 * (@tailwindcss/postcss) and handles vendor prefixing internally, so the
 * separate `tailwindcss` and `autoprefixer` plugin entries used by v3 are gone.
 */
module.exports = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};
