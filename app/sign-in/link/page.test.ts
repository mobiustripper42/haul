// Issue 22, AC21: /sign-in/link, `await SignInLink(props)` rendered through react-dom/server with
// `next/headers` faked and `redirect` throwing, as the code page's test renders it. The repository
// and the email port throw if touched: rendering the page reads and writes nothing in the store.
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyRequest } from "../../next-headers-fake";
import { attributesOf, escapeRegExp, findAll, redirectOf, screenMarkup, textsOf } from "../../screen-test-helpers";
import { signInWithLink } from "../actions";
import SignInLink from "./page";

const request = vi.hoisted(() => ({ current: { cookies: {}, headers: {}, sets: [] } as import("../../next-headers-fake").RequestState }));
const touched = vi.hoisted(() => ({ repository: 0, email: 0 }));

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
    touched.repository++;
    throw new Error("/sign-in/link has no reason to read the repository");
  },
  getEmail: () => {
    touched.email++;
    throw new Error("/sign-in/link has no reason to send email");
  },
  getSessionSecret: () => "test-session-secret-that-is-long-enough-0123456789",
  getSiteUrl: () => "https://members.example.test",
}));

const TOKEN = "Lk3vQ9_xR2-mN8pT4wY6zA1bC5dE7fG0hJ2kL4nP6qS";
const PROMPT = "Press the button to finish signing in.";

beforeEach(() => {
  request.current = emptyRequest();
  touched.repository = 0;
  touched.email = 0;
});

async function render(searchParams: { token?: string }) {
  const element = await SignInLink({ searchParams: Promise.resolve(searchParams) });
  return { element, html: renderToStaticMarkup(element) };
}

const classesOf = (attributes: Record<string, string> | undefined): string[] =>
  (attributes?.class ?? "").split(/\s+/).filter(Boolean);

describe("AC21 (issue 22) — /sign-in/link", () => {
  it("AC21: with a token it renders, in order, the heading Sign in, the line, then a form with one button Sign in — in one card, the only thing in <main>", async () => {
    const { html } = await render({ token: TOKEN });
    expect(textsOf(html)).toEqual(["Sign in", PROMPT, "Sign in"]);
    expect(screenMarkup(html).trim()).toMatch(
      new RegExp(
        "^<main\\b[^>]*>\\s*<section\\b[^>]*>\\s*" +
          "<h1\\b[^>]*>Sign in</h1>\\s*" +
          `<p\\b[^>]*>${escapeRegExp(PROMPT)}</p>\\s*` +
          "<form\\b[^>]*>(?:(?!</form>)[\\s\\S])*<button\\b[^>]*>Sign in</button>(?:(?!</form>)[\\s\\S])*</form>\\s*" +
          "</section>\\s*</main>$",
      ),
    );
  });

  it("AC21: the form's action is signInWithLink, and it holds the token in its one input, a hidden field named token", async () => {
    const { element, html } = await render({ token: TOKEN });
    const forms = findAll(element, "form");
    expect(forms).toHaveLength(1);
    expect(forms[0]?.props.action).toBe(signInWithLink);
    expect(attributesOf(html, "input")).toEqual([expect.objectContaining({ type: "hidden", name: "token", value: TOKEN })]);
  });

  it("AC21: its one button submits and is primary and full width", async () => {
    const { html } = await render({ token: TOKEN });
    const buttons = attributesOf(html, "button");
    expect(buttons).toEqual([expect.objectContaining({ type: "submit" })]);
    expect(classesOf(buttons[0])).toEqual(expect.arrayContaining(["btn-primary", "w-full"]));
  });

  it("AC21: it sits on page-narrow in a card, its heading in font-display text-heading text-teal, as the code page's does", async () => {
    const { html } = await render({ token: TOKEN });
    expect(classesOf(attributesOf(html, "main")[0])).toContain("page-narrow");
    const sections = attributesOf(html, "section");
    expect(sections).toHaveLength(1);
    expect(classesOf(sections[0])).toContain("card");
    expect(classesOf(attributesOf(html, "h1")[0])).toEqual(
      expect.arrayContaining(["font-display", "text-heading", "text-teal"]),
    );
  });

  it("AC21: rendering it touches neither the repository nor the email port", async () => {
    await render({ token: TOKEN });
    expect(touched).toEqual({ repository: 0, email: 0 });
  });

  it.each([
    ["no token", {}],
    ["an empty token", { token: "" }],
  ])("AC21: with %s it redirects to /sign-in?error=link", async (_what, searchParams: { token?: string }) => {
    await expect(redirectOf(SignInLink({ searchParams: Promise.resolve(searchParams) }))).resolves.toBe(
      "/sign-in?error=link",
    );
  });
});
