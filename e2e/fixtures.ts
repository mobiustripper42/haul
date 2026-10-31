import { expect, test as base } from "@playwright/test";
import type { APIRequestContext } from "@playwright/test";
import { resetDev } from "../db/reset-dev.js";
import { runSeed } from "../db/seed.js";
import { e2eDatabaseUrl } from "./database";

export { expect };

/** `test`, with every test starting from an emptied e2e database with the `members` seed. */
export const test = base.extend<{ freshDatabase: void }>({
  freshDatabase: [
    // eslint-disable-next-line no-empty-pattern -- Playwright reads a fixture's needs from a destructured first argument, and this needs none.
    async ({}, use) => {
      const url = e2eDatabaseUrl();
      await resetDev(url);
      await runSeed("members", url);
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
