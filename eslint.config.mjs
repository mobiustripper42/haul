import js from "@eslint/js";
import tseslint from "typescript-eslint";

// In flat config a later block's options for one rule replace an earlier block's, so for each
// rule a file matches exactly one block below, and that block lists everything the rule needs.
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

// A pattern refusing every import in src/sign-in/ except the ones `regex`'s negative lookahead lets by.
const signInBoundary = (regex) => ({
  regex,
  message: "src/sign-in/ may import only its own files and node: built-ins, so a shared library can replace it.",
});

// A bare string in a component fails the gate: every UI string lives in src/messages/ (DEC-015).
// Only a literal holding a non-whitespace character counts, so {" "} and alt="" pass. What the
// selectors cannot see (metadata, variables, ternaries inside JSX) is an accepted gap.
const IN_CHILDREN = ":matches(JSXElement, JSXFragment) > JSXExpressionContainer";
const IN_ATTRIBUTE = "JSXAttribute[name.name=/^(alt|title|placeholder|aria-label)$/]";
const BARE_STRING = "Literal[value=/\\S/][raw=/^[\"']/]";
const BARE_TEMPLATE_TEXT = "TemplateLiteral > TemplateElement[value.cooked=/\\S/]";
const bareStringMessage = 'Bare string in a component: put it in src/messages/ and render t("key") (DEC-015).';
const bareStringSelectors = [
  "JSXText[value=/\\S/]",
  `${IN_CHILDREN} > ${BARE_STRING}`,
  `${IN_CHILDREN} > ${BARE_TEMPLATE_TEXT}`,
  `${IN_ATTRIBUTE} > ${BARE_STRING}`,
  `${IN_ATTRIBUTE} > JSXExpressionContainer > ${BARE_STRING}`,
  `${IN_ATTRIBUTE} > JSXExpressionContainer > ${BARE_TEMPLATE_TEXT}`,
].map((selector) => ({ selector, message: bareStringMessage }));

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
    // src/sign-in/ is built to be lifted into a shared library: it may import only its own files and
    // node: built-ins. Anything else of haul's (members, i18n, a port, pg) would travel with it.
    files: ["src/sign-in/**"],
    rules: { "no-restricted-imports": ["error", { patterns: [signInBoundary("^(?!\\./|node:)")] }] },
  },
  {
    // The store contract and the folder's tests also use vitest.
    files: ["src/sign-in/store-contract.ts", "src/sign-in/**/*.test.ts"],
    rules: { "no-restricted-imports": ["error", { patterns: [signInBoundary("^(?!\\./|node:|vitest$)")] }] },
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
  {
    files: ["**/*.tsx"],
    ignores: ["**/*.test.tsx", "**/*.spec.tsx"],
    rules: { "no-restricted-syntax": ["error", ...bareStringSelectors] },
  },
);
