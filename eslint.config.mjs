import js from "@eslint/js";
import tseslint from "typescript-eslint";

// In flat config a later block's options for one rule replace an earlier block's, so each file
// matches exactly one block below and every block lists everything that applies to it.
const frameworkPatterns = [
  {
    group: ["next", "next/*", "react", "react/*", "react-dom", "react-dom/*"],
    message: "The core under src/ is framework-free (DEC-001).",
  },
  {
    // Relative paths only, so a package whose name ends in /app (firebase/app) is not
    // caught. A dynamic import() is not caught either; that gap is accepted.
    group: ["./**/app", "./**/app/*", "../**/app", "../**/app/*", "@/app", "@/app/*"],
    message: "The core under src/ may not import the app (DEC-001).",
  },
];

// Only src/adapters/pg-connect.ts may import pg: it applies TLS to every connection (DEC-001).
// Type-only imports are banned too; pg-connect.ts re-exports any types callers need.
const pgPatterns = [
  {
    group: ["pg", "pg/**", "pg-pool", "pg-pool/**", "pg-connection-string", "pg-connection-string/**"],
    message: "Only src/adapters/pg-connect.ts may import pg: it applies TLS to every connection (DEC-001).",
  },
];

export default tseslint.config(
  { ignores: [".next/**", "node_modules/**", "next-env.d.ts"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: { globals: { console: "readonly", process: "readonly", URL: "readonly" } },
  },
  {
    // The core is framework-free (DEC-001): nothing under src/ may reach Next, React or the app.
    files: ["src/**"],
    ignores: ["src/adapters/pg-connect.ts"],
    rules: { "no-restricted-imports": ["error", { patterns: [...frameworkPatterns, ...pgPatterns] }] },
  },
  {
    files: ["src/adapters/pg-connect.ts"],
    rules: { "no-restricted-imports": ["error", { patterns: frameworkPatterns }] },
  },
  {
    files: ["**/*.{ts,tsx,mts,js,mjs,cjs}"],
    ignores: ["src/**"],
    rules: { "no-restricted-imports": ["error", { patterns: pgPatterns }] },
  },
);
