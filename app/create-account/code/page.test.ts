// Issue 55, AC5, AC8, AC10 and AC16: /create-account/code, `await CreateAccountCode(props)` rendered
// through react-dom/server with `next/headers` faked.
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyRequest } from "../../next-headers-fake";
import { attributesOf, findAll, screenMarkup, textsOf, utilitiesOf } from "../../screen-test-helpers";
import { resendAccountCode, verifyAccountCode } from "../actions";
import CreateAccountCode from "./page";

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
    throw new Error("/create-account/code has no reason to read the repository");
  },
  getEmail: () => {
    throw new Error("/create-account/code has no reason to send email");
  },
  getSessionSecret: () => "test-session-secret-that-is-long-enough-0123456789",
  getSiteUrl: () => "https://members.example.test",
}));

const EMAIL = "ada@example.com";
const SENT = `We sent a 6-digit code to ${EMAIL}. Enter it to confirm your email. It expires in 10 minutes.`;
const INVALID =
  "That code didn't match, or it has expired. Check it and try again, or ask for a new one. After 5 wrong tries, check your email for a sign-in link.";

beforeEach(() => {
  request.current = emptyRequest();
  request.current.cookies = { ocf_sign_in_email: EMAIL };
});

async function render(searchParams: { error?: string } = {}) {
  const element = await CreateAccountCode({ searchParams: Promise.resolve(searchParams) });
  return { element, html: renderToStaticMarkup(element) };
}

describe("AC5 — the code step", () => {
  it("AC5: it reads, in order, the link, the heading, the line naming the address, the field, the button, the spam line and the resend", async () => {
    const { html } = await render();
    expect(textsOf(html)).toEqual([
      "Use a different email",
      "Check your email",
      SENT,
      "6-digit code",
      "Confirm email",
      "No email? Check your spam folder.",
      "Send a new code",
    ]);
  });

  it('AC5: "Use a different email" links to /create-account', async () => {
    const { html } = await render();
    expect(attributesOf(html, "a")).toEqual([expect.objectContaining({ href: "/create-account" })]);
  });

  it("AC5: the address shown is the one in the email cookie", async () => {
    request.current.cookies = { ocf_sign_in_email: "grace@example.com" };
    const { html } = await render();
    expect(textsOf(html).join(" ")).toContain("grace@example.com");
    expect(html).not.toContain(EMAIL);
  });
});

describe("AC8 — the code form", () => {
  it("AC8: the code field and Confirm email post to verifyAccountCode", async () => {
    const { element } = await render();
    expect(findAll(element, "form")[0]?.props.action).toBe(verifyAccountCode);
  });

  it("AC8: the field is named code, as verifyCodeFor reads it, and the label is for it", async () => {
    const { html } = await render();
    const code = attributesOf(html, "input").find((input) => input.name === "code");
    expect(code?.id).toBeDefined();
    expect(attributesOf(html, "label").map((label) => label.for)).toEqual([code?.id]);
  });

  it("AC8: Confirm email is the primary submit", async () => {
    const { html } = await render();
    const [button] = attributesOf(html, "button");
    expect(button).toMatchObject({ type: "submit" });
    expect(utilitiesOf(button?.class)).toContain("btn-primary");
    expect(screenMarkup(html)).toMatch(/<button\b[^>]*>Confirm email<\/button>/);
  });
});

describe("AC10 — error=invalid", () => {
  it("AC10: it shows signIn.invalidCode unchanged, in an alert, and the rest of the step", async () => {
    const { html } = await render({ error: "invalid" });
    const texts = textsOf(html);
    expect(texts).toContain(INVALID);
    expect(texts).toContain("Confirm email");
    expect(attributesOf(html, "p").filter((p) => p.role === "alert")).toHaveLength(1);
  });

  it.each(["expired", "Invalid", ""])("AC10: error=%j shows no notice", async (error) => {
    const { html } = await render({ error });
    expect(textsOf(html)).toContain("Confirm email");
    expect(textsOf(html)).not.toContain(INVALID);
  });
});

describe("AC16 — Send a new code", () => {
  it("AC16: it is a form of its own, after the code form, posting to resendAccountCode", async () => {
    const { element } = await render();
    expect(findAll(element, "form").map((form) => form.props.action)).toEqual([verifyAccountCode, resendAccountCode]);
  });

  it("AC16: it is a quiet submit, and no button sits inside a sentence", async () => {
    const { html } = await render();
    const buttons = attributesOf(html, "button");
    expect(buttons).toHaveLength(2);
    expect(buttons[1]).toMatchObject({ type: "submit" });
    expect(utilitiesOf(buttons[1]?.class)).toContain("btn-quiet");
    expect(screenMarkup(html)).toMatch(/<form\b[^>]*>(?:(?!<\/form>)[\s\S])*<button\b[^>]*>Send a new code<\/button>\s*<\/form>/);
  });
});
