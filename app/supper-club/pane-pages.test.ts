// Issue 77: the four pane pages, each `await Page(props)` rendered through react-dom/server with
// `next/headers` faked and the composition root handing out an InMemoryRepository. What a width does to
// them (AC3 and AC11 at lg and below) is measured in e2e/supper-club.spec.ts; these hold what each page
// puts where, and that a pane is the full page it stands in for.
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryRepository } from "@core/adapters/in-memory-repository.js";
import { signSession } from "@core/sign-in/session.js";
import { Card } from "../../components/ui/card";
import { setLanguage } from "../language-actions";
import { emptyRequest } from "../next-headers-fake";
import { attributesOf, findAll, normalMarkup, redirectOf, screenMarkup, textsOf } from "../screen-test-helpers";
import FullCreateAccountCode from "../create-account/code/page";
import FullCreateAccount from "../create-account/page";
import FullSignInCode from "../sign-in/code/page";
import FullSignIn from "../sign-in/page";
import { requestPaneAccountCode, requestPaneCode, resendPaneAccountCode, verifyPaneAccountCode, verifyPaneCode } from "./actions";
import PaneCreateAccountCode from "./create-account/code/page";
import PaneCreateAccount from "./create-account/page";
import SupperClub from "./page";
import PaneSignInCode from "./sign-in/code/page";
import PaneSignIn from "./sign-in/page";

const request = vi.hoisted(() => ({ current: { cookies: {}, headers: {}, sets: [] } as import("../next-headers-fake").RequestState }));
const services = vi.hoisted(() => ({
  repo: undefined as unknown as import("@core/adapters/in-memory-repository.js").InMemoryRepository,
  secret: "test-session-secret-that-is-long-enough-0123456789",
}));
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
  getRepository: () => services.repo,
  getEmail: () => {
    throw new Error("rendering a pane has no reason to send email");
  },
  getSessionSecret: () => services.secret,
  getSiteUrl: () => "https://members.example.test",
}));

type Params = { limited?: string; error?: string };
type Page = (props: { searchParams: Promise<Params> }) => Promise<ReactNode>;

const EMAIL = "ada@example.com";
const EMAIL_COOKIE = "ocf_sign_in_email";
const RETURN_TO = "ocf_return_to";
const PICKS = "/supper-club?size=four&menu=vegan";
const BACK = "Back to your choices";
const JOIN_TITLE = "Join the Supper Club";
const LIMITED = "Too many sign-in requests from this network. Try again in 5 min.";
const EXPIRED = "That sign-in step expired. Enter your email to get a new code.";
const INVALID =
  "That code didn't match, or it has expired. Check it and try again, or ask for a new one. After 5 wrong tries, check your email for a sign-in link.";

const PANES: Array<{
  path: string;
  Pane: Page;
  Full: Page;
  actions: unknown[];
  states: Params[];
}> = [
  {
    path: "/supper-club/create-account",
    Pane: PaneCreateAccount,
    Full: FullCreateAccount,
    actions: [requestPaneAccountCode],
    states: [{}, { limited: "5" }, { error: "expired" }, { error: "firstName,phone" }],
  },
  {
    path: "/supper-club/create-account/code",
    Pane: PaneCreateAccountCode,
    Full: FullCreateAccountCode,
    actions: [verifyPaneAccountCode, resendPaneAccountCode],
    states: [{}, { error: "invalid" }],
  },
  {
    path: "/supper-club/sign-in",
    Pane: PaneSignIn,
    Full: FullSignIn,
    actions: [requestPaneCode],
    states: [{}, { limited: "5", error: "expired" }],
  },
  {
    path: "/supper-club/sign-in/code",
    Pane: PaneSignInCode,
    Full: FullSignInCode,
    actions: [verifyPaneCode, requestPaneCode],
    states: [{}, { error: "invalid" }],
  },
];
const CREATE = PANES[0]!;
const CREATE_CODE = PANES[1]!;
const SIGN_IN = PANES[2]!;
const SIGN_IN_CODE = PANES[3]!;

beforeEach(() => {
  request.current = emptyRequest();
  request.current.cookies = { [EMAIL_COOKIE]: EMAIL };
  services.repo = new InMemoryRepository();
  services.repo.addProduct({
    name: "Supper Club",
    cap: 50,
    firstPickupDate: "2027-01-03",
    cutoffWeekday: 1,
    cutoffTime: "24:00:00",
    optionTypes: [{ name: "How many people?", position: 1, options: [{ name: "2 people", priceCents: 5000, position: 1 }] }],
  });
});

const signIn = async () => {
  const member = await services.repo.createMember({ email: EMAIL });
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  request.current.cookies.ocf_session = signSession({ subjectId: member.id, expiresAt }, services.secret);
};

const render = async (Page: Page, searchParams: Params = {}) => {
  const element = await Page({ searchParams: Promise.resolve(searchParams) });
  return { element, html: renderToStaticMarkup(element) };
};

/** What sits inside the pane's card, or the full page's. */
const cardOf = (html: string, cls: "card" | "card-pane") =>
  new RegExp(`<section\\b[^>]*class="[^"]*(?<![\\w-])${cls}(?![\\w-])[^"]*"[^>]*>([\\s\\S]*)</section>`).exec(html)?.[1] ?? "";

/** The left column's inside on the Supper Club page itself: what sits before its Join card. */
const supperClubLeftColumn = async (): Promise<string> => {
  const html = normalMarkup(renderToStaticMarkup(await SupperClub({ searchParams: Promise.resolve({}) })));
  const inside = new RegExp(`<main\\b[^>]*>\\s*<section\\b[^>]*>([\\s\\S]*)</section>\\s*<section\\b[^>]*>\\s*<section\\b[^>]*>\\s*<p\\b[^>]*>${JOIN_TITLE}`).exec(html);
  return inside?.[1] ?? "";
};

const formActions = (element: ReactNode) =>
  findAll(element, "form")
    .map((form) => form.props.action)
    .filter((action) => action !== setLanguage);

describe.each(PANES)("$path", ({ path, Pane, Full, actions, states }) => {
  it(`AC3: ${path} shows the Supper Club left column unchanged, then the pane in place of the Join card`, async () => {
    const left = await supperClubLeftColumn();
    expect(left).toContain("Weekly meals from the farm kitchen");
    const { element, html } = await render(Pane);
    const pane = normalMarkup(html);
    expect(pane).toContain(left);
    expect(pane).not.toContain(JOIN_TITLE);
    expect(findAll(element, Card).map((card) => card.props.width)).toEqual(["fill", "pane"]);
    expect(pane.indexOf(left)).toBeLessThan(pane.indexOf("card-pane"));
  });

  it(`AC8: ${path}'s forms post to the pane's actions, never the full page's`, async () => {
    expect(formActions((await render(Pane)).element)).toEqual(actions);
  });

  it.each(states)(`AC11: ${path} with %j shows what the full page shows, but for the back link`, async (state) => {
    const pane = textsOf(cardOf((await render(Pane, state)).html, "card-pane")).filter((text) => text !== BACK);
    const full = textsOf(cardOf((await render(Full, state)).html, "card"));
    expect(full).not.toEqual([]);
    expect(pane).toEqual(full);
  });

  it(`AC11: ${path}'s inputs match the full page's`, async () => {
    const pane = attributesOf(cardOf((await render(Pane)).html, "card-pane"), "input");
    const full = attributesOf(cardOf((await render(Full)).html, "card"), "input");
    expect(full).not.toEqual([]);
    expect(pane).toEqual(full);
  });

  it(`AC12: a signed-in member on ${path} is redirected to /supper-club`, async () => {
    await signIn();
    expect(await redirectOf(Pane({ searchParams: Promise.resolve({}) }))).toBe("/supper-club");
  });
});

describe('AC6 — "Back to your choices"', () => {
  it.each([
    ["the details step", CREATE],
    ["the email step", SIGN_IN],
  ])("AC6: %s shows it, going to the return path in the cookie", async (_step, { Pane }) => {
    request.current.cookies[RETURN_TO] = PICKS;
    const { html } = await render(Pane);
    expect(screenMarkup(cardOf(html, "card-pane"))).toMatch(new RegExp(`<a\\b[^>]*href="${PICKS.replace("?", "\\?")}"[^>]*>${BACK}</a>`));
  });

  it("AC6: the details step shows it after the notices, above the heading", async () => {
    const texts = textsOf(cardOf((await render(CREATE.Pane, { limited: "5", error: "expired" })).html, "card-pane"));
    expect(texts.slice(0, 4)).toEqual([LIMITED, EXPIRED, BACK, "Create your account"]);
  });

  it("AC6: the email step shows it above the heading, the notices under the heading", async () => {
    const texts = textsOf(cardOf((await render(SIGN_IN.Pane, { limited: "5", error: "expired" })).html, "card-pane"));
    expect(texts.slice(0, 4)).toEqual([BACK, "Sign in", LIMITED, EXPIRED]);
  });

  it.each([
    ["Create Account's", CREATE_CODE],
    ["sign-in's", SIGN_IN_CODE],
  ])("AC6: %s code step does not", async (_step, { Pane }) => {
    const texts = textsOf(cardOf((await render(Pane)).html, "card-pane"));
    expect(texts).toContain("Use a different email");
    expect(texts).not.toContain(BACK);
  });
});

describe("AC7 — the closing lines switch panes", () => {
  const linkTo = (html: string, text: string) =>
    new RegExp(`<a\\b[^>]*href="([^"]*)"[^>]*>${text}</a>`).exec(screenMarkup(cardOf(html, "card-pane")))?.[1];

  it('AC7: "Already have an account? Sign in" goes to the sign-in pane', async () => {
    expect(linkTo((await render(CREATE.Pane)).html, "Sign in")).toBe("/supper-club/sign-in");
  });

  it('AC7: "No account yet? Create an account" goes to the Create Account pane', async () => {
    expect(linkTo((await render(SIGN_IN.Pane)).html, "Create an account")).toBe("/supper-club/create-account");
  });
});

describe("AC10 — the sign-in pane's closing line", () => {
  it('AC10: "No account yet? Create an account" closes the card, under the form', async () => {
    expect(textsOf(cardOf((await render(SIGN_IN.Pane)).html, "card-pane")).slice(-4)).toEqual([
      "Email",
      "Email me a code",
      "No account yet?",
      "Create an account",
    ]);
  });
});

describe("AC8 — failures show in the pane", () => {
  it("AC8: the details pane shows a field's error, with the form refilled from the draft", async () => {
    request.current.cookies.ocf_account_draft = JSON.stringify({ firstName: "Ada", email: "ada@example" });
    const { html } = await render(CREATE.Pane, { error: "email" });
    expect(textsOf(html)).toContain("Enter a full email address, like name@example.com.");
    expect(attributesOf(html, "input").find((input) => input.name === "firstName")?.value).toBe("Ada");
  });

  it("AC8: the email pane shows limited and expired", async () => {
    const texts = textsOf((await render(SIGN_IN.Pane, { limited: "5", error: "expired" })).html);
    expect(texts).toEqual(expect.arrayContaining([LIMITED, EXPIRED]));
  });

  it.each([
    ["Create Account's", CREATE_CODE, "/supper-club/create-account"],
    ["sign-in's", SIGN_IN_CODE, "/supper-club/sign-in"],
  ])("AC8: %s code step shows a wrong code, and its back link stays in the pane", async (_step, { Pane }, start) => {
    const { html } = await render(Pane, { error: "invalid" });
    expect(textsOf(html)).toContain(INVALID);
    expect(attributesOf(cardOf(html, "card-pane"), "a").map((link) => link.href)).toEqual([start]);
  });

  it.each([
    ["Create Account's", CREATE_CODE, "/supper-club/create-account?error=expired"],
    ["sign-in's", SIGN_IN_CODE, "/supper-club/sign-in?error=expired"],
  ])("AC8: %s code step with the email cookie gone redirects to its pane, expired", async (_step, { Pane }, to) => {
    request.current.cookies = {};
    expect(await redirectOf(Pane({ searchParams: Promise.resolve({}) }))).toBe(to);
  });
});
