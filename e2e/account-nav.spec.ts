// Issue 155, AC9: the signed-in header's account links sit in its row at 720px and wider, and fold into the Menu
// button below it. Which links, in which order, and which is marked current is Vitest's (app/site-header.test.ts);
// which copy a width shows only a browser can measure. Each test starts from an emptied e2e database with the
// `members` and `supper-club` seeds (fixtures.ts). The links' words and "Menu" are new copy in issue 155, typed
// here to find them, as the unit test types them.
import type { Page } from "@playwright/test";
import { LANGUAGES } from "../src/i18n.js";
import { expect, headerSignOut, signIn, test } from "./fixtures";

const ERIC = "eric@ocf.xx";
const LINKS = ["Your meal", "Upcoming weeks", "History"];

const menuButton = (page: Page) => page.getByRole("banner").locator("summary").filter({ hasText: "Menu" });
const link = (page: Page, name: string) => page.getByRole("banner").getByRole("link", { name, exact: true });

test("AC9: at 720px and wider the account links and Sign out are in the header's row, and there is no Menu button", async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "the row is the desktop width's");
  await signIn(page, request, ERIC);

  await expect(menuButton(page)).toBeHidden();
  for (const name of LINKS) await expect(link(page, name)).toBeVisible();
  await expect(headerSignOut(page)).toBeVisible();
});

test("AC9: below 720px the account links, Sign out and the language switch are behind the Menu button, and shown when it opens", async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "the Menu is the phone width's");
  await signIn(page, request, ERIC);
  // Signing in opened the Menu to find Sign out; a fresh load has it closed.
  await page.reload();

  await expect(menuButton(page)).toBeVisible();
  for (const name of LINKS) await expect(link(page, name)).toBeHidden();
  await expect(headerSignOut(page)).toHaveCount(0);

  await menuButton(page).click();

  for (const name of LINKS) await expect(link(page, name)).toBeVisible();
  await expect(headerSignOut(page)).toBeVisible();
  await expect(page.getByRole("banner").getByRole("button", { name: LANGUAGES.en.name, exact: true })).toBeVisible();
});
