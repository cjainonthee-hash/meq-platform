/**
 * ESLint (flat config).
 *
 * Next.js 16 removed the `next lint` command, so linting now runs ESLint
 * directly: `npm run lint`.
 *
 * eslint-config-next 16 ships native flat configs, so they are imported
 * directly. Do not wrap them in FlatCompat, which is for the older "extends"
 * format and throws a circular-structure error on these.
 *
 * NOTE ON THE TYPESCRIPT VERSION
 *   TypeScript is deliberately pinned to 6.x, not the newer 7.x. The
 *   typescript-eslint toolchain behind `next/typescript` supports only
 *   `typescript < 6.1`, so upgrading to TypeScript 7 silently costs every lint
 *   rule on .ts/.tsx files. TS 6 and TS 7 type-check identically, 7 is just a
 *   faster compiler. Revisit once typescript-eslint supports 7.
 */

import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

const config = [
  {
    ignores: [".next/**", "node_modules/**", "next-env.d.ts", "public/**"],
  },
  ...coreWebVitals,
  ...typescript,
];

export default config;
