// Issue 77, AC13: every code step renders through one component. `SignInCodeStep` and `AccountCodeStep`
// are read with a made-up page set, so nothing here leans on the real paths; the four pages' own tests
// (app/sign-in/code/page.test.ts, app/create-account/code/page.test.ts,
// app/supper-club/pane-pages.test.ts) hold what each passes in. The code field and the buttons — issue 9's
// AC34, issue 19's AC8 and AC9, issue 22's AC23 to AC25 — are written here, so they are tested here.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { en } from "@core/messages/en.js";
import { CODE_TTL_MS } from "@core/sign-in/code.js";
import { Button } from "../../components/ui/button";
import { Hint } from "../../components/ui/hint";
import { Input } from "../../components/ui/input";
import { Notice } from "../../components/ui/notice";
import { emptyRequest } from "../next-headers-fake";
import { alertTexts, attributesOf, findAll, inOrder, redirectOf, screenMarkup, textsOf } from "../screen-test-helpers";
import { AccountCodeStep, CodeStep, SignInCodeStep } from "./code-step";

const request = vi.hoisted(() => ({ current: { cookies: {}, headers: {}, sets: [] } as import("../next-headers-fake").RequestState }));
vi.mock("next/headers", async () => {
  const { fakeNextHeaders } = await import("../next-headers-fake");
  return {
    cookies: () => fakeNextHeaders(request.current).cookies(),
    headers: () => fakeNextHeaders(request.current).headers(),
  };
});
vi.mock("next/navigation", async () => ({ redirect: (await import("../screen-test-helpers")).throwingRedirect }));
vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("../services", () => ({
  getRepository: () => {
    throw new Error("a code step has no reason to read the repository");
  },
  getEmail: () => {
    throw new Error("a code step has no reason to send email");
  },
  getSessionSecret: () => "test-session-secret-that-is-long-enough-0123456789",
  getSiteUrl: () => "https://members.example.test",
}));

const EMAIL = "ada@example.com";
const PAGES = { start: "/flow", code: "/flow/code", done: "/done" };
const verify: (formData: FormData) => Promise<void> = async () => {};
const resend: (formData: FormData) => Promise<void> = async () => {};

/** Each step, and how many hint lines it draws under the code form: Create Account's one, sign-in's none. */
const STEPS = [
  ["SignInCodeStep", SignInCodeStep, 0],
  ["AccountCodeStep", AccountCodeStep, 1],
] as const;

/** Where `marker` first stands in the rendered markup; it must be there. */
const at = (html: string, marker: string): number => {
  const index = screenMarkup(html).indexOf(marker);
  expect(index, marker).toBeGreaterThan(-1);
  return index;
};
const ALERT = 'role="alert"';
const CODE_INPUT = 'name="code"';

beforeEach(() => {
  request.current = emptyRequest();
  request.current.cookies = { ocf_sign_in_email: EMAIL };
});

const buttonLabelled = (element: unknown, label: string): ReactElement<Record<string, unknown>> | undefined =>
  findAll(element as ReactElement, Button).find((button) => button.props.children === label);

describe.each(STEPS)("%s", (name, Step, hints) => {
  const render = async (error?: string) => {
    const element = await Step({ pages: PAGES, verify, resend, ...(error === undefined ? {} : { error }) });
    return { element, html: renderToStaticMarkup(element) };
  };

  it(`AC13: ${name} with no email cookie redirects to the flow's start with error=expired`, async () => {
    request.current.cookies = {};
    expect(await redirectOf(Step({ pages: PAGES, verify, resend }))).toBe("/flow?error=expired");
  });

  it(`AC13: ${name}'s sentence, under the heading, carries the cookie's email and the code's minutes`, async () => {
    const { html } = await render();
    const withEmail = textsOf(html).filter((text) => text.includes(EMAIL));
    expect(withEmail).toHaveLength(1);
    expect(withEmail[0]).toContain(`${CODE_TTL_MS / 60_000}`);
    expect(at(html, "<h1")).toBeLessThan(at(html, EMAIL));
  });

  it(`AC13: ${name} draws ${hints} hint line(s) under the code form`, async () => {
    expect(findAll((await render()).element, Hint)).toHaveLength(hints);
  });

  it(`AC13: ${name}'s "Use a different email" goes to the flow's start`, async () => {
    expect(attributesOf((await render()).html, "a").map((link) => link.href)).toEqual(["/flow"]);
  });

  it(`AC13: ${name}'s forms post to the verify and resend it was given, in that order`, async () => {
    expect(findAll((await render()).element, "form").map((form) => form.props.action)).toEqual([verify, resend]);
  });

  it(`AC13: ${name} with error=invalid shows the notice after the sentence and marks the field invalid`, async () => {
    const { element, html } = await render("invalid");
    expect(findAll(element, Notice).map((notice) => notice.props.icon)).toEqual(["alert"]);
    expect(at(html, EMAIL)).toBeLessThan(at(html, ALERT));
    expect(at(html, ALERT)).toBeLessThan(at(html, CODE_INPUT));
    expect(attributesOf(html, "input").find((input) => input.name === "code")).toMatchObject({ "aria-invalid": "true" });
  });

  it.each(["expired", "Invalid", ""])(`AC13: ${name} with error=%j shows no notice and leaves the field valid`, async (error) => {
    const { html } = await render(error);
    expect(alertTexts(html)).toEqual([]);
    expect(attributesOf(html, "input").find((input) => input.name === "code")).not.toHaveProperty("aria-invalid");
  });
});

describe("the code field and the buttons (issue 9, AC34; issue 19, AC8 and AC9; issue 22, AC25)", () => {
  const render = async () => {
    const element = await SignInCodeStep({ pages: PAGES, verify, resend });
    return { element, html: renderToStaticMarkup(element) };
  };

  it("AC34: the code input is labelled and set up for a one-time code", async () => {
    const { html } = await render();
    expect(attributesOf(html, "label")).toEqual([expect.objectContaining({ for: "code" })]);
    const [code] = attributesOf(html, "input");
    expect(code).toMatchObject({
      id: "code",
      name: "code",
      inputmode: "numeric",
      autocomplete: "one-time-code",
      pattern: "[0-9]*",
      maxlength: "6",
    });
    expect(code).toHaveProperty("required");
    expect(code).toHaveProperty("autofocus");
    expect(code).not.toHaveProperty("placeholder");
  });

  it("AC9: the code input is an Input in the code style", async () => {
    expect(findAll((await render()).element, Input).map((input) => input.props.code)).toEqual([true]);
  });

  it("AC34: both buttons submit", async () => {
    expect(attributesOf((await render()).html, "button")).toEqual([
      expect.objectContaining({ type: "submit" }),
      expect.objectContaining({ type: "submit" }),
    ]);
  });

  it("AC8, AC25: the back link is a quiet Button marked back and flush", async () => {
    const back = buttonLabelled((await render()).element, en["signIn.differentEmail"]);
    expect(back?.props).toMatchObject({ kind: "quiet", back: true, flush: true });
  });

  it("AC8: the submit is a full-width primary Button", async () => {
    const submit = buttonLabelled((await render()).element, en["signIn.submitCode"]);
    expect(submit?.props).toMatchObject({ kind: "primary", full: true });
  });

  it("AC25: the resend is a quiet Button, flush and not full width", async () => {
    const resendButton = buttonLabelled((await render()).element, en["signIn.resend"]);
    expect(resendButton?.props).toMatchObject({ kind: "quiet", flush: true });
    expect(resendButton?.props.full).toBeUndefined();
  });
});

describe("resendEmail, the one difference in what the resend form carries", () => {
  it("AC13: SignInCodeStep's resend form carries the cookie's email in a hidden field", async () => {
    const html = renderToStaticMarkup(await SignInCodeStep({ pages: PAGES, verify, resend }));
    expect(attributesOf(html, "input").filter((input) => input.type === "hidden")).toEqual([
      expect.objectContaining({ name: "email", value: EMAIL }),
      expect.objectContaining({ name: "resend", value: "1" }),
    ]);
  });

  it("AC13: AccountCodeStep's resend form carries none: resendAccountCode reads the cookie", async () => {
    const html = renderToStaticMarkup(await AccountCodeStep({ pages: PAGES, verify, resend }));
    expect(attributesOf(html, "input").filter((input) => input.type === "hidden")).toEqual([
      expect.objectContaining({ name: "resend", value: "1" }),
    ]);
  });
});

// Issue 101, AC2 and AC3: after "Send a new code" the step comes back with `sent` "1" and says a new code is
// on its way, in a check Notice where the wrong-code notice stands. The words name no email, so they are the
// same for a member and a stranger. These are the notice's one home; the four pages' tests only hand `sent` on.
describe.each(STEPS)("AC2, AC3 (issue 101) — %s after a resend", (name, Step) => {
  const render = async (props: { error?: string; sent?: string } = {}) => {
    const element = await Step({ pages: PAGES, verify, resend, ...props });
    return { element, html: renderToStaticMarkup(element) };
  };

  it(`AC2: ${name} with sent="1" shows its notice after the sentence and above the code field`, async () => {
    const { html } = await render({ sent: "1" });
    expect(alertTexts(html)).toHaveLength(1);
    expect(at(html, EMAIL)).toBeLessThan(at(html, ALERT));
    expect(at(html, ALERT)).toBeLessThan(at(html, CODE_INPUT));
  });

  it(`AC2: ${name}'s notice names no email`, async () => {
    request.current.cookies = { ocf_sign_in_email: "nobody@example.com" };
    const alerts = alertTexts((await render({ sent: "1" })).html);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).not.toContain("nobody@example.com");
  });

  it(`AC3: ${name}'s resent notice is a check Notice`, async () => {
    expect(findAll((await render({ sent: "1" })).element, Notice).map((notice) => notice.props.icon)).toEqual(["check"]);
  });

  it(`AC2: ${name} with sent="1" and error=invalid shows the wrong-code notice alone`, async () => {
    const { element } = await render({ sent: "1", error: "invalid" });
    expect(findAll(element, Notice).map((notice) => notice.props.icon)).toEqual(["alert"]);
  });

  it.each(["0", "", "true", "11"])(`AC2: ${name} with sent=%j shows no resent notice`, async (sent) => {
    expect(alertTexts((await render({ sent })).html)).toEqual([]);
  });

  it(`AC2: ${name}'s resend form, and not the code form, carries resend=1`, async () => {
    const [codeForm, resendForm] = findAll((await render()).element, "form");
    const resendFields = (form: unknown) =>
      findAll(form as ReactElement, "input").filter((input) => input.props.name === "resend").map((input) => [input.props.type, String(input.props.value)]);
    expect(resendFields(resendForm)).toEqual([["hidden", "1"]]);
    expect(resendFields(codeForm)).toEqual([]);
  });
});

// Issue 156: Your details reuses CodeStep with three additions — a caller's own `back` in place of the back link
// ("Keep the old email" posts), a `notice` after the wrong-code notice (Square's refusal, the wait notice), and an
// `invalidText` in place of sign-in's wrong-code line. The words here are the test's own.
describe("issue 156 — CodeStep's back, notice and invalidText", () => {
  const HEADING = "Check it";
  const SENTENCE = "We sent it.";
  const step = (extra: Record<string, unknown> = {}) =>
    CodeStep({ heading: HEADING, sentence: SENTENCE, buttonLabel: "Confirm", verify, resend, backHref: "/flow", invalid: false, sent: false, ...extra } as Parameters<typeof CodeStep>[0]);
  const BACK = createElement("p", null, "the caller's own back");
  const NOTICE = createElement(Notice, { icon: "alert", children: "Something else went wrong." });

  it("AC14: with back, the caller's element stands where the back link was, before the heading, and no link to backHref is drawn", async () => {
    const html = renderToStaticMarkup(await step({ back: BACK }));
    expect(inOrder(html, ["the caller's own back", HEADING])).toEqual(["the caller's own back", HEADING]);
    expect(attributesOf(html, "a")).toEqual([]);
  });

  it("AC12: with invalidText, a wrong code shows that line in place of sign-in's", async () => {
    const html = renderToStaticMarkup(await step({ invalid: true, invalidText: "That one is wrong here." }));
    expect(alertTexts(html)).toEqual(["That one is wrong here."]);
  });

  it("AC11, AC13: notice is drawn after the wrong-code notice and above the code field", async () => {
    const html = renderToStaticMarkup(await step({ invalid: true, notice: NOTICE }));
    expect(alertTexts(html)).toEqual([en["signIn.invalidCode"], "Something else went wrong."]);
    expect(at(html, SENTENCE)).toBeLessThan(at(html, "Something else went wrong."));
    expect(at(html, "Something else went wrong.")).toBeLessThan(at(html, CODE_INPUT));
  });

  it("AC11, AC13: notice is drawn on its own when the code was not wrong", async () => {
    expect(alertTexts(renderToStaticMarkup(await step({ notice: NOTICE })))).toEqual(["Something else went wrong."]);
  });
});

// Issue 219: on /account the code step sits below the page's own heading, so it draws its heading at level 2; every
// other caller gives no level and keeps level 1, which the AC13 sentence tests above read.
describe("AC6 (issue 219) — CodeStep's headingLevel", () => {
  const step = (extra: Record<string, unknown> = {}) =>
    CodeStep({ heading: "Check it", sentence: "We sent it.", buttonLabel: "Confirm", verify, resend, backHref: "/flow", invalid: false, sent: false, ...extra } as Parameters<typeof CodeStep>[0]);

  it("AC6: with headingLevel 2 the heading is an h2, and no h1 is drawn", async () => {
    const html = renderToStaticMarkup(await step({ headingLevel: 2 }));
    expect(html.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/)?.[1]).toBe("Check it");
    expect(html).not.toMatch(/<h1\b/);
  });
});

describe("AC13 — one code step", () => {
  const APP = fileURLToPath(new URL("..", import.meta.url));

  /** Every .tsx file under app/ that is not a test, by path from app/. */
  const components = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return components(path);
      return entry.name.endsWith(".tsx") ? [relative(APP, path).split(sep).join("/")] : [];
    });

  it("AC13: the code field is written in one file, code-step.tsx", () => {
    const writers = components(APP).filter((path) => readFileSync(join(APP, path), "utf8").includes("one-time-code"));
    expect(writers).toEqual(["sign-in/code-step.tsx"]);
  });

  it.each([
    ["sign-in/code/page.tsx", "SignInCodeStep"],
    ["supper-club/sign-in/code/page.tsx", "SignInCodeStep"],
    ["create-account/code/page.tsx", "AccountCodeStep"],
    ["supper-club/create-account/code/page.tsx", "AccountCodeStep"],
  ])("AC13: %s calls %s", (path, step) => {
    expect(readFileSync(join(APP, path), "utf8")).toMatch(new RegExp(`\\bawait ${step}\\(`));
  });
});
