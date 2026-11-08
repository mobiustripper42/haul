// Issue 77, AC13: every code step renders through one component. `SignInCodeStep` and `AccountCodeStep`
// are read with a made-up page set, so nothing here leans on the real paths; the four pages' own tests
// (app/sign-in/code/page.test.ts, app/create-account/code/page.test.ts,
// app/supper-club/pane-pages.test.ts) hold what each passes in. The code field and the buttons — issue 9's
// AC34, issue 19's AC8 and AC9, issue 22's AC23 to AC25 — are written here, so they are tested here.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTranslator } from "@core/i18n.js";
import { en, type MessageKey } from "@core/messages/en.js";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { emptyRequest } from "../next-headers-fake";
import { alertTexts, attributesOf, findAll, inOrder, redirectOf } from "../screen-test-helpers";
import { AccountCodeStep, SignInCodeStep } from "./code-step";

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

const t = createTranslator("en");
const EMAIL = "ada@example.com";
const PAGES = { start: "/flow", code: "/flow/code", done: "/done" };
const verify: (formData: FormData) => Promise<void> = async () => {};
const resend: (formData: FormData) => Promise<void> = async () => {};

/** Each step's own words: heading, sentence, button and, for Create Account, the hint under the form. */
const STEPS = [
  ["SignInCodeStep", SignInCodeStep, ["signIn.codeTitle", "signIn.codeSent", "signIn.submitCode"], []],
  [
    "AccountCodeStep",
    AccountCodeStep,
    ["createAccount.codeTitle", "createAccount.codeSent", "createAccount.confirm"],
    ["createAccount.spam"],
  ],
] as const satisfies ReadonlyArray<
  readonly [string, unknown, readonly [MessageKey, MessageKey, MessageKey], readonly MessageKey[]]
>;

beforeEach(() => {
  request.current = emptyRequest();
  request.current.cookies = { ocf_sign_in_email: EMAIL };
});

const buttonLabelled = (element: unknown, label: string): ReactElement<Record<string, unknown>> | undefined =>
  findAll(element as ReactElement, Button).find((button) => button.props.children === label);

describe.each(STEPS)("%s", (name, Step, [headingKey, sentenceKey, buttonKey], hintKeys) => {
  const render = async (error?: string) => {
    const element = await Step({ pages: PAGES, verify, resend, ...(error === undefined ? {} : { error }) });
    return { element, html: renderToStaticMarkup(element) };
  };
  const sentence = t(sentenceKey, { email: EMAIL, minutes: 10 });

  it(`AC13: ${name} with no email cookie redirects to the flow's start with error=expired`, async () => {
    request.current.cookies = {};
    expect(await redirectOf(Step({ pages: PAGES, verify, resend }))).toBe("/flow?error=expired");
  });

  it(`AC13: ${name} reads back link, heading, sentence, code field, button, any hint, resend — as in Screen`, async () => {
    const order = [
      en["signIn.differentEmail"],
      en[headingKey],
      sentence,
      en["signIn.codeLabel"],
      en[buttonKey],
      ...hintKeys.map((key) => en[key]),
      en["signIn.resend"],
    ];
    expect(inOrder((await render()).html, order)).toEqual(order);
  });

  it(`AC13: ${name}'s "Use a different email" goes to the flow's start`, async () => {
    expect(attributesOf((await render()).html, "a").map((link) => link.href)).toEqual(["/flow"]);
  });

  it(`AC13: ${name}'s forms post to the verify and resend it was given, in that order`, async () => {
    expect(findAll((await render()).element, "form").map((form) => form.props.action)).toEqual([verify, resend]);
  });

  it(`AC13: ${name} with error=invalid shows the notice after the sentence and marks the field invalid`, async () => {
    const { html } = await render("invalid");
    expect(alertTexts(html)).toEqual([en["signIn.invalidCode"]]);
    expect(inOrder(html, [sentence, en["signIn.invalidCode"], en["signIn.codeLabel"]])).toEqual([
      sentence,
      en["signIn.invalidCode"],
      en["signIn.codeLabel"],
    ]);
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

describe("the code page's wording (issue 22, AC23 and AC24)", () => {
  it("AC24: the line under the heading names the email and says a new code can be sent once this one expires", async () => {
    const html = renderToStaticMarkup(await SignInCodeStep({ pages: PAGES, verify, resend }));
    const order = [
      en["signIn.codeTitle"],
      `If ${EMAIL} has an account, a 6-digit code is on its way. It expires in 10 minutes, and a new one can be sent after that.`,
    ];
    expect(inOrder(html, order)).toEqual(order);
  });

  it("AC23: the wrong-code notice tells the member to check their email after 5 wrong tries", async () => {
    const html = renderToStaticMarkup(await SignInCodeStep({ pages: PAGES, verify, resend, error: "invalid" }));
    expect(alertTexts(html)).toEqual([
      "That code didn't match, or it has expired. Check it and try again, or ask for a new one. After 5 wrong tries, check your email for a sign-in link.",
    ]);
  });
});

describe("resendEmail, the one difference in what the resend form carries", () => {
  it("AC13: SignInCodeStep's resend form carries the cookie's email in a hidden field", async () => {
    const html = renderToStaticMarkup(await SignInCodeStep({ pages: PAGES, verify, resend }));
    expect(attributesOf(html, "input").filter((input) => input.type === "hidden")).toEqual([
      expect.objectContaining({ name: "email", value: EMAIL }),
    ]);
  });

  it("AC13: AccountCodeStep's resend form carries none: resendAccountCode reads the cookie", async () => {
    const html = renderToStaticMarkup(await AccountCodeStep({ pages: PAGES, verify, resend }));
    expect(attributesOf(html, "input").filter((input) => input.type === "hidden")).toEqual([]);
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
