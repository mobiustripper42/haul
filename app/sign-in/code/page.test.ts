// Issue 9, AC34: /sign-in/code, `await SignInCode(props)` rendered through react-dom/server with
// `next/headers` faked and `redirect` throwing, as it does in Next.
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyRequest } from "../../next-headers-fake";
import { attributesOf, escapeRegExp, findAll, redirectOf, screenMarkup, textsOf } from "../../screen-test-helpers";
import { requestCode, verifyCode } from "../actions";
import SignInCode from "./page";

const request = vi.hoisted(() => ({ current: { cookies: {}, headers: {}, sets: [] } as import("../../next-headers-fake").RequestState }));

vi.mock("next/headers", async () => {
  const { fakeNextHeaders } = await import("../../next-headers-fake");
  return {
    cookies: () => fakeNextHeaders(request.current).cookies(),
    headers: () => fakeNextHeaders(request.current).headers(),
  };
});
vi.mock("next/navigation", async () => ({ redirect: (await import("../../screen-test-helpers")).throwingRedirect }));
vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("../../services", () => ({
  getRepository: () => {
    throw new Error("/sign-in/code has no reason to read the repository");
  },
  getEmail: () => {
    throw new Error("/sign-in/code has no reason to send email");
  },
  getSessionSecret: () => "test-session-secret-that-is-long-enough-0123456789",
}));

const EMAIL = "Ada@Example.com";

beforeEach(() => {
  request.current = emptyRequest();
  request.current.cookies = { ocf_sign_in_email: EMAIL };
});

async function render(searchParams: { error?: string }) {
  const element = await SignInCode({ searchParams: Promise.resolve(searchParams) });
  return { element, html: renderToStaticMarkup(element) };
}

const SENT = `If ${EMAIL} has an account, a 6-digit code is on its way. It expires in 10 minutes.`;
const INVALID = "That code didn't match, or it has expired. Check it and try again, or ask for a new one.";
const TEXTS = ["Enter your code", SENT, "6-digit code", "Sign in", "Send a new code", "Use a different email"];

const p = (text: string) => `<p\\b[^>]*>${escapeRegExp(text)}</p>`;
const alert = (text: string) => `<p\\b(?=[^>]*\\brole="alert")[^>]*>${escapeRegExp(text)}</p>`;
const HEAD = `<h1\\b[^>]*>Enter your code</h1>\\s*${p(SENT)}`;
const TAIL =
  "<form\\b[^>]*>\\s*<p\\b[^>]*>\\s*<label\\b[^>]*>6-digit code</label>\\s*<input\\b[^>]*/>\\s*</p>\\s*" +
  "<button\\b[^>]*>Sign in</button>\\s*</form>\\s*" +
  "<form\\b[^>]*>\\s*<input\\b[^>]*/>\\s*<button\\b[^>]*>Send a new code</button>\\s*</form>\\s*" +
  '<p\\b[^>]*>\\s*<a\\b[^>]*>Use a different email</a>\\s*</p>';

describe("AC34 (issue 9) — /sign-in/code", () => {
  it("AC34: without the ocf_sign_in_email cookie it redirects to /sign-in?error=expired", async () => {
    request.current.cookies = {};
    expect(await redirectOf(SignInCode({ searchParams: Promise.resolve({}) }))).toBe("/sign-in?error=expired");
  });

  it("AC34: with the cookie it renders, in order, the heading, the line naming the cookie's email, the code form, the resend form and the link", async () => {
    const { html } = await render({});
    expect(textsOf(html)).toEqual(TEXTS);
    expect(screenMarkup(html)).toMatch(new RegExp(`${HEAD}\\s*${TAIL}`));
  });

  it("AC34: error=invalid shows the invalid notice, a <p role=\"alert\">, after the line naming the email", async () => {
    const { html } = await render({ error: "invalid" });
    expect(textsOf(html)).toEqual([TEXTS[0], TEXTS[1], INVALID, ...TEXTS.slice(2)]);
    expect(screenMarkup(html)).toMatch(new RegExp(`${HEAD}\\s*${alert(INVALID)}\\s*${TAIL}`));
  });

  it.each(["expired", "Invalid", ""])("AC34: error=%j shows no invalid notice", async (error) => {
    const { html } = await render({ error });
    expect(textsOf(html)).toEqual(TEXTS);
  });

  it("AC34: the code input is labelled and set up for a one-time code", async () => {
    const { html } = await render({});
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

  it("AC34: the second form carries the cookie's email in a hidden field named email", async () => {
    const { html } = await render({});
    const inputs = attributesOf(html, "input");
    expect(inputs).toHaveLength(2);
    expect(inputs[1]).toMatchObject({ type: "hidden", name: "email", value: EMAIL });
  });

  it("AC34: both buttons submit, and the link goes to /sign-in", async () => {
    const { html } = await render({});
    expect(attributesOf(html, "button")).toEqual([
      expect.objectContaining({ type: "submit" }),
      expect.objectContaining({ type: "submit" }),
    ]);
    expect(attributesOf(html, "a")).toEqual([expect.objectContaining({ href: "/sign-in" })]);
  });

  it("AC34: the first form's action is verifyCode, the second's requestCode", async () => {
    const { element } = await render({});
    const forms = findAll(element, "form");
    expect(forms).toHaveLength(2);
    expect(forms[0]?.props.action).toBe(verifyCode);
    expect(forms[1]?.props.action).toBe(requestCode);
  });
});
