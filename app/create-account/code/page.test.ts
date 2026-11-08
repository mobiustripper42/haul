// Issue 55, AC5, AC8, AC10 and AC16: what /create-account/code itself does — `AccountCodeStep` in a
// card, given Create Account's pages, its two actions and the search parameters. The step's words, field
// and buttons are app/sign-in/code-step.test.ts's.
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { en } from "@core/messages/en.js";
import { Card } from "../../../components/ui/card";
import { Shell } from "../../../components/ui/shell";
import { emptyRequest } from "../../next-headers-fake";
import { alertTexts, attributesOf, findAll, redirectOf } from "../../screen-test-helpers";
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

beforeEach(() => {
  request.current = emptyRequest();
  request.current.cookies = { ocf_sign_in_email: "ada@example.com" };
});

async function render(searchParams: { error?: string } = {}) {
  const element = await CreateAccountCode({ searchParams: Promise.resolve(searchParams) });
  return { element, html: renderToStaticMarkup(element) };
}

describe("AC5, AC8, AC10, AC16 — /create-account/code", () => {
  it("AC5: without the email cookie it redirects to /create-account?error=expired", async () => {
    request.current.cookies = {};
    expect(await redirectOf(CreateAccountCode({ searchParams: Promise.resolve({}) }))).toBe("/create-account?error=expired");
  });

  it("AC5: \"Use a different email\" goes to /create-account", async () => {
    expect(attributesOf((await render()).html, "a").map((link) => link.href)).toEqual(["/create-account"]);
  });

  it("AC8, AC16: the first form's action is verifyAccountCode, the second's resendAccountCode", async () => {
    const { element } = await render();
    expect(findAll(element, "form").map((form) => form.props.action)).toEqual([verifyAccountCode, resendAccountCode]);
  });

  it("AC10: the page's error reaches the step's notice", async () => {
    expect(alertTexts((await render({ error: "invalid" })).html)).toEqual([en["signIn.invalidCode"]]);
  });

  it("screen (issue 55): the page is one Card inside the Shell", async () => {
    const { element } = await render();
    const shells = findAll(element, Shell);
    expect(shells).toHaveLength(1);
    expect(findAll(shells[0]?.props.children as ReactNode, Card)).toHaveLength(1);
  });
});
