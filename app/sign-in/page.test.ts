// Issue 9, AC33, and issue 19, AC7: what /sign-in itself does — `SignInForm` in a card, given the page's
// action, its link to Create Account and the search parameters. The form's own words, fields and notices
// are app/sign-in/sign-in-form.test.ts's.
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTranslator } from "@core/i18n.js";
import { en } from "@core/messages/en.js";
import { Card } from "../../components/ui/card";
import { Shell } from "../../components/ui/shell";
import { emptyRequest } from "../next-headers-fake";
import { alertTexts, attributesOf, findAll } from "../screen-test-helpers";
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

describe("AC33 (issue 9) — /sign-in", () => {
  it("AC33: the form's action is requestCode", async () => {
    const { element } = await render({});
    expect(findAll(element, "form").map((form) => form.props.action)).toEqual([requestCode]);
  });

  it("AC33: the page's search parameters reach the form's notices", async () => {
    expect(alertTexts((await render({ error: "expired" })).html)).toEqual([en["signIn.stepExpired"]]);
    expect(alertTexts((await render({ limited: "5" })).html)).toEqual([createTranslator("en")("signIn.limited", { minutes: 5 })]);
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
