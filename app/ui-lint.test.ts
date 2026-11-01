// Issue 19, AC11–AC17: the UI rules in eslint.config.mjs's one `**/*.tsx` no-restricted-syntax block,
// run through the repo's own config with `lintText`, as app/bare-string-lint.test.ts runs DEC-015's.
// Issue 38, AC13–AC19: the component rules, which replace issue 19's AC14 (every <button> names its kind).
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

describe("AC11 — the important modifier, prefix or suffix, does not slip a low-contrast colour past", () => {
  const cases = Object.keys(RATIOS).flatMap((token) =>
    written([
      [`!text-${token}`, "literal"],
      [`hover:!text-${token}`, "braces"],
      [`text-${token}!`, "template"],
    ]).map(([cls, form, jsx]) => [token, cls, form, jsx] as const),
  );

  it.each(cases)("AC11: %s — fails on %s as a %s, naming the token and its ratio on surface", async (token, _cls, _form, jsx) => {
    const result = await lint(jsx);
    expect(result.fatalErrorCount, describeMessages(result)).toBe(0);
    const errors = errorsWhere(result, ratioMessage);
    expect(errors, describeMessages(result)).not.toHaveLength(0);
    for (const { message } of errors) {
      expect(message).toContain(token);
      expect(message).toContain(`${RATIOS[token] as string}:1`);
    }
  });
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

describe("AC12 — an arbitrary property is a raw value too; only class strings are held to it", () => {
  const cases = written([
    ["[color:#fff]", "literal"],
    ["[color:#fff]", "template"],
    ["hover:[margin:0]", "braces"],
    ["hover:[margin:0]", "literal"],
  ]);

  it.each(cases)("AC12: fails on the arbitrary property %s as a %s, naming the eslint-disable-next-line opt-out", async (_cls, _form, jsx) => {
    const result = await lint(jsx);
    expect(result.fatalErrorCount, describeMessages(result)).toBe(0);
    expect(errorsWhere(result, (m) => m.includes(OPT_OUT)), describeMessages(result)).not.toHaveLength(0);
  });

  it.each([
    ["the code input's pattern", '<Input pattern="[0-9]*" />'],
    ["a pattern shaped like an arbitrary value", '<Input pattern="A-[0-9]{4}" />'],
    ["a pattern as a template literal", "<Input pattern={`A-[0-9]{4}`} />"],
    ["a name shaped like an arbitrary value", '<Input name="item-[0]" />'],
    ["a translation key shaped like an arbitrary value", '<p>{t("p-[13px]")}</p>'],
  ])("AC12: passes on %s, which is not a class string", async (_what, jsx) => {
    const result = await lint(jsx);
    expect(result.fatalErrorCount, describeMessages(result)).toBe(0);
    expect(result.errorCount, describeMessages(result)).toBe(0);
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

// Issue 38, AC13–AC19: one component per look. Outside components/ui/, lint refuses a raw element or a
// component's class and names the component that owns it; inside, the folder builds them, and only
// DEC-015's and DEC-020's lists apply.

type Component = "Button" | "Input" | "Field" | "Heading" | "Shell" | "Card" | "Notice";
const names = (component: Component) => (m: string) => new RegExp(`(?<![\\w-])${component}(?![\\w-])`).test(m);

const OUTSIDE = ["app/x.tsx", "app/sign-in/x.tsx", "components/x.tsx"];
const INSIDE = ["components/ui/x.tsx", "components/ui/button.tsx"];

/** Lints `jsx` in `filePath` and expects a no-restricted-syntax error naming `component`. */
async function expectNamed(jsx: string, filePath: string, component: Component): Promise<void> {
  const result = await lint(jsx, filePath);
  expect(result.fatalErrorCount, describeMessages(result)).toBe(0);
  expect(errorsWhere(result, names(component)), describeMessages(result)).not.toHaveLength(0);
}

/** Lints `jsx` in `filePath` and expects no error at all. */
async function expectClean(jsx: string, filePath: string): Promise<void> {
  const result = await lint(jsx, filePath);
  expect(result.fatalErrorCount, describeMessages(result)).toBe(0);
  expect(result.errorCount, describeMessages(result)).toBe(0);
}

const RAW_BUTTONS: Array<[string, string]> = [
  ["a bare <button>", "<button />"],
  ["a submit <button>", '<button type="submit" name="language" value="en" />'],
  ["a <button> with a layout class", '<button type="submit" className="w-full" />'],
  ["a <button> with a className from a variable", "<button className={name} />"],
];

describe("AC13 (issue 38) — a raw <button> fails outside components/ui/, naming Button", () => {
  describe.each(OUTSIDE)("in %s", (filePath) => {
    it.each(RAW_BUTTONS)("AC13: fails on %s, naming Button", async (_what, jsx) => {
      await expectNamed(jsx, filePath, "Button");
    });
  });

  describe.each(INSIDE)("in %s", (filePath) => {
    it.each(RAW_BUTTONS)("AC13: passes on %s", async (_what, jsx) => {
      await expectClean(jsx, filePath);
    });
  });
});

describe("AC14 (issue 38) — a raw <input> fails outside components/ui/, naming Input, except type=\"hidden\"", () => {
  const raw: Array<[string, string]> = [
    ["a bare <input>", "<input />"],
    ["an email <input>", '<input id="email" name="email" type="email" required />'],
    ["a text <input>", '<input type="text" />'],
  ];

  describe.each(OUTSIDE)("in %s", (filePath) => {
    it.each(raw)("AC14: fails on %s, naming Input", async (_what, jsx) => {
      await expectNamed(jsx, filePath, "Input");
    });

    it('AC14: passes on <input type="hidden">', async () => {
      await expectClean('<input type="hidden" name="email" value={name} />', filePath);
    });

    it('AC14: fails on an <input> whose attribute holds a hidden <input> — the exemption is its own type, not a descendant\'s', async () => {
      await expectNamed('<input data-x={<input type="hidden" />} />', filePath, "Input");
    });
  });

  describe.each(INSIDE)("in %s", (filePath) => {
    it.each([...raw, ["an <input> with a className from a variable", "<input className={name} />"]])(
      "AC14: passes on %s",
      async (_what, jsx) => {
        await expectClean(jsx, filePath);
      },
    );
  });
});

describe("AC15 (issue 38) — a raw <label> fails outside components/ui/, naming Field", () => {
  const raw: Array<[string, string]> = [
    ["a bare <label>", "<label />"],
    ["a <label> for a field", '<label htmlFor="email">{t("signIn.emailLabel")}</label>'],
  ];

  describe.each(OUTSIDE)("in %s", (filePath) => {
    it.each(raw)("AC15: fails on %s, naming Field", async (_what, jsx) => {
      await expectNamed(jsx, filePath, "Field");
    });
  });

  describe.each(INSIDE)("in %s", (filePath) => {
    it.each(raw)("AC15: passes on %s", async (_what, jsx) => {
      await expectClean(jsx, filePath);
    });
  });
});

describe("AC16 (issue 38) — a raw <h1> to <h6> fails outside components/ui/, naming Heading", () => {
  const raw = ["h1", "h2", "h3", "h4", "h5", "h6"].map((h): [string, string] => [h, `<${h}>{t("home.title")}</${h}>`]);

  describe.each(OUTSIDE)("in %s", (filePath) => {
    it.each(raw)("AC16: fails on a raw <%s>, naming Heading", async (_h, jsx) => {
      await expectNamed(jsx, filePath, "Heading");
    });
  });

  describe.each(INSIDE)("in %s", (filePath) => {
    it.each(raw)("AC16: passes on a raw <%s>", async (_h, jsx) => {
      await expectClean(jsx, filePath);
    });
  });
});

describe("AC17 (issue 38) — a raw <main> fails outside components/ui/, naming Shell", () => {
  const raw: Array<[string, string]> = [
    ["a bare <main>", "<main />"],
    ["a <main> holding a paragraph", '<main>\n  <p>{t("a")}</p>\n</main>'],
  ];

  describe.each(OUTSIDE)("in %s", (filePath) => {
    it.each(raw)("AC17: fails on %s, naming Shell", async (_what, jsx) => {
      await expectNamed(jsx, filePath, "Shell");
    });
  });

  describe.each(INSIDE)("in %s", (filePath) => {
    it.each(raw)("AC17: passes on %s", async (_what, jsx) => {
      await expectClean(jsx, filePath);
    });
  });
});

// Each class a component owns, with the component lint must name for it.
const OWNED: Array<[string, Component]> = [
  ["page-narrow", "Shell"],
  ["card", "Card"],
  ["field", "Input"],
  ["field-code", "Input"],
  ["notice", "Notice"],
  ["notice-lock", "Notice"],
  ["notice-clock", "Notice"],
  ["notice-alert", "Notice"],
  ["notice-info", "Notice"],
  ["btn-primary", "Button"],
  ["btn-secondary", "Button"],
  ["btn-quiet", "Button"],
  ["btn-flush", "Button"],
  ["btn-danger", "Button"],
  ["back-link", "Button"],
];

describe("AC18 (issue 38) — a component's class in a class string fails outside components/ui/, naming its component", () => {
  const cases = OWNED.flatMap(([cls, component]) =>
    (["literal", "braces", "template"] as const).map((form) => [cls, form, component, FORMS[form](cls)] as const),
  );

  describe.each(OUTSIDE)("in %s", (filePath) => {
    it.each(cases)("AC18: fails on %s as a %s, naming %s", async (_cls, _form, component, jsx) => {
      await expectNamed(jsx, filePath, component);
    });
  });

  it.each([
    ["beside other classes", '<div className="flex card gap-2" />', "Card"],
    ["last of several", '<div className="flex gap-2 notice-lock" />', "Notice"],
    ["in a conditional's branch", '<div className={name ? "p-4" : "btn-quiet"} />', "Button"],
    ["in a template literal after an expression", "<div className={`${name} page-narrow`} />", "Shell"],
  ] as const)("AC18: fails on a class %s, naming its component", async (_what, jsx, component) => {
    await expectNamed(jsx, "app/x.tsx", component);
  });

  it.each([
    ["Button", "<button />", '<div className="btn-primary" />'],
    ["Input", "<input />", '<div className="field" />'],
    ["Shell", "<main />", '<div className="page-narrow" />'],
  ] as const)("AC18: the %s message for a class is the one its raw element gets", async (component, rawElement, classString) => {
    const fromElement = errorsWhere(await lint(rawElement), names(component)).map((m) => m.message);
    const fromClass = errorsWhere(await lint(classString), names(component)).map((m) => m.message);
    expect(fromElement).not.toHaveLength(0);
    expect(new Set(fromClass)).toEqual(new Set(fromElement));
  });

  it.each(
    written([
      ["h-field", "literal"],
      ["max-w-card", "braces"],
      ["shadow-card", "template"],
      ["text-field-label", "literal"],
      ["min-h-button", "template"],
      ["shadow-card", "literal"],
      ["text-field-label", "braces"],
    ]),
  )("AC18: passes on the token utility %s as a %s — whole class tokens only", async (_cls, _form, jsx) => {
    await expectClean(jsx, "app/x.tsx");
  });

  it.each([
    ["an id", '<div id="card" />'],
    ["a data attribute", '<div data-kind="btn-primary" />'],
    ["an href", '<a href="/notice" />'],
    ["a translation key", '<p>{t("card")}</p>'],
    ["a name", '<span id={name} data-x="field" />'],
  ])("AC18: passes on a component's class in %s, which is not a class string", async (_what, jsx) => {
    await expectClean(jsx, "app/x.tsx");
  });

  describe.each(INSIDE)("in %s", (filePath) => {
    it.each(cases)("AC18: passes on %s as a %s", async (_cls, _form, _component, jsx) => {
      await expectClean(jsx, filePath);
    });
  });
});

describe("AC19 (issue 38) — inside components/ui/, the contrast, raw-value, gold-fill and bare-string rules still fail", () => {
  describe.each(INSIDE)("in %s", (filePath) => {
    it.each(written([
      ["text-gold", "literal"],
      ["hover:text-border", "template"],
    ]))("AC19: the contrast rule fails on %s as a %s", async (_cls, _form, jsx) => {
      const result = await lint(jsx, filePath);
      expect(result.fatalErrorCount, describeMessages(result)).toBe(0);
      expect(errorsWhere(result, ratioMessage), describeMessages(result)).not.toHaveLength(0);
    });

    it.each([
      ["an arbitrary value as a literal", '<div className="p-[13px]" />'],
      ["an arbitrary value as a template", "<div className={`bg-[#fbeeec] ${name}`} />"],
      ["an arbitrary property", '<div className={"[color:#fff]"} />'],
      ["a style prop", "<div style={{ margin: 0 }} />"],
    ])("AC19: the raw-value rule fails on %s", async (_what, jsx) => {
      const result = await lint(jsx, filePath);
      expect(result.fatalErrorCount, describeMessages(result)).toBe(0);
      expect(errorsWhere(result, (m) => m.includes(OPT_OUT)), describeMessages(result)).not.toHaveLength(0);
    });

    it.each(written([
      ["bg-gold", "literal"],
      ["hover:bg-gold-hover", "template"],
    ]))("AC19: the gold-fill rule fails on %s as a %s, naming btn-primary", async (_cls, _form, jsx) => {
      const result = await lint(jsx, filePath);
      expect(result.fatalErrorCount, describeMessages(result)).toBe(0);
      expect(errorsWhere(result, (m) => m.includes("btn-primary")), describeMessages(result)).not.toHaveLength(0);
    });

    it.each([
      ["JSX text", "<p>Hi</p>"],
      ["a string literal child", '<p>{"Hi"}</p>'],
      ["a bare aria-label", '<button aria-label="Close" />'],
    ])("AC19: DEC-015's bare-string rule fails on %s", async (_what, jsx) => {
      const result = await lint(jsx, filePath);
      expect(result.fatalErrorCount, describeMessages(result)).toBe(0);
      expect(errorsWhere(result, (m) => m.includes("src/messages/")), describeMessages(result)).not.toHaveLength(0);
    });
  });
});

// ---------------------------------------------------------------------------------------------

const bareStringMessage =(m: string) => m.includes("src/messages/");

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
    "AC15: a raw <button> and a contrast class are both reported beside a bare string, in %s",
    async (filePath) => {
      const result = await lint('<button className="hover:text-gold">Hi</button>', filePath);
      expect(errorsWhere(result, bareStringMessage), describeMessages(result)).not.toHaveLength(0);
      expect(errorsWhere(result, ratioMessage), describeMessages(result)).not.toHaveLength(0);
      expect(errorsWhere(result, names("Button")), describeMessages(result)).not.toHaveLength(0);
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
    ['<Button kind="primary" full>', '<Button kind="primary" full />'],
    ['<Button kind="quiet">', '<Button kind="quiet" />'],
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
