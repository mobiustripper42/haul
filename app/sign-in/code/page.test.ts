// Issue 9, AC34, and issue 19, AC8: what /sign-in/code itself does — `SignInCodeStep` in a card, given
// sign-in's pages, its two actions and the search parameters. The step's words, field and buttons are
// app/sign-in/code-step.test.ts's.
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { en } from "@core/messages/en.js";
import { Card } from "../../../components/ui/card";
import { Notice } from "../../../components/ui/notice";
import { Shell } from "../../../components/ui/shell";
import { emptyRequest } from "../../next-headers-fake";
import { alertTexts, attributesOf, findAll, redirectOf } from "../../screen-test-helpers";
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

beforeEach(() => {
  request.current = emptyRequest();
  request.current.cookies = { ocf_sign_in_email: "Ada@Example.com" };
});

async function render(searchParams: { error?: string; sent?: string }) {
  const element = await SignInCode({ searchParams: Promise.resolve(searchParams) });
  return { element, html: renderToStaticMarkup(element) };
}

describe("AC34 (issue 9) — /sign-in/code", () => {
  it("AC34: without the ocf_sign_in_email cookie it redirects to /sign-in?error=expired", async () => {
    request.current.cookies = {};
    expect(await redirectOf(SignInCode({ searchParams: Promise.resolve({}) }))).toBe("/sign-in?error=expired");
  });

  it("AC34: the first form's action is verifyCode, the second's requestCode", async () => {
    const { element } = await render({});
    expect(findAll(element, "form").map((form) => form.props.action)).toEqual([verifyCode, requestCode]);
  });

  it("AC34: the link goes to /sign-in", async () => {
    expect(attributesOf((await render({})).html, "a").map((link) => link.href)).toEqual(["/sign-in"]);
  });

  it("AC34: the page's search parameters reach the step's notice", async () => {
    expect(alertTexts((await render({ error: "invalid" })).html)).toEqual([en["signIn.invalidCode"]]);
  });
});

// Issue 101, AC2: the notice's words and rules are app/sign-in/code-step.test.ts's; here, that the page hands `sent` on.
describe("AC2 (issue 101) — /sign-in/code after a resend", () => {
  it("AC2: the page's sent=1 reaches the step: it shows the resent notice, and without it none", async () => {
    const icons = async (searchParams: { sent?: string }) => findAll((await render(searchParams)).element, Notice).map((notice) => notice.props.icon);
    expect(await icons({ sent: "1" })).toEqual(["check"]);
    expect(await icons({})).toEqual([]);
  });
});

describe("AC8 (issue 19) — /sign-in/code in its card", () => {
  it("AC8: the page is one Card in the Shell", async () => {
    const { element } = await render({});
    expect(findAll(element, Shell)).toHaveLength(1);
    expect(findAll(element, Card)).toHaveLength(1);
  });
});
