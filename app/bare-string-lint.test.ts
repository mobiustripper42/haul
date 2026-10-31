// AC7 and AC8: the bare-string rule, run through the repo's own eslint.config.mjs. `lintText`
// matches `filePath` against the config without the file existing.
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const eslint = new ESLint({ cwd: fileURLToPath(new URL("..", import.meta.url)) });

// Each snippet is a whole module: `t` and `name` are declared and exported, so no other rule
// (no-undef, no-unused-vars) has anything to say.
const source = (jsx: string): string =>
  [
    "export const t = (key: string): string => key;",
    "export const name = t(\"who\");",
    "export function View() {",
    `  return (${jsx});`,
    "}",
    "",
  ].join("\n");

async function lint(jsx: string, filePath: string): Promise<ESLint.LintResult> {
  const [result] = await eslint.lintText(source(jsx), { filePath });
  if (!result) throw new Error("lintText returned no result");
  return result;
}

const bareStringErrors = (result: ESLint.LintResult) =>
  result.messages.filter((m) => m.severity === 2 && m.message.includes("src/messages/"));

const describeMessages = (result: ESLint.LintResult): string =>
  JSON.stringify(result.messages.map((m) => ({ rule: m.ruleId, message: m.message })));

// Every AC7 case. AC8 re-runs all of them under test file names, where they must pass.
const failing: Array<[string, string]> = [
  ["JSX text", "<p>Hi</p>"],
  ["JSX text beside an expression", "<p>Hello {name}</p>"],
  ["JSX text with surrounding whitespace", "<p>\n  Hi\n</p>"],
  ["a string literal child", '<p>{"Hi"}</p>'],
  ["a string literal child with surrounding whitespace", '<p>{" Hi "}</p>'],
  ["a template literal child", "<p>{`Hi`}</p>"],
  ["a template literal child with text outside ${…}", "<p>{`Hi ${name}`}</p>"],
  ["JSX text in a fragment", "<>Hi</>"],
  ["a string literal child of a fragment", '<>{"Hi"}</>'],
  ["a template literal child of a fragment", "<>{`Hi`}</>"],
  ["a bare alt", '<img alt="A crate of kale" />'],
  ["alt in braces", '<img alt={"A crate of kale"} />'],
  ["alt as a template literal", "<img alt={`A crate of kale`} />"],
  ["a bare title", '<div title="Hi" />'],
  ["title in braces", '<div title={"Hi"} />'],
  ["title as a template literal", "<div title={`Hi`} />"],
  ["a bare placeholder", '<input placeholder="Email" />'],
  ["placeholder in braces", '<input placeholder={"Email"} />'],
  ["placeholder as a template literal", "<input placeholder={`Email`} />"],
  ["a bare aria-label", '<button aria-label="Close" />'],
  ["aria-label in braces", '<button aria-label={"Close"} />'],
  ["aria-label as a template literal with text outside ${…}", "<button aria-label={`Close ${name}`} />"],
  ["title on a component", '<View title="Hi" />'],
];

describe("AC7 — lint fails on a bare string in a .tsx file", () => {
  describe.each(["app/x.tsx", "components/x.tsx"])("in %s", (filePath) => {
    it.each(failing)("AC7: fails on %s, naming src/messages/", async (_what, jsx) => {
      const result = await lint(jsx, filePath);
      expect(result.fatalErrorCount, describeMessages(result)).toBe(0);
      expect(bareStringErrors(result), describeMessages(result)).not.toHaveLength(0);
    });
  });

  it.each([
    ["a template literal child holding only ${…}", "<p>{`${name}`}</p>"],
    ["a template literal child holding only whitespace and ${…}", "<p>{` ${name} `}</p>"],
    ["a template literal alt holding only ${…}", "<img alt={`${name}`} />"],
  ])("AC7: does not fail on %s — only text outside ${…} counts", async (_what, jsx) => {
    const result = await lint(jsx, "app/x.tsx");
    expect(result.fatalErrorCount, describeMessages(result)).toBe(0);
    expect(bareStringErrors(result), describeMessages(result)).toHaveLength(0);
  });
});

describe("AC8 — lint passes on translated, whitespace-only and non-text strings", () => {
  const passing: Array<[string, string]> = [
    ["t() as a child", '<p>{t("home.title")}</p>'],
    ["t() as a fragment child", '<>{t("home.title")}</>'],
    ["t() as alt", '<img alt={t("home.title")} />'],
    ["t() as title", '<div title={t("home.title")} />'],
    ["t() as placeholder", '<input placeholder={t("home.title")} />'],
    ["t() as aria-label", '<button className="btn-quiet" aria-label={t("home.title")} />'],
    ["whitespace-only JSX text", '<main>\n    <p>{t("a")}</p>\n    <p>{t("b")}</p>\n  </main>'],
    ["whitespace-only JSX text on one line", "<p> </p>"],
    ['{" "} as a child', '<p>{t("a")}{" "}{t("b")}</p>'],
    ['{""} as a child', '<p>{""}</p>'],
    ["a whitespace-only string literal child", '<p>{"  \\n "}</p>'],
    ["an empty template literal child", "<p>{``}</p>"],
    ["a whitespace-only template literal child", "<p>{`  `}</p>"],
    ['{" "} in a fragment', '<>{" "}</>'],
    ['alt=""', '<img alt="" />'],
    ['alt={""}', '<img alt={""} />'],
    ["a whitespace-only bare title", '<div title=" " />'],
    ["a whitespace-only title in braces", '<div title={" "} />'],
    ["an empty placeholder", '<input placeholder="" />'],
    ["an empty template literal placeholder", "<input placeholder={``} />"],
    ["a whitespace-only template literal aria-label", '<button className="btn-quiet" aria-label={` `} />'],
    ['an empty aria-label in braces', '<button className="btn-quiet" aria-label={""} />'],
    ["className", '<div className="stack" />'],
    ["lang", '<html lang="es" />'],
    ["type", '<button className="btn-quiet" type="submit" />'],
    ["name", '<button className="btn-quiet" name="language" />'],
    ["value", '<button className="btn-quiet" value="es" />'],
    ["href", '<a href="/account" />'],
    ["every other attribute together, in braces", '<input className={"x"} type={"text"} name={"q"} value={`v`} />'],
  ];

  it.each(passing)("AC8: passes on %s", async (_what, jsx) => {
    const result = await lint(jsx, "app/x.tsx");
    expect(result.fatalErrorCount, describeMessages(result)).toBe(0);
    expect(result.errorCount, describeMessages(result)).toBe(0);
  });

  it.each(passing)("AC8: passes on %s in components/x.tsx", async (_what, jsx) => {
    const result = await lint(jsx, "components/x.tsx");
    expect(result.fatalErrorCount, describeMessages(result)).toBe(0);
    expect(result.errorCount, describeMessages(result)).toBe(0);
  });

  describe.each(["app/x.test.tsx", "e2e/x.spec.tsx"])("tests are not translated: %s", (filePath) => {
    it.each(failing)("AC8: passes on %s", async (_what, jsx) => {
      const result = await lint(jsx, filePath);
      expect(result.fatalErrorCount, describeMessages(result)).toBe(0);
      expect(result.errorCount, describeMessages(result)).toBe(0);
    });
  });
});
