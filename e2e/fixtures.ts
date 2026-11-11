import { expect, test as base } from "@playwright/test";
import type { APIRequestContext, Page } from "@playwright/test";
import { resetDev } from "../db/reset-dev.js";
import { runSeed } from "../db/seed.js";
import { en } from "../src/messages/en.js";
import { e2eDatabaseUrl } from "./database";

export { expect };

/**
 * `test`, with every test starting from an emptied e2e database with the `members` and `supper-club`
 * seeds. The Supper Club's row is there because `/` redirects to `/supper-club` (issue 97), which 500s
 * without it, so every landing after sign-in, sign-out or a turned-away `/admin` needs it.
 */
export const test = base.extend<{ freshDatabase: void }>({
  freshDatabase: [
    // eslint-disable-next-line no-empty-pattern -- Playwright reads a fixture's needs from a destructured first argument, and this needs none.
    async ({}, use) => {
      const url = e2eDatabaseUrl();
      await resetDev(url);
      await runSeed("members", url);
      await runSeed("supper-club", url);
      await use();
    },
    { auto: true },
  ],
});

type OutboxMessage = { to: string; subject: string; text: string };

async function outbox(request: APIRequestContext, email: string): Promise<OutboxMessage[]> {
  const response = await request.get("/dev/outbox", { params: { to: email } });
  expect(response.status()).toBe(200);
  const body = (await response.json()) as { messages: OutboxMessage[] };
  return body.messages;
}

/** How many messages the dev outbox holds for `email`. */
export async function outboxCount(request: APIRequestContext, email: string): Promise<number> {
  return (await outbox(request, email)).length;
}

/**
 * Polls the outbox until a message to `email` past `previousCount` arrives — the code is sent after
 * the response — and returns its 6 digits.
 */
export async function waitForSignInCode(
  request: APIRequestContext,
  email: string,
  previousCount: number,
): Promise<string> {
  let message: OutboxMessage | undefined;
  await expect
    .poll(
      async () => {
        message = (await outbox(request, email))[previousCount];
        return message !== undefined;
      },
      { message: `no sign-in message to ${email} past ${previousCount} in the outbox` },
    )
    .toBe(true);
  const code = /\b\d{6}\b/.exec(message?.text ?? "")?.[0];
  if (!code) throw new Error(`the message to ${email} holds no 6-digit code: ${message?.text}`);
  return code;
}

/**
 * The header's Sign out button: what shows a page is signed in (issue 97). Issue 155 draws it twice, in the row at
 * 720px and wider and in the Menu's panel below it; this is the one a width shows, so strict mode never sees two.
 */
export const headerSignOut = (page: Page) =>
  page.getByRole("banner").getByRole("button", { name: en["home.signOut"], exact: true }).filter({ visible: true });

/**
 * The signed-in header's Menu button, below 720px (issue 155): a `<summary>`, which has no role to find it by. Its
 * word is new copy in issue 155, typed here and in app/site-header.test.ts.
 */
const headerMenu = (page: Page) => page.getByRole("banner").locator("summary").filter({ hasText: "Menu" }).filter({ visible: true });

/** Opens the header's Menu when its button is showing and Sign out is not: the width where Sign out sits in it. */
async function openMenuForSignOut(page: Page): Promise<void> {
  // Whichever the width shows: Sign out in the row, or the Menu button holding it; both, once the Menu is open.
  await expect(headerSignOut(page).or(headerMenu(page)).first()).toBeVisible();
  if ((await headerMenu(page).isVisible()) && !(await headerSignOut(page).isVisible())) await headerMenu(page).click();
}

/** Expects the page signed in (issue 155): the Menu opened where Sign out sits in it, then the one Sign out showing. */
export async function expectSignedIn(page: Page): Promise<void> {
  await openMenuForSignOut(page);
  await expect(headerSignOut(page)).toBeVisible();
}

/** Signs out through the header (issue 155): the Menu opened where Sign out sits in it, then Sign out submitted. */
export async function signOut(page: Page): Promise<void> {
  await openMenuForSignOut(page);
  await headerSignOut(page).click();
}

/**
 * Signs `email` in at /sign-in with the code the outbox receives, and waits for where that lands: `/account`,
 * which sends a member with no Supper Club subscription on to /supper-club, signed in.
 */
export async function signIn(page: Page, request: APIRequestContext, email: string): Promise<void> {
  const before = await outboxCount(request, email);
  await page.goto("/sign-in");
  await page.getByLabel(en["signIn.emailLabel"]).fill(email);
  await page.getByRole("button", { name: en["signIn.sendCode"] }).click();
  const code = await waitForSignInCode(request, email, before);
  await page.getByLabel(en["signIn.codeLabel"]).fill(code);
  await page.getByRole("button", { name: en["signIn.submitCode"], exact: true }).click();
  await expect(page).toHaveURL((url) => url.pathname === "/supper-club");
  await expectSignedIn(page);
}

/**
 * As `waitForSignInCode`, for the link email: polls until a message to `email` past `previousCount`
 * arrives and returns the sign-in link in it.
 */
export async function waitForSignInLink(
  request: APIRequestContext,
  email: string,
  previousCount: number,
): Promise<string> {
  let message: OutboxMessage | undefined;
  await expect
    .poll(
      async () => {
        message = (await outbox(request, email))[previousCount];
        return message !== undefined;
      },
      { message: `no sign-in message to ${email} past ${previousCount} in the outbox` },
    )
    .toBe(true);
  const link = /https?:\/\/\S+\/sign-in\/link\?token=[A-Za-z0-9_-]+/.exec(message?.text ?? "")?.[0];
  if (!link) throw new Error(`the message to ${email} holds no sign-in link: ${message?.text}`);
  return link;
}
