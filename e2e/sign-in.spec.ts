// Issue 31, AC12-AC16, and issue 22, AC29-AC31: the sign-in round trip in a real browser, on
// desktop and mobile. Each test starts from an emptied e2e database with the `members` seed
// (fixtures.ts). Controls are found by role and the English wording in `en`, never by class or test id.
import type { APIRequestContext, Page } from "@playwright/test";
import { en } from "../src/messages/en.js";
import { expect, outboxCount, test, waitForSignInCode, waitForSignInLink } from "./fixtures";

const ERIC = "eric@ocf.xx";
const STRANGER = "nobody@ocf.xx";

const signedInAs = (email: string) => en["home.signedInAs"].replace("{email}", email);
const signedInPrefix = en["home.signedInAs"].split("{email}")[0]!.trim();

const onPath = (path: string) => (url: URL) => url.pathname === path;

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
  await expect(page.getByRole("heading", { name: en["signIn.codeTitle"] })).toBeVisible();
  const code = await waitForSignInCode(request, ERIC, before);
  expect(code).toMatch(/^\d{6}$/);
  expect(await outboxCount(request, ERIC)).toBe(before + 1);
});

test("AC13: that code, entered in 6-digit code, signs him in on /", async ({ page, request }) => {
  const code = await codeFor(page, request, ERIC);

  await enterCode(page, code);

  await expect(page).toHaveURL(onPath("/"));
  await expect(page.getByText(signedInAs(ERIC))).toBeVisible();
});

test("AC14: a wrong code keeps him on /sign-in/code with the mismatch notice; the right code still signs him in", async ({
  page,
  request,
}) => {
  const code = await codeFor(page, request, ERIC);
  const wrong = code === "000000" ? "111111" : "000000";

  await enterCode(page, wrong);

  await expect(page).toHaveURL(onPath("/sign-in/code"));
  await expect(page.getByText(en["signIn.invalidCode"])).toBeVisible();

  await enterCode(page, code);

  await expect(page).toHaveURL(onPath("/"));
  await expect(page.getByText(signedInAs(ERIC))).toBeVisible();
});

test("AC15: an email no member has gets the same code screen, and the outbox gets nothing for it", async ({
  page,
  request,
}) => {
  const before = await outboxCount(request, STRANGER);

  await askForCode(page, STRANGER);

  await expect(page).toHaveURL(onPath("/sign-in/code"));
  await expect(page.getByRole("heading", { name: en["signIn.codeTitle"] })).toBeVisible();
  await expect(page.getByLabel(en["signIn.codeLabel"])).toBeVisible();

  // A code is sent after the response. A member's request made after the stranger's, once its
  // code has arrived, is the barrier: anything the stranger's request would send has been sent.
  await codeFor(page, request, ERIC);
  expect(await outboxCount(request, STRANGER)).toBe(before);
});

/** Five six-digit codes, none of them `right`. */
const fiveWrong = (right: string): string[] =>
  ["000000", "111111", "222222", "333333", "444444", "555555"].filter((code) => code !== right).slice(0, 5);

/**
 * Enters `code` on a freshly loaded /sign-in/code, which shows no notice, and waits until the
 * mismatch notice comes back. Every wrong guess shows the same notice, so on a page already showing
 * it the notice says nothing about the guess just sent, and the next guess can be typed into a page
 * still in flight and be lost. Loaded fresh, the notice can only be this guess's answer.
 */
async function guessAndSeeNotice(page: Page, code: string): Promise<void> {
  await page.goto("/sign-in/code");
  const notice = page.getByText(en["signIn.invalidCode"]);
  await expect(notice).toHaveCount(0);
  await enterCode(page, code);
  await expect(page).toHaveURL(onPath("/sign-in/code"));
  await expect(notice).toBeVisible();
}

/** Enters each wrong code on /sign-in/code, checking each keeps him there with the mismatch notice. */
async function guessWrong(page: Page, codes: string[]): Promise<void> {
  for (const wrong of codes) await guessAndSeeNotice(page, wrong);
}

/** On /sign-in/link: the heading, the line and the one button, which it presses. */
async function pressSignInOnLinkPage(page: Page): Promise<void> {
  await expect(page).toHaveURL(onPath("/sign-in/link"));
  await expect(page.getByRole("heading", { name: en["signIn.title"] })).toBeVisible();
  await expect(page.getByText(en["signIn.linkPrompt"], { exact: true })).toBeVisible();
  await page.getByRole("button", { name: en["signIn.submitCode"], exact: true }).click();
}

test("AC29: five wrong codes email him a sign-in link; the right code is refused too; the link signs him in. AC30: pressed again, in a fresh browser, the link lands on /sign-in with the link notice", async ({
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

  await guessAndSeeNotice(page, code);

  await page.goto(link);
  await pressSignInOnLinkPage(page);
  await expect(page).toHaveURL(onPath("/"));
  await expect(page.getByText(signedInAs(ERIC))).toBeVisible();

  // AC30
  const fresh = await browser.newContext();
  try {
    const again = await fresh.newPage();
    await again.goto(link);
    await pressSignInOnLinkPage(again);
    await expect(again).toHaveURL(onPath("/sign-in"));
    await expect(again.getByText(en["signIn.linkFailed"])).toBeVisible();
  } finally {
    await fresh.close();
  }
});

test("AC31: an email no member has gets the same notice for five wrong codes, and the outbox gets nothing for it", async ({
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

test("AC16: signed in, Sign out lands him on / with the Sign in link and no Signed in as", async ({ page, request }) => {
  await enterCode(page, await codeFor(page, request, ERIC));
  await expect(page.getByText(signedInAs(ERIC))).toBeVisible();

  await page.getByRole("button", { name: en["home.signOut"] }).click();

  await expect(page).toHaveURL(onPath("/"));
  await expect(page.getByRole("link", { name: en["home.signIn"], exact: true })).toBeVisible();
  await expect(page.getByText(signedInPrefix)).toHaveCount(0);
});
