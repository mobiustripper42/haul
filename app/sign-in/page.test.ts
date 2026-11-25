// Issue 9, AC33, and issue 19, AC7: what /sign-in itself does — `SignInForm` in a card, given the page's
// action, its link to Create Account and the search parameters. The form's own words, fields and notices
// are app/sign-in/sign-in-form.test.ts's. Issue 219, AC9: a signed-in visitor is sent to /account. The session is
// faked (`getSignedInMember`, signed out unless a test signs in); who counts as signed in is app/session.test.ts's.
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { en } from "@core/messages/en.js";
import { Card } from "../../components/ui/card";
import { Shell } from "../../components/ui/shell";
import { emptyRequest } from "../next-headers-fake";
import { alertTexts, attributesOf, findAll, redirectOf } from "../screen-test-helpers";
import { requestCode } from "./actions";
import SignIn from "./page";

const request = vi.hoisted(() => ({ current: { cookies: {}, headers: {}, sets: [] } as import("../next-headers-fake").RequestState }));
const session = vi.hoisted(() => ({ member: null as null | import("@core/members.js").Member }));

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
vi.mock("../session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../session")>()),
  getSignedInMember: async () => session.member,
}));

beforeEach(() => {
  request.current = emptyRequest();
  session.member = null;
});

async function render(searchParams: { limited?: string; error?: string }) {
  const element = await SignIn({ searchParams: Promise.resolve(searchParams) });
  return { element, html: renderToStaticMarkup(element) };
}

describe("AC33 (issue 9) — /sign-in", () => {
  it("AC33: the form's action is requestCode", async () => {
    const { element } = await render({});
    expect(findAll(element, "form").map((form) => form.props.action)).toEqual([requestCode]);
  });

  it("AC33: the page's search parameters reach the form's notices", async () => {
    expect(alertTexts((await render({ error: "expired" })).html)).toEqual([en["signIn.stepExpired"]]);
    const limited = alertTexts((await render({ limited: "5" })).html);
    expect(limited).toHaveLength(1);
    expect(limited[0]).toMatch(/\b5\b/);
  });

  it("AC10, AC7 (issue 77): the closing line's link goes to the full /create-account page", async () => {
    expect(attributesOf((await render({})).html, "a").map((link) => link.href)).toEqual(["/create-account"]);
  });
});

describe("AC7 (issue 19) — /sign-in in its card", () => {
  it("AC7: the page is one Card in the Shell", async () => {
    const { element } = await render({});
    expect(findAll(element, Shell)).toHaveLength(1);
    expect(findAll(element, Card)).toHaveLength(1);
  });
});

// A signed-out visitor's form is AC33 and AC7 above, run signed out.
describe("AC9 (issue 219) — /sign-in while signed in", () => {
  /** A signed-in member, with `role`; whether they hold a subscription is no matter here (requireAccount's, on /account). */
  const member = (role: "member" | "admin"): import("@core/members.js").Member => ({
    id: "00000000-0000-4000-8000-000000000001",
    email: "ada@example.com",
    language: "en",
    role,
    createdAt: new Date("2026-12-01T17:00:00.000Z"),
    firstName: "Ada",
    lastName: "Lovelace",
    phone: null,
    emailConfirmedAt: new Date("2026-12-01T17:00:00.000Z"),
    squareCustomerId: null,
    menuEmails: true,
  });

  it.each(["member", "admin"] as const)("AC9: a signed-in %s is redirected to /account", async (role) => {
    session.member = member(role);
    await expect(redirectOf(SignIn({ searchParams: Promise.resolve({}) }))).resolves.toBe("/account");
  });
});
