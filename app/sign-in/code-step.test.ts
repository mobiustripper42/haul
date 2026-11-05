// Issue 77, AC13: every code step renders through one component. `SignInCodeStep` and `AccountCodeStep`
// are read with a made-up page set, so nothing here leans on the real paths; the four pages' own tests
// (app/sign-in/code/page.test.ts, app/create-account/code/page.test.ts,
// app/supper-club/pane-pages.test.ts) hold what each passes in.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyRequest } from "../next-headers-fake";
import { attributesOf, findAll, redirectOf, textsOf } from "../screen-test-helpers";
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

const EMAIL = "ada@example.com";
const PAGES = { start: "/flow", code: "/flow/code", done: "/done" };
const verify: (formData: FormData) => Promise<void> = async () => {};
const resend: (formData: FormData) => Promise<void> = async () => {};
const INVALID =
  "That code didn't match, or it has expired. Check it and try again, or ask for a new one. After 5 wrong tries, check your email for a sign-in link.";

const STEPS = [
  [
    "SignInCodeStep",
    SignInCodeStep,
    [
      "Use a different email",
      "Enter your code",
      `If ${EMAIL} has an account, a 6-digit code is on its way. It expires in 10 minutes, and a new one can be sent after that.`,
      "6-digit code",
      "Sign in",
      "Send a new code",
    ],
  ],
  [
    "AccountCodeStep",
    AccountCodeStep,
    [
      "Use a different email",
      "Check your email",
      `We sent a 6-digit code to ${EMAIL}. Enter it to confirm your email. It expires in 10 minutes.`,
      "6-digit code",
      "Confirm email",
      "No email? Check your spam folder.",
      "Send a new code",
    ],
  ],
] as const;

beforeEach(() => {
  request.current = emptyRequest();
  request.current.cookies = { ocf_sign_in_email: EMAIL };
});

describe.each(STEPS)("%s", (name, Step, texts) => {
  const render = async (error?: string) => {
    const element = await Step({ pages: PAGES, verify, resend, ...(error === undefined ? {} : { error }) });
    return { element, html: renderToStaticMarkup(element) };
  };

  it(`AC13: ${name} with no email cookie redirects to the flow's start with error=expired`, async () => {
    request.current.cookies = {};
    expect(await redirectOf(Step({ pages: PAGES, verify, resend }))).toBe("/flow?error=expired");
  });

  it(`AC13: ${name} reads, in order, as in Screen`, async () => {
    expect(textsOf((await render()).html)).toEqual(texts);
  });

  it(`AC13: ${name}'s "Use a different email" goes to the flow's start`, async () => {
    expect(attributesOf((await render()).html, "a").map((link) => link.href)).toEqual(["/flow"]);
  });

  it(`AC13: ${name}'s forms post to the verify and resend it was given, in that order`, async () => {
    expect(findAll((await render()).element, "form").map((form) => form.props.action)).toEqual([verify, resend]);
  });

  it(`AC13: ${name} with error=invalid shows the notice after the sentence and marks the field invalid`, async () => {
    const { html } = await render("invalid");
    expect(textsOf(html)).toEqual([...texts.slice(0, 3), INVALID, ...texts.slice(3)]);
    expect(attributesOf(html, "input").find((input) => input.name === "code")).toMatchObject({ "aria-invalid": "true" });
  });

  it(`AC13: ${name} with any other error shows no notice`, async () => {
    expect(textsOf((await render("expired")).html)).toEqual(texts);
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
    expect(textsOf(html)).toContain("Send a new code");
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
