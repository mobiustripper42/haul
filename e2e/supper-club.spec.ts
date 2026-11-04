// Issue 55, AC2: the choices survive the round trip in a real browser, cookies through redirects, on
// desktop and mobile. Each test starts from an emptied e2e database with the `members` seed
// (fixtures.ts), and these add the `supper-club` seed. Controls are found by role and wording.
import type { Page } from "@playwright/test";
import { runSeed } from "../db/seed.js";
import { en } from "../src/messages/en.js";
import { e2eDatabaseUrl } from "./database";
import { expect, outboxCount, test, waitForSignInCode } from "./fixtures";

const ERIC = "eric@ocf.xx";
const NEWCOMER = "new@ocf.xx";

const onPath = (path: string) => (url: URL) => url.pathname === path;

const size = (page: Page) => page.getByRole("radio", { name: /3–4 person/ });
const menu = (page: Page) => page.getByRole("radio", { name: /Vegan/ });

/** Picks the choices that are not the defaults, so nothing but the round trip can bring them back. */
async function pickChoices(page: Page): Promise<void> {
  await page.goto("/supper-club");
  await size(page).check();
  await menu(page).check();
}

async function expectChoicesKept(page: Page): Promise<void> {
  await expect(page).toHaveURL(onPath("/supper-club"));
  await expect(size(page)).toBeChecked();
  await expect(menu(page)).toBeChecked();
}

test.beforeEach(async () => {
  await runSeed("supper-club", e2eDatabaseUrl());
});

test("AC2: Create an account, a confirmed code, and back on the Supper Club page, signed in, the choices still picked", async ({ page, request }) => {
  await pickChoices(page);
  await page.getByRole("button", { name: "Create an account", exact: true }).click();
  await expect(page).toHaveURL(onPath("/create-account"));

  await page.getByLabel("First name").fill("New");
  await page.getByLabel("Last name").fill("Comer");
  await page.getByLabel(en["signIn.emailLabel"], { exact: true }).fill(NEWCOMER);
  await page.getByLabel("Phone").fill("216-555-0100");
  const before = await outboxCount(request, NEWCOMER);
  await page.getByRole("button", { name: en["signIn.sendCode"] }).click();
  await expect(page).toHaveURL(onPath("/create-account/code"));

  const code = await waitForSignInCode(request, NEWCOMER, before);
  await page.getByLabel(en["signIn.codeLabel"]).fill(code);
  await page.getByRole("button", { name: "Confirm email" }).click();

  await expectChoicesKept(page);
  await expect(page.getByText(`Signed in as ${NEWCOMER}.`)).toBeVisible();
});

test("AC2: Sign in, a code, and back on the Supper Club page, signed in, the choices still picked", async ({ page, request }) => {
  await pickChoices(page);
  await page.getByRole("button", { name: en["home.signIn"], exact: true }).click();
  await expect(page).toHaveURL(onPath("/sign-in"));

  await page.getByLabel(en["signIn.emailLabel"]).fill(ERIC);
  const before = await outboxCount(request, ERIC);
  await page.getByRole("button", { name: en["signIn.sendCode"] }).click();
  await expect(page).toHaveURL(onPath("/sign-in/code"));

  const code = await waitForSignInCode(request, ERIC, before);
  await page.getByLabel(en["signIn.codeLabel"]).fill(code);
  await page.getByRole("button", { name: en["signIn.submitCode"], exact: true }).click();

  await expectChoicesKept(page);
  await expect(page.getByText(`Signed in as ${ERIC}.`)).toBeVisible();
});
