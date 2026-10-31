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

// The UI rules (DEC-020): every class string, written as a literal or as a template literal, is held
// to app/globals.css's tokens and button kinds. Both node types are matched, because half of any
// conditional styling is a template literal and a `Literal`-only selector would miss it. Each regex
// reads a token: a run between whitespace, optional variants (`hover:`, `md:focus:`), then the utility.
const inClassString = (regex, message) => [
  { selector: `Literal[value=/${regex}/]`, message },
  { selector: `TemplateElement[value.cooked=/${regex}/]`, message },
];

// Ratios are the token as text on `surface`. `disabled:` is exempt, as WCAG 1.4.3 exempts an inactive
// control: the lookahead refuses any token carrying that variant.
const LOW_CONTRAST = { sage: "1.51", divider: "1.51", gold: "2.09", "gold-hover": "1.75", border: "3.18" };
const contrastSelectors = Object.entries(LOW_CONTRAST).flatMap(([token, ratio]) =>
  inClassString(
    `(?:^|\\s)(?![^\\s]*disabled:)(?:[^\\s:]+:)*!?text-${token}(?![\\w-])`,
    `text-${token} is ${ratio}:1 as text on surface, under the 4.5:1 text needs (DEC-020). Use ink, ink-muted, teal or teal-muted; ${token} is for fills, borders and rules. Only disabled:text-${token} is allowed.`,
  ),
);

const OPT_OUT = "an eslint-disable-next-line no-restricted-syntax comment with a reason";
// Raw values are read only inside a `className` value, so a pattern, a name or a translation key that
// happens to look like `p-[13px]` stays clean. A class string is a literal or a template literal
// anywhere under that attribute (a conditional's branch, a helper's argument).
const rawValueMessage = `An arbitrary value or property in a class string (p-[13px], bg-[#fbeeec], [color:#fff]) is off the tokens in app/globals.css (DEC-020). Use a token utility; for a genuine exception, add ${OPT_OUT}.`;
const RAW_VALUE = "(?:^|\\s)(?:[^\\s\\[]*-\\[[^\\s\\]]*\\]|(?:[^\\s:]+:)*!?\\[[a-z-]+:[^\\s\\]]+\\])";
const rawValueSelectors = [
  { selector: `JSXAttribute[name.name='className'] Literal[value=/${RAW_VALUE}/]`, message: rawValueMessage },
  { selector: `JSXAttribute[name.name='className'] TemplateElement[value.cooked=/${RAW_VALUE}/]`, message: rawValueMessage },
  {
    selector: "JSXAttribute[name.name='style']",
    message: `A style prop is off the tokens in app/globals.css (DEC-020). Use class names; for a genuine exception, add ${OPT_OUT}.`,
  },
];

const goldFillSelectors = inClassString(
  "(?:^|\\s)(?:[^\\s:]+:)*bg-gold(?:-hover)?(?![\\w-])",
  "The gold fill belongs to btn-primary alone, defined in app/globals.css (DEC-020). Name btn-primary instead of writing bg-gold or bg-gold-hover.",
);

// A <button> names its kind. A class passed through a variable, a member or a call cannot be read
// here, so it is refused: write the kind at the call site.
const BUTTON = "JSXOpeningElement[name.name='button']";
const BUTTON_KIND = "(?<![\\w-])btn-(primary|secondary|quiet)(?![\\w-])";
const buttonKindMessage =
  "A <button> names its kind in a literal className: btn-primary, btn-secondary or btn-quiet, defined in app/globals.css (DEC-020). Keep layout utilities (w-full) beside it.";
const buttonClass = `${BUTTON} > JSXAttribute[name.name='className']`;
const buttonKindSelectors = [
  `${buttonClass} > Literal:not([value=/${BUTTON_KIND}/])`,
  `${buttonClass} > JSXExpressionContainer > Literal:not([value=/${BUTTON_KIND}/])`,
  `${buttonClass} > JSXExpressionContainer > TemplateLiteral:not(:has(TemplateElement[value.raw=/${BUTTON_KIND}/]))`,
  `${buttonClass} > JSXExpressionContainer > ConditionalExpression > Literal:not([value=/${BUTTON_KIND}/])`,
  `${buttonClass} > JSXExpressionContainer > ConditionalExpression:not([consequent.type='Literal'])`,
  `${buttonClass} > JSXExpressionContainer > ConditionalExpression:not([alternate.type='Literal'])`,
  `${buttonClass} > JSXExpressionContainer > :matches(Identifier, MemberExpression, CallExpression)`,
  `${BUTTON}:not(:has(JSXAttribute[name.name='className']))`,
].map((selector) => ({ selector, message: buttonKindMessage }));

const uiSelectors = [...contrastSelectors, ...rawValueSelectors, ...goldFillSelectors, ...buttonKindSelectors];

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
    rules: { "no-restricted-syntax": ["error", ...bareStringSelectors, ...uiSelectors] },
  },
);
