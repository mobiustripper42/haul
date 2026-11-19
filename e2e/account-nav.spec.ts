// Issue 155, AC9: the signed-in header's account links sit in its row at 1024px and wider (issue 159 moved the fold
// from 720px), and fold into the Menu button below it. Which links, in which order, and which is marked current is Vitest's (app/site-header.test.ts);
// which copy a width shows only a browser can measure. Each test starts from an emptied e2e database with the
// `members` and `supper-club` seeds (fixtures.ts). The header renders its links twice, in the row and in the Menu, so
// each is found by where it goes and counted where shown; the Menu button is the banner's one `<summary>` (issue 211).
import type { Page } from "@playwright/test";
import { expect, headerSignOut, signIn, test } from "./fixtures";

const ERIC = "eric@ocf.xx";
const LINKS = ["/account", "/account/weeks", "/account/history"];

const menuButton = (page: Page) => page.getByRole("banner").locator("summary");
const shownLinks = (page: Page, href: string) => page.getByRole("banner").locator(`a[href="${href}"]`).filter({ visible: true });

test("AC9: at 1024px and wider the account links and Sign out are in the header's row, and there is no Menu button", async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "the row is the desktop width's");
  await signIn(page, request, ERIC);

  await expect(menuButton(page)).toBeHidden();
  for (const href of LINKS) await expect(shownLinks(page, href)).toHaveCount(1);
  await expect(headerSignOut(page)).toBeVisible();
});

test("AC9: below 1024px the account links and Sign out are behind the Menu button, and shown when it opens", async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "the Menu is the phone width's");
  await signIn(page, request, ERIC);
  // Signing in opened the Menu to find Sign out; a fresh load has it closed.
  await page.reload();

  await expect(menuButton(page)).toBeVisible();
  for (const href of LINKS) await expect(shownLinks(page, href)).toHaveCount(0);
  await expect(headerSignOut(page)).toHaveCount(0);

  await menuButton(page).click();

  for (const href of LINKS) await expect(shownLinks(page, href)).toHaveCount(1);
  await expect(headerSignOut(page)).toBeVisible();
});
