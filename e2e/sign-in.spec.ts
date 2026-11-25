// Issue 31, AC12-AC16, and issue 22, AC29-AC31: the sign-in round trip in a real browser, on
// desktop and mobile. Each test starts from an emptied e2e database with the `members` seed
// (fixtures.ts). Controls are found by role and the English wording in `en`, never by class or test id; what
// a screen says is Vitest's, so a state here is read from the URL.
// Issue 97: "signed in" is the header's Sign out button, where the home page's "Signed in as" line was.
// Issue 260, AC10: signing in lands on /account, and a member with no Supper Club subscription, as ERIC is, stays there.
import type { APIRequestContext, Page } from "@playwright/test";
import { en } from "../src/messages/en.js";
import { expect, expectOnAccount, expectSignedIn, headerSignOut, outboxCount, signOut, test, waitForSignInCode, waitForSignInLink } from "./fixtures";

const ERIC = "eric@ocf.xx";
const STRANGER = "nobody@ocf.xx";

const onPath = (path: string) => (url: URL) => url.pathname === path;
/** /sign-in/code after a wrong code: verifyCode's redirect (app/sign-in/shared.ts). */
const refused = (url: URL) => url.pathname === "/sign-in/code" && url.searchParams.get("error") === "invalid";

/** Enters `email` on /sign-in and presses "Email me a code". */
async function askForCode(page: Page, email: string): Promise<void> {
  await page.goto("/sign-in");
  await page.getByLabel(en["signIn.emailLabel"]).fill(email);
  await page.getByRole("button", { name: en["signIn.sendCode"] }).click();
}

/** Asks for a code for `email` and returns the one the outbox receives. */
async function codeFor(page: Page, request: APIRequestContext, email: string): Promise<string> {
  const before = await outboxCount(request, email);
  await askForCode(page, email);
  await expect(page).toHaveURL(onPath("/sign-in/code"));
  return waitForSignInCode(request, email, before);
}

async function enterCode(page: Page, code: string): Promise<void> {
  await page.getByLabel(en["signIn.codeLabel"]).fill(code);
  await page.getByRole("button", { name: en["signIn.submitCode"], exact: true }).click();
}

test("AC12: a member's email leads to Enter your code, and the outbox gets him a 6-digit code", async ({ page, request }) => {
  const before = await outboxCount(request, ERIC);

  await askForCode(page, ERIC);

  await expect(page).toHaveURL(onPath("/sign-in/code"));
  const code = await waitForSignInCode(request, ERIC, before);
  expect(code).toMatch(/^\d{6}$/);
  expect(await outboxCount(request, ERIC)).toBe(before + 1);
});

test("AC13, AC10 (issue 260): that code, entered in 6-digit code, signs him in, and he ends on /account with the header's Sign out", async ({ page, request }) => {
  const code = await codeFor(page, request, ERIC);

  await enterCode(page, code);

  await expectOnAccount(page);
});

test("AC14: a wrong code keeps him on /sign-in/code, refused (error=invalid); the right code still signs him in", async ({
  page,
  request,
}) => {
  const code = await codeFor(page, request, ERIC);
  const wrong = code === "000000" ? "111111" : "000000";

  await enterCode(page, wrong);

  await expect(page).toHaveURL(refused);

  await enterCode(page, code);

  await expectOnAccount(page);
});

test("AC15: an email no member has gets the same code screen, and the outbox gets nothing for it", async ({
  page,
  request,
}) => {
  const before = await outboxCount(request, STRANGER);

  await askForCode(page, STRANGER);

  await expect(page).toHaveURL(onPath("/sign-in/code"));
  await page.getByLabel(en["signIn.codeLabel"]).fill("000000");

  // A code is sent after the response. A member's request made after the stranger's, once its
  // code has arrived, is the barrier: anything the stranger's request would send has been sent.
  await codeFor(page, request, ERIC);
  expect(await outboxCount(request, STRANGER)).toBe(before);
});

/** Five six-digit codes, none of them `right`. */
const fiveWrong = (right: string): string[] =>
  ["000000", "111111", "222222", "333333", "444444", "555555"].filter((code) => code !== right).slice(0, 5);

/**
 * Enters `code` on a freshly loaded /sign-in/code, with no error in its URL, and waits until the
 * refusal's redirect brings back error=invalid. Every wrong guess lands on the same URL, so on a page
 * already there the URL says nothing about the guess just sent, and the next guess can be typed into a
 * page still in flight and be lost. Loaded fresh, the URL can only be this guess's answer.
 */
async function guessAndSeeRefused(page: Page, code: string): Promise<void> {
  await page.goto("/sign-in/code");
  await expect(page).toHaveURL((url) => url.pathname === "/sign-in/code" && !url.searchParams.has("error"));
  await enterCode(page, code);
  await expect(page).toHaveURL(refused);
}

/** Enters each wrong code on /sign-in/code, checking each is refused. */
async function guessWrong(page: Page, codes: string[]): Promise<void> {
  for (const wrong of codes) await guessAndSeeRefused(page, wrong);
}

/** On /sign-in/link: presses the one button. */
async function pressSignInOnLinkPage(page: Page): Promise<void> {
  await expect(page).toHaveURL(onPath("/sign-in/link"));
  await page.getByRole("button", { name: en["signIn.submitCode"], exact: true }).click();
}

test("AC29: five wrong codes email him a sign-in link; the right code is refused too; the link signs him in, and (AC10, issue 260) he ends on /account. AC30: pressed again, in a fresh browser, the link lands on /sign-in with error=link", async ({
  page,
  request,
  browser,
}) => {
  const before = await outboxCount(request, ERIC);
  await askForCode(page, ERIC);
  await expect(page).toHaveURL(onPath("/sign-in/code"));
  const code = await waitForSignInCode(request, ERIC, before);

  // AC29
  await guessWrong(page, fiveWrong(code));

  const link = await waitForSignInLink(request, ERIC, before + 1);
  expect(link).toMatch(/^http:\/\/localhost:4100\/sign-in\/link\?token=[A-Za-z0-9_-]+$/);

  await guessAndSeeRefused(page, code);

  await page.goto(link);
  await pressSignInOnLinkPage(page);
  await expectOnAccount(page);

  // AC30
  const fresh = await browser.newContext();
  try {
    const again = await fresh.newPage();
    await again.goto(link);
    await pressSignInOnLinkPage(again);
    await expect(again).toHaveURL((url) => url.pathname === "/sign-in" && url.searchParams.get("error") === "link");
  } finally {
    await fresh.close();
  }
});

test("AC31: an email no member has gets the same refusal for five wrong codes, and the outbox gets nothing for it", async ({
  page,
  request,
}) => {
  const before = await outboxCount(request, STRANGER);

  await askForCode(page, STRANGER);
  await expect(page).toHaveURL(onPath("/sign-in/code"));
  await guessWrong(page, fiveWrong(""));

  // Anything the stranger's guesses would send goes after their responses. A member's request made
  // after them, once its code has arrived, is the barrier.
  await codeFor(page, request, ERIC);
  expect(await outboxCount(request, STRANGER)).toBe(before);
});

test("AC16, AC4 (issue 97): signed in, the header's Sign out ends the session and lands him on /supper-club, signed out: the header's Sign in, and no Sign out, there or on the next page", async ({ page, request }) => {
  await enterCode(page, await codeFor(page, request, ERIC));
  await expectSignedIn(page);

  await signOut(page);

  await expect(page).toHaveURL(onPath("/supper-club"));
  await expect(page.getByRole("banner").locator('a[href="/supper-club/sign-in"]')).toBeVisible();
  await expect(headerSignOut(page)).toHaveCount(0);

  // /terms shows Sign out to anyone signed in (AC6), so its absence there is the session gone.
  await page.goto("/terms");
  await expect(page).toHaveURL(onPath("/terms"));
  await expect(page.getByRole("banner")).toBeVisible();
  await expect(headerSignOut(page)).toHaveCount(0);
});

// Issue 101, AC2: "Send a new code" posts and redirects, so only a browser shows the page coming back with
// sent=1; that sent=1 shows the notice is Vitest's (app/sign-in/code-step.test.ts).
test("AC2 (issue 101): Send a new code brings /sign-in/code back with sent=1", async ({ page }) => {
  await askForCode(page, ERIC);
  await expect(page).toHaveURL((url) => url.pathname === "/sign-in/code" && !url.searchParams.has("sent"));

  await page.getByRole("button", { name: en["signIn.resend"] }).click();

  await expect(page).toHaveURL((url) => url.pathname === "/sign-in/code" && url.searchParams.get("sent") === "1");
});
