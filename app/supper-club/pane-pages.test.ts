// Issue 77: the four pane pages, each `await Page(props)` rendered through react-dom/server with
// `next/headers` faked and the composition root handing out an InMemoryRepository. What a width does to
// them (AC3 and AC11 at lg and below) is measured in e2e/supper-club.spec.ts, and the frame (header, left
// column, shell) is app/supper-club/join-page.test.ts's. These hold what each page passes in: which
// actions its forms post to, what reaches the form's notices, where its links go. The forms' own words,
// fields and notices are app/create-account/account-form.test.ts's, app/sign-in/sign-in-form.test.ts's and
// app/sign-in/code-step.test.ts's.
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryRepository } from "@core/adapters/in-memory-repository.js";
import { createTranslator } from "@core/i18n.js";
import { en } from "@core/messages/en.js";
import { signSession } from "@core/sign-in/session.js";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { setLanguage } from "../language-actions";
import { emptyRequest } from "../next-headers-fake";
import { alertTexts, findAll, redirectOf, textsOf } from "../screen-test-helpers";
import { requestPaneAccountCode, requestPaneCode, resendPaneAccountCode, verifyPaneAccountCode, verifyPaneCode } from "./actions";
import PaneCreateAccountCode from "./create-account/code/page";
import PaneCreateAccount from "./create-account/page";
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
  getFarmContactEmail: () => undefined,
}));

type Params = { limited?: string; error?: string };
type Page = (props: { searchParams: Promise<Params> }) => Promise<ReactNode>;

const EMAIL = "ada@example.com";
const EMAIL_COOKIE = "ocf_sign_in_email";
const RETURN_TO = "ocf_return_to";
const PICKS = "/supper-club?size=four&menu=vegan";
const t = createTranslator("en");
const LIMITED = t("signIn.limited", { minutes: 5 });
const EXPIRED = en["signIn.stepExpired"];

const PANES: Array<{ path: string; Pane: Page; actions: unknown[] }> = [
  { path: "/supper-club/create-account", Pane: PaneCreateAccount, actions: [requestPaneAccountCode] },
  { path: "/supper-club/create-account/code", Pane: PaneCreateAccountCode, actions: [verifyPaneAccountCode, resendPaneAccountCode] },
  { path: "/supper-club/sign-in", Pane: PaneSignIn, actions: [requestPaneCode] },
  { path: "/supper-club/sign-in/code", Pane: PaneSignInCode, actions: [verifyPaneCode, requestPaneCode] },
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

/** The buttons and links the page puts in its own card, not the header's or the left column's. */
const buttonsInCard = (element: ReactNode) => findAll(findAll(element, Card).at(-1)?.props.children as ReactNode, Button);

const buttonLabelled = (element: ReactNode, label: string) => buttonsInCard(element).find((button) => button.props.children === label);

const formActions = (element: ReactNode) =>
  findAll(element, "form")
    .map((form) => form.props.action)
    .filter((action) => action !== setLanguage);

describe.each(PANES)("$path", ({ path, Pane, actions }) => {
  it(`AC3: ${path} puts its card in the Join card's place, at the pane's width`, async () => {
    const { element } = await render(Pane);
    expect(findAll(element, Card).at(-1)?.props.width).toBe("pane");
  });

  it(`AC8: ${path}'s forms post to the pane's actions, never the full page's`, async () => {
    expect(formActions((await render(Pane)).element)).toEqual(actions);
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
    const back = buttonLabelled((await render(Pane)).element, en["supperClub.backToChoices"]);
    expect(back?.props.href).toBe(PICKS);
  });

  it.each([
    ["Create Account's", CREATE_CODE],
    ["sign-in's", SIGN_IN_CODE],
  ])("AC6: %s code step does not", async (_step, { Pane }) => {
    expect(buttonLabelled((await render(Pane)).element, en["supperClub.backToChoices"])).toBeUndefined();
  });
});

describe("AC7 — the closing lines switch panes", () => {
  it('AC7: "Already have an account? Sign in" goes to the sign-in pane', async () => {
    expect(buttonLabelled((await render(CREATE.Pane)).element, en["home.signIn"])?.props.href).toBe("/supper-club/sign-in");
  });

  it('AC7: "No account yet? Create an account" goes to the Create Account pane', async () => {
    expect(buttonLabelled((await render(SIGN_IN.Pane)).element, en["supperClub.createAccount"])?.props.href).toBe(
      "/supper-club/create-account",
    );
  });
});

describe("AC8, AC11 — failures show in the pane: the page's search parameters reach the form", () => {
  it("AC8: the details pane's limited and expired reach its notices", async () => {
    expect(alertTexts((await render(CREATE.Pane, { limited: "5", error: "expired" })).html)).toEqual([LIMITED, EXPIRED]);
  });

  it("AC8: the details pane's failing field reaches its error line", async () => {
    expect(textsOf((await render(CREATE.Pane, { error: "email" })).html)).toContain(en["createAccount.error.email"]);
  });

  it("AC8: the email pane's limited and expired reach its notices", async () => {
    expect(alertTexts((await render(SIGN_IN.Pane, { limited: "5", error: "expired" })).html)).toEqual([LIMITED, EXPIRED]);
  });

  it.each([
    ["Create Account's", CREATE_CODE],
    ["sign-in's", SIGN_IN_CODE],
  ])("AC8: %s code step shows a wrong code", async (_step, { Pane }) => {
    expect(alertTexts((await render(Pane, { error: "invalid" })).html)).toEqual([en["signIn.invalidCode"]]);
  });

  it.each([
    ["Create Account's", CREATE_CODE, "/supper-club/create-account"],
    ["sign-in's", SIGN_IN_CODE, "/supper-club/sign-in"],
  ])("AC8: %s code step's back link stays in the pane", async (_step, { Pane }, start) => {
    expect(buttonLabelled((await render(Pane)).element, en["signIn.differentEmail"])?.props.href).toBe(start);
  });

  it.each([
    ["Create Account's", CREATE_CODE, "/supper-club/create-account?error=expired"],
    ["sign-in's", SIGN_IN_CODE, "/supper-club/sign-in?error=expired"],
  ])("AC8: %s code step with the email cookie gone redirects to its pane, expired", async (_step, { Pane }, to) => {
    request.current.cookies = {};
    expect(await redirectOf(Pane({ searchParams: Promise.resolve({}) }))).toBe(to);
  });
});
