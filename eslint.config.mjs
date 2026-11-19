import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

const __dirname = dirname(fileURLToPath(import.meta.url));
const compat = new FlatCompat({ baseDirectory: __dirname });

const config = [
  { ignores: ["**/node_modules/**", "**/.next/**", "**/dist/**", "**/next-env.d.ts", "deploy/**"] },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  // Absolute, so `next build` (which lints from inside each app) finds them as well as `eslint .` at the root.
  { settings: { next: { rootDir: [join(__dirname, "apps/node"), join(__dirname, "apps/verifier")] } } },
];

export default config;
