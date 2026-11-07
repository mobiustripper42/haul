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

/** The header's Sign out button: what shows a page is signed in (issue 97). */
export const headerSignOut = (page: Page) => page.getByRole("banner").getByRole("button", { name: en["home.signOut"], exact: true });

/**
 * Signs `email` in at /sign-in with the code the outbox receives, and waits for where that lands: `/`,
 * which redirects to /supper-club, signed in.
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
  await expect(headerSignOut(page)).toBeVisible();
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
