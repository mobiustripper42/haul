// Issue 9, AC33: /sign-in, `await SignIn(props)` rendered through react-dom/server with
// `next/headers` faked, as app/page.test.ts renders the home page. Wording and order come from the
// markup; the form's action from the element tree the page returns.
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyRequest } from "../next-headers-fake";
import { attributesOf, escapeRegExp, findAll, screenMarkup, textsOf } from "../screen-test-helpers";
import { requestCode } from "./actions";
import SignIn from "./page";

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
    throw new Error("/sign-in has no reason to read the repository");
  },
  getEmail: () => {
    throw new Error("/sign-in has no reason to send email");
  },
  getSessionSecret: () => "test-session-secret-that-is-long-enough-0123456789",
}));

beforeEach(() => {
  request.current = emptyRequest();
});

async function render(searchParams: { limited?: string; error?: string }) {
  const element = await SignIn({ searchParams: Promise.resolve(searchParams) });
  return { element, html: renderToStaticMarkup(element) };
}

const limited = (minutes: string) => `Too many sign-in requests from this network. Try again in ${minutes} min.`;
const EXPIRED = "That sign-in step expired. Enter your email to get a new code.";
const alert = (text: string) => `<p\\b(?=[^>]*\\brole="alert")[^>]*>${escapeRegExp(text)}</p>`;
const FORM =
  "<form\\b[^>]*>\\s*<p\\b[^>]*>\\s*<label\\b[^>]*>Email</label>\\s*<input\\b[^>]*/>\\s*</p>\\s*" +
  "<button\\b[^>]*>Email me a code</button>\\s*</form>";

describe("AC33 (issue 9) — /sign-in", () => {
  it("AC33: with no notices it renders, in order, the heading, then a form holding the Email label and input in one <p>, then the button", async () => {
    const { html } = await render({});
    expect(textsOf(html)).toEqual(["Sign in", "Email", "Email me a code"]);
    expect(screenMarkup(html)).toMatch(new RegExp(`<h1\\b[^>]*>Sign in</h1>\\s*${FORM}`));
  });

  it("AC33: with both notices it renders the heading, the limited notice, the expired notice, then the form — each notice a <p role=\"alert\">", async () => {
    const { html } = await render({ limited: "5", error: "expired" });
    expect(textsOf(html)).toEqual(["Sign in", limited("5"), EXPIRED, "Email", "Email me a code"]);
    expect(screenMarkup(html)).toMatch(
      new RegExp(`<h1\\b[^>]*>Sign in</h1>\\s*${alert(limited("5"))}\\s*${alert(EXPIRED)}\\s*${FORM}`),
    );
  });

  it("AC33: the label is for the input, and the input is a required email field named email", async () => {
    const { html } = await render({});
    expect(attributesOf(html, "label")).toEqual([expect.objectContaining({ for: "email" })]);
    const inputs = attributesOf(html, "input");
    expect(inputs).toHaveLength(1);
    expect(inputs[0]).toMatchObject({ id: "email", name: "email", type: "email", autocomplete: "email" });
    expect(inputs[0]).toHaveProperty("required");
    expect(inputs[0]).not.toHaveProperty("placeholder");
    expect(attributesOf(html, "button")).toEqual([expect.objectContaining({ type: "submit" })]);
  });

  it.each(["1", "30", "60"])("AC33: limited=%s shows the limited notice with that many minutes", async (minutes) => {
    const { html } = await render({ limited: minutes });
    expect(textsOf(html)).toEqual(["Sign in", limited(minutes), "Email", "Email me a code"]);
    expect(screenMarkup(html)).toMatch(new RegExp(`<h1\\b[^>]*>Sign in</h1>\\s*${alert(limited(minutes))}\\s*${FORM}`));
  });

  it.each(["0", "61", "1.5", "-1", "abc", ""])("AC33: limited=%j shows no limited notice", async (value) => {
    const { html } = await render({ limited: value });
    expect(textsOf(html)).toEqual(["Sign in", "Email", "Email me a code"]);
    expect(html).not.toContain("Too many");
  });

  it("AC33: error=expired shows the expired notice", async () => {
    const { html } = await render({ error: "expired" });
    expect(textsOf(html)).toEqual(["Sign in", EXPIRED, "Email", "Email me a code"]);
    expect(screenMarkup(html)).toMatch(new RegExp(`<h1\\b[^>]*>Sign in</h1>\\s*${alert(EXPIRED)}\\s*${FORM}`));
  });

  it.each(["invalid", "Expired", ""])("AC33: error=%j shows no expired notice", async (error) => {
    const { html } = await render({ error });
    expect(textsOf(html)).toEqual(["Sign in", "Email", "Email me a code"]);
  });

  it("AC33: the form's action is requestCode", async () => {
    const { element } = await render({});
    const forms = findAll(element, "form");
    expect(forms).toHaveLength(1);
    expect(forms[0]?.props.action).toBe(requestCode);
  });
});
