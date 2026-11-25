// Issue 243: Upcoming weeks and History are one page, /account/weeks. Which rows each list holds and what the menu's links
// are is Vitest's (app/account/weeks/*.test.ts, app/site-header.test.ts); where the two lists stand at a width, and where the
// History link leaves the page, only a browser can show. The `account-weeks` seed's member has rows in both lists: 12 weeks
// to come, and the past weeks since the Supper Club's first pickup. Each test visits the pages it taps to once first:
// `next dev` compiles a route on its first visit, which can reload the page.
import type { Locator, Page, TestInfo } from "@playwright/test";
import { runSeed } from "../db/seed.js";
import { e2eDatabaseUrl } from "./database";
import { expect, headerMenu, signIn, test } from "./fixtures";

const MEMBER = "weeks.member@example.com";
const ACCOUNT = "/account";
const WEEKS = "/account/weeks";
const HISTORY = "/account/weeks#history";

const desktopOnly = (testInfo: TestInfo) => test.skip(testInfo.project.name !== "desktop", "1024px and wider");
const mobileOnly = (testInfo: TestInfo) => test.skip(testInfo.project.name !== "mobile", "the drawer is the phone width's");

/** The History column. */
const history = (page: Page) => page.locator("#history");
/** The signed-in header's drawer, drawn below 1024px. */
const drawer = (page: Page) => page.locator("details[data-menu-drawer]");
/** The one History link the width shows in `scope`. */
const historyLink = (scope: Locator) => scope.locator(`a[href="${HISTORY}"]`).filter({ visible: true });

/** Signs the seed's member in, visits both account pages once, and ends on `start`. */
async function signedInOn(page: Page, request: Parameters<typeof signIn>[1], start: string): Promise<void> {
  await runSeed("account-weeks", e2eDatabaseUrl());
  await signIn(page, request, MEMBER, ACCOUNT);
  for (const path of [ACCOUNT, WEEKS, start]) {
    await page.goto(path);
    await expect(page).toHaveURL((url) => url.pathname === path && url.hash === "");
  }
}

/** The page is /account/weeks, arrived at through the History link, and has had time to scroll. */
async function expectHistoryArrived(page: Page): Promise<void> {
  await expect(page).toHaveURL((url) => url.pathname === WEEKS && url.hash === "#history");
  await expect(history(page)).toBeVisible();
  await page.waitForTimeout(500);
}

test.describe("AC2 — where the two lists stand", () => {
  type Box = { x: number; y: number; width: number; height: number };

  /** Each list's card, the Upcoming one the page's first. */
  async function boxes(page: Page): Promise<{ upcoming: Box; past: Box }> {
    const upcoming = await page.locator("main section").first().boundingBox();
    const past = await history(page).locator("section").boundingBox();
    if (!upcoming || !past) throw new Error("a list's card is not drawn");
    return { upcoming, past };
  }

  test("AC2: at 1024px and wider the lists are side by side, Upcoming on the left; below 1024px History is under Upcoming", async ({ page, request }) => {
    await signedInOn(page, request, WEEKS);
    await expect(history(page), "the page has no element with the id history").toHaveCount(1);
    const own = page.viewportSize();
    if (!own) throw new Error("the project sets no viewport");

    for (const width of [own.width, 1024, 1023]) {
      await page.setViewportSize({ width, height: own.height });
      await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(width);
      const { upcoming, past } = await boxes(page);
      if (width >= 1024) {
        expect(past.x, `at ${width}px History is right of Upcoming`).toBeGreaterThanOrEqual(upcoming.x + upcoming.width);
        expect(past.y, `at ${width}px History starts beside Upcoming`).toBeLessThan(upcoming.y + upcoming.height);
      } else {
        expect(past.y, `at ${width}px History is under Upcoming`).toBeGreaterThanOrEqual(upcoming.y + upcoming.height);
      }
    }
  });
});

test.describe("AC4 — /account/history", () => {
  test("AC4: /account/history is no longer a page: a signed-in member gets a 404", async ({ page, request }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "a status, the same at every width");
    await signedInOn(page, request, WEEKS);
    expect((await page.goto("/account/history"))?.status()).toBe(404);
  });
});

test.describe("AC5 — the History link", () => {
  for (const start of [ACCOUNT, WEEKS]) {
    test(`AC5: below 1024px, tapping History in the drawer on ${start} closes the drawer and brings the History list to the top of the screen`, async ({ page, request }, testInfo) => {
      mobileOnly(testInfo);
      // Short enough that the list, with what is under it, is taller than the window, so it has room to reach the top.
      await page.setViewportSize({ width: 375, height: 400 });
      await signedInOn(page, request, start);
      await headerMenu(page).click();
      await expect(drawer(page)).toHaveJSProperty("open", true);
      await expect(historyLink(drawer(page))).toHaveCount(1);

      await historyLink(drawer(page)).click();

      await expectHistoryArrived(page);
      await expect(drawer(page)).toHaveJSProperty("open", false);
      // At the top: the column's top edge sits its own scroll margin below the viewport's.
      await expect
        .poll(() => history(page).evaluate((el) => Math.abs(el.getBoundingClientRect().top - parseFloat(getComputedStyle(el).scrollMarginTop))))
        .toBeLessThan(1);
      expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    });

    test(`AC5: at 1024px and wider, clicking History on ${start} opens the page at the top`, async ({ page, request }, testInfo) => {
      desktopOnly(testInfo);
      await signedInOn(page, request, start);
      const link = historyLink(page.getByRole("banner"));
      await expect(link).toHaveCount(1);

      await link.click();

      await expectHistoryArrived(page);
      // There is room to scroll, and the page has not.
      expect(await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight + 200)).toBe(true);
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
    });
  }
});
