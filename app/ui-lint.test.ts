// Issue 19, AC11–AC17: the UI rules in eslint.config.mjs's one `**/*.tsx` no-restricted-syntax block,
// run through the repo's own config with `lintText`, as app/bare-string-lint.test.ts runs DEC-015's.
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryRepository } from "@core/adapters/in-memory-repository.js";
import { signSession } from "@core/sign-in/session.js";
import { emptyRequest } from "./next-headers-fake";
import Home from "./page";
import { attributesOf, escapeRegExp, screenMarkup } from "./screen-test-helpers";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const eslint = new ESLint({ cwd: ROOT, errorOnUnmatchedPattern: false });

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

async function lint(jsx: string, filePath = "app/x.tsx"): Promise<ESLint.LintResult> {
  const [result] = await eslint.lintText(source(jsx), { filePath });
  if (!result) throw new Error("lintText returned no result");
  return result;
}

const describeMessages = (result: ESLint.LintResult): string =>
  JSON.stringify(result.messages.map((m) => ({ rule: m.ruleId, message: m.message })));

/** The no-restricted-syntax errors whose message passes `test`. */
const errorsWhere = (result: ESLint.LintResult, test: (message: string) => boolean) =>
  result.messages.filter((m) => m.severity === 2 && m.ruleId === "no-restricted-syntax" && test(m.message));

/** A class string, written each way the rules must see. */
const FORMS = {
  literal: (cls: string) => `<div className="${cls}" />`,
  braces: (cls: string) => `<div className={"${cls}"} />`,
  template: (cls: string) => `<div className={\`${cls} \${name}\`} />`,
};
type Form = keyof typeof FORMS;
const written = (cases: Array<[string, Form]>): Array<[string, Form, string]> =>
  cases.map(([cls, form]) => [cls, form, FORMS[form](cls)]);

// ---------------------------------------------------------------------------------------------

const RATIOS: Record<string, string> = {
  sage: "1.51",
  divider: "1.51",
  gold: "2.09",
  "gold-hover": "1.75",
  border: "3.18",
};
const ratioMessage = (m: string) => /\d\.\d\d:1/.test(m);

describe("AC11 — lint fails on a low-contrast text colour under any variant but disabled:", () => {
  const cases = Object.keys(RATIOS).flatMap((token) =>
    written([
      [`text-${token}`, "literal"],
      [`hover:text-${token}`, "template"],
      [`placeholder:text-${token}`, "braces"],
      [`md:focus:text-${token}`, "literal"],
    ]).map(([cls, form, jsx]) => [token, cls, form, jsx] as const),
  );

  it.each(cases)(
    "AC11: %s — fails on %s as a %s, naming the token, its ratio on surface and the tokens to use",
    async (token, _cls, _form, jsx) => {
      const result = await lint(jsx);
      expect(result.fatalErrorCount, describeMessages(result)).toBe(0);
      const errors = errorsWhere(result, ratioMessage);
      expect(errors, describeMessages(result)).not.toHaveLength(0);
      const ratio = RATIOS[token] as string;
      for (const { message } of errors) {
        expect(message).toContain(token);
        expect(message).toContain(`${ratio}:1`);
        for (const other of new Set(Object.values(RATIOS).filter((r) => r !== ratio))) {
          expect(message, `the ${token} message gives another token's ratio`).not.toContain(`${other}:1`);
        }
        for (const instead of ["ink", "ink-muted", "teal", "teal-muted"]) expect(message).toContain(instead);
      }
    },
  );
});

// ---------------------------------------------------------------------------------------------

const OPT_OUT = "eslint-disable-next-line";

describe("AC12 — lint fails on a raw value", () => {
  const cases = written([
    ["p-[13px]", "literal"],
    ["bg-[#fbeeec]", "template"],
    ["text-[14px]", "braces"],
    ["hover:bg-[#fbeeec]", "literal"],
  ]);

  it.each(cases)("AC12: fails on the arbitrary value %s as a %s, naming the eslint-disable-next-line opt-out", async (_cls, _form, jsx) => {
    const result = await lint(jsx);
    expect(result.fatalErrorCount, describeMessages(result)).toBe(0);
    expect(errorsWhere(result, (m) => m.includes(OPT_OUT)), describeMessages(result)).not.toHaveLength(0);
  });

  it.each([
    ["an object", "<div style={{ margin: 0 }} />"],
    ["a variable", "<div style={name as never} />"],
  ])("AC12: fails on a style prop holding %s, naming the eslint-disable-next-line opt-out", async (_what, jsx) => {
    const result = await lint(jsx);
    expect(result.fatalErrorCount, describeMessages(result)).toBe(0);
    expect(errorsWhere(result, (m) => m.includes(OPT_OUT)), describeMessages(result)).not.toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------------------------

describe("AC13 — lint fails on a gold fill outside btn-primary", () => {
  const cases = written([
    ["bg-gold", "literal"],
    ["bg-gold", "template"],
    ["bg-gold-hover", "braces"],
    ["hover:bg-gold-hover", "literal"],
  ]);

  it.each(cases)("AC13: fails on %s as a %s, naming btn-primary", async (_cls, _form, jsx) => {
    const result = await lint(jsx);
    expect(result.fatalErrorCount, describeMessages(result)).toBe(0);
    expect(errorsWhere(result, (m) => m.includes("btn-primary")), describeMessages(result)).not.toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------------------------

const KINDS = ["btn-primary", "btn-secondary", "btn-quiet"];
const kindMessage = (m: string) => KINDS.every((kind) => m.includes(kind));

describe("AC14 — every <button> names its kind", () => {
  it.each([
    ["no className", "<button />"],
    ["no className, other attributes", '<button type="submit" name="language" value="en" />'],
    ["a className naming no kind", '<button className="w-full" />'],
    ["a className in braces naming no kind", '<button className={"w-full"} />'],
    ["a template-literal className naming no kind", "<button className={`w-full ${name}`} />"],
    ["a kind haul does not have", '<button className="btn-danger" />'],
    ["a className passed through a variable", "<button className={name} />"],
    ["a className passed through a member expression", "<button className={t.name} />"],
    ["a className passed through a call", '<button className={t("btn-primary")} />'],
  ])("AC14: fails on a <button> with %s, naming the three kinds", async (_what, jsx) => {
    const result = await lint(jsx);
    expect(result.fatalErrorCount, describeMessages(result)).toBe(0);
    expect(errorsWhere(result, kindMessage), describeMessages(result)).not.toHaveLength(0);
  });

  it.each([
    ["btn-primary", '<button className="btn-primary" />'],
    ["btn-secondary", '<button className="btn-secondary" />'],
    ["btn-quiet in braces", '<button className={"btn-quiet"} />'],
    ["a template literal containing a kind", "<button className={`btn-primary ${name}`} />"],
  ])("AC14: passes on a <button> with %s", async (_what, jsx) => {
    const result = await lint(jsx);
    expect(result.fatalErrorCount, describeMessages(result)).toBe(0);
    expect(result.errorCount, describeMessages(result)).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------

const bareStringMessage = (m: string) => m.includes("src/messages/");

describe("AC15 — the rules compose with DEC-015's bare-string selectors", () => {
  it.each(["app/sign-in/x.tsx", "components/x.tsx"])(
    "AC15: a file holding a bare string and a raw value reports both, in %s",
    async (filePath) => {
      const result = await lint('<p className="p-[13px]">Hi</p>', filePath);
      expect(result.fatalErrorCount, describeMessages(result)).toBe(0);
      expect(errorsWhere(result, bareStringMessage), describeMessages(result)).not.toHaveLength(0);
      expect(errorsWhere(result, (m) => m.includes(OPT_OUT)), describeMessages(result)).not.toHaveLength(0);
    },
  );

  it.each(["components/x.tsx", "app/sign-in/x.tsx"])(
    "AC15: a <button> with no kind and a contrast class are both reported beside a bare string, in %s",
    async (filePath) => {
      const result = await lint('<button className="hover:text-gold">Hi</button>', filePath);
      expect(errorsWhere(result, bareStringMessage), describeMessages(result)).not.toHaveLength(0);
      expect(errorsWhere(result, ratioMessage), describeMessages(result)).not.toHaveLength(0);
      expect(errorsWhere(result, kindMessage), describeMessages(result)).not.toHaveLength(0);
    },
  );

  describe.each(["app/x.test.tsx", "e2e/x.spec.tsx"])("tests are exempt, as today: %s", (filePath) => {
    it.each([
      ["a contrast class", '<div className="text-gold" />'],
      ["a raw value", '<div className="p-[13px]" />'],
      ["a style prop", "<div style={{ margin: 0 }} />"],
      ["a gold fill", '<div className="bg-gold" />'],
      ["a <button> with no kind", "<button />"],
    ])("AC15: passes on %s", async (_what, jsx) => {
      const result = await lint(jsx, filePath);
      expect(result.fatalErrorCount, describeMessages(result)).toBe(0);
      expect(result.errorCount, describeMessages(result)).toBe(0);
    });
  });
});

// ---------------------------------------------------------------------------------------------

describe("AC16 — each rule's clean counterpart passes", () => {
  const classes: Array<[string, Form]> = [
    ["text-teal", "literal"],
    ["text-ink-muted", "template"],
    ["text-teal-muted", "braces"],
    ["disabled:text-border", "literal"],
    ["disabled:text-border", "template"],
    ["bg-surface", "literal"],
    ["border-border", "literal"],
    ["p-4", "template"],
    ["h-field", "literal"],
    ["max-w-card", "braces"],
  ];
  const cases: Array<[string, string]> = [
    ...written(classes).map(([cls, form, jsx]) => [`${cls} as a ${form}`, jsx] as [string, string]),
    ['className="btn-primary w-full" on a <button>', '<button className="btn-primary w-full" />'],
    ["a <button> with btn-quiet", '<button className="btn-quiet" />'],
  ];

  it.each(cases)("AC16: passes on %s", async (_what, jsx) => {
    const result = await lint(jsx);
    expect(result.fatalErrorCount, describeMessages(result)).toBe(0);
    expect(result.errorCount, describeMessages(result)).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------

const request = vi.hoisted(() => ({ current: { cookies: {}, headers: {}, sets: [] } as import("./next-headers-fake").RequestState }));
const services = vi.hoisted(() => ({
  repo: undefined as unknown as import("@core/adapters/in-memory-repository.js").InMemoryRepository,
  secret: "test-session-secret-that-is-long-enough-0123456789",
}));
vi.mock("next/headers", async () => {
  const { fakeNextHeaders } = await import("./next-headers-fake");
  return {
    cookies: () => fakeNextHeaders(request.current).cookies(),
    headers: () => fakeNextHeaders(request.current).headers(),
  };
});
vi.mock("next/navigation", async () => ({ redirect: (await import("./screen-test-helpers")).throwingRedirect }));
vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("./services", () => ({
  getRepository: () => services.repo,
  getEmail: () => {
    throw new Error("the home page has no reason to send email");
  },
  getSessionSecret: () => services.secret,
}));

beforeEach(() => {
  request.current = emptyRequest();
  services.repo = new InMemoryRepository();
});

describe("AC17 — every .tsx file in the repo passes lint", () => {
  it("AC17: npm run lint's .tsx files report no errors", async () => {
    const results = await eslint.lintFiles(["app/**/*.tsx", "src/**/*.tsx", "db/**/*.tsx", "components/**/*.tsx"]);
    expect(results.length).toBeGreaterThan(0);
    const errors = results.flatMap((r) =>
      r.messages.filter((m) => m.severity === 2).map((m) => `${r.filePath.slice(ROOT.length)}:${m.line} ${m.message}`),
    );
    expect(errors).toEqual([]);
  });

  it("AC17: the home page's sign-out button carries btn-secondary", async () => {
    const member = await services.repo.createMember({ email: "ada@example.com" });
    const expiresAt = new Date(Date.now() + 24 * 60 * 60_000).toISOString();
    request.current.cookies.ocf_session = signSession({ subjectId: member.id, expiresAt }, services.secret);
    const html = renderToStaticMarkup(await Home());
    const opening = new RegExp(`(<button\\b[^>]*>)${escapeRegExp("Sign out")}</button>`).exec(screenMarkup(html))?.[1];
    expect(opening, "no Sign out button").toBeDefined();
    const classes = (attributesOf(opening ?? "", "button")[0]?.class ?? "").split(/\s+/);
    expect(classes).toContain("btn-secondary");
  });
});
