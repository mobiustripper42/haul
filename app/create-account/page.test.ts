// Issue 55, AC4, AC10 and AC12, and issue 77, AC7: what /create-account itself does — `AccountForm` in
// a card, given the page's action, its link to sign-in and the search parameters. The form's own words,
// fields, errors, refill and notices are app/create-account/account-form.test.ts's.
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { en } from "@core/messages/en.js";
import { Card } from "../../components/ui/card";
import { Shell } from "../../components/ui/shell";
import { emptyRequest } from "../next-headers-fake";
import { alertTexts, attributesOf, findAll, textsOf } from "../screen-test-helpers";
import { limitedText } from "../sign-in/shared";
import { requestAccountCode } from "./actions";
import CreateAccount from "./page";

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
    throw new Error("/create-account has no reason to read the repository");
  },
  getEmail: () => {
    throw new Error("/create-account has no reason to send email");
  },
  getSessionSecret: () => "test-session-secret-that-is-long-enough-0123456789",
  getSiteUrl: () => "https://members.example.test",
}));

beforeEach(() => {
  request.current = emptyRequest();
});

async function render(searchParams: { limited?: string; error?: string } = {}) {
  const element = await CreateAccount({ searchParams: Promise.resolve(searchParams) });
  return { element, html: renderToStaticMarkup(element) };
}

describe("AC4, AC10, AC12 — /create-account", () => {
  it("AC4: the form's action is requestAccountCode", async () => {
    const { element } = await render();
    expect(findAll(element, "form").map((form) => form.props.action)).toEqual([requestAccountCode]);
  });

  it("AC12: the page's limited reaches the form's notice", async () => {
    const { html } = await render({ limited: "5" });
    expect(alertTexts(html)).toEqual([limitedText("en", 5)]);
  });

  it("AC10: the page's error reaches the form: expired shows its notice", async () => {
    expect(alertTexts((await render({ error: "expired" })).html)).toEqual([en["signIn.stepExpired"]]);
  });

  it("AC4: the page's error reaches the form: a failing field shows its line", async () => {
    expect(textsOf((await render({ error: "phone" })).html)).toContain(en["createAccount.error.phone"]);
  });

  it("AC7 (issue 77): the closing line's link goes to the full /sign-in page", async () => {
    expect(attributesOf((await render()).html, "a").map((link) => link.href)).toEqual(["/sign-in"]);
  });

  it("screen (issue 55): the page is one Card inside the Shell", async () => {
    const { element } = await render();
    const shells = findAll(element, Shell);
    expect(shells).toHaveLength(1);
    expect(findAll(shells[0]?.props.children as ReactNode, Card)).toHaveLength(1);
  });
});
