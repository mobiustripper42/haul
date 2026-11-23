// Issue 245, AC6–AC11: every in-app link is a next/link, so a tap swaps the page body instead of loading the whole page,
// and the header's menus still end closed on the page a tap opens. Which component draws a next/link is Vitest's
// (components/ui/*.test.ts); that a tap keeps the page, and where the menus end, only a browser can show.
// "Without a full page load" is read as a value set on `window` before the tap still being there after it. Each test
// visits the pages it taps to once first: `next dev` compiles a route on its first visit, which can reload the page.
// Lenny, the `members` seed's admin, is used throughout: the admin pages need no subscription, and an admin's header holds
// the Admin group at 1024px and wider and the admin links in the drawer below it. Links are found by where they go, the
// menus by the attributes the header gives them.
import type { Page, TestInfo } from "@playwright/test";
import { expect, headerMenu, signIn, test } from "./fixtures";

const LENNY = "lenny@ocf.xx";
const MEMBERS = "/admin";
const MENUS = "/admin/menus";
const WEEKS = "/admin/weeks";

const onPath = (path: string) => (url: URL) => url.pathname === path && url.search === "";

const desktopOnly = (testInfo: TestInfo) => test.skip(testInfo.project.name !== "desktop", "the Admin group is the desktop width's");
const mobileOnly = (testInfo: TestInfo) => test.skip(testInfo.project.name !== "mobile", "the drawer is the phone width's");

/** The signed-in header's drawer, drawn below 1024px. */
const drawer = (page: Page) => page.locator("details[data-menu-drawer]");
/** The header's Admin group, drawn at 1024px and wider. */
const adminGroup = (page: Page) => page.getByRole("banner").locator("details[data-menu-group]");
/** The link to `href` inside `scope` that the width shows. */
const linkIn = (scope: ReturnType<Page["locator"]>, href: string) => scope.locator(`a[href="${href}"]`).filter({ visible: true });

/** Signs Lenny in, visits each of `paths` once, and ends on `start`. */
async function signedInOn(page: Page, request: Parameters<typeof signIn>[1], start: string, paths: string[]): Promise<void> {
  await signIn(page, request, LENNY);
  for (const path of paths) {
    await page.goto(path);
    await expect(page).toHaveURL(onPath(path));
  }
  await page.goto(start);
  await expect(page).toHaveURL(onPath(start));
}

async function openDrawer(page: Page): Promise<void> {
  await headerMenu(page).click();
  await expect(drawer(page)).toHaveJSProperty("open", true);
}

async function openAdminGroup(page: Page): Promise<void> {
  await adminGroup(page).locator("summary").click();
  await expect(adminGroup(page)).toHaveJSProperty("open", true);
}

const MARK = "issue-245-kept";
const markWindow = (page: Page) => page.evaluate((mark) => Object.assign(window, { haulMark: mark }), MARK);
const windowMark = (page: Page) => page.evaluate(() => (window as unknown as { haulMark?: string }).haulMark);

test.describe("AC6 — a tap in the header keeps the page", () => {
  test("AC6: tapping an in-app link in the signed-in header opens the new URL without a full page load", async ({ page, request }, testInfo) => {
    await signedInOn(page, request, MEMBERS, [MENUS]);
    await markWindow(page);

    const mobile = testInfo.project.name === "mobile";
    if (mobile) await openDrawer(page);
    else await openAdminGroup(page);
    await linkIn(mobile ? drawer(page) : adminGroup(page), MENUS).click();

    await expect(page).toHaveURL(onPath(MENUS));
    await page.waitForLoadState("load");
    expect(await windowMark(page), "the page was loaded whole: the value set on window before the tap is gone").toBe(MARK);
  });
});

test.describe("AC7, AC8 — a menu a tap leaves from is closed on the new page", () => {
  test("AC7: below 1024px, tapping a drawer link to another page leaves the new page with the drawer closed", async ({ page, request }, testInfo) => {
    mobileOnly(testInfo);
    await signedInOn(page, request, MEMBERS, [MENUS]);
    await openDrawer(page);

    await linkIn(drawer(page), MENUS).click();

    await expect(page).toHaveURL(onPath(MENUS));
    await expect(drawer(page)).toHaveJSProperty("open", false);
  });

  test("AC8: at 1024px and wider, tapping an Admin group link to another page leaves the new page with the group closed", async ({ page, request }, testInfo) => {
    desktopOnly(testInfo);
    await signedInOn(page, request, MEMBERS, [MENUS]);
    await openAdminGroup(page);

    await linkIn(adminGroup(page), MENUS).click();

    await expect(page).toHaveURL(onPath(MENUS));
    await expect(adminGroup(page)).toHaveJSProperty("open", false);
  });
});

test.describe("AC9 — a row's Note", () => {
  test("AC9: on /admin/weeks, tapping Note in a row's More leaves that More closed, and the row carrying #open-panel at the top of the viewport", async ({ page, request }) => {
    await signedInOn(page, request, WEEKS, []);
    // The first open week whose cutoff is ahead: the first row whose More holds a Note link (app/admin/weeks/page.tsx).
    const noteLink = page.locator(`a[href^="${WEEKS}?note="]`).first();
    const href = await noteLink.getAttribute("href");
    const week = new URL(href ?? "", "http://haul.test").searchParams.get("note");
    expect(week, "no week on /admin/weeks takes a note").toBeTruthy();
    const row = page.locator("li").filter({ has: page.locator(`a[href="${href}"]`) });
    const more = row.locator("details[data-menu-group]");

    await more.locator("summary").click();
    await expect(more).toHaveJSProperty("open", true);
    await row.locator(`a[href="${href}"]`).click();

    await expect(page).toHaveURL((url) => url.pathname === WEEKS && url.searchParams.get("note") === week);
    const opened = page.locator("#open-panel");
    await expect(opened).toBeVisible();
    await expect(opened.locator("details[data-menu-group]")).toHaveJSProperty("open", false);
    // At the top: the row's top edge sits its own scroll margin below the viewport's.
    await expect
      .poll(() => opened.evaluate((el) => Math.abs(el.getBoundingClientRect().top - parseFloat(getComputedStyle(el).scrollMarginTop))))
      .toBeLessThan(1);
  });
});

test.describe("AC10 — a tap to the page already showing closes its menu", () => {
  test("AC10: below 1024px, with the drawer open, tapping its link to the URL showing closes the drawer", async ({ page, request }, testInfo) => {
    mobileOnly(testInfo);
    await signedInOn(page, request, MEMBERS, []);
    await openDrawer(page);

    await linkIn(drawer(page), MEMBERS).click();

    await expect(drawer(page)).toHaveJSProperty("open", false);
    await expect(page).toHaveURL(onPath(MEMBERS));
  });

  test("AC10: at 1024px and wider, with the Admin group open, tapping its link to the URL showing closes the group", async ({ page, request }, testInfo) => {
    desktopOnly(testInfo);
    await signedInOn(page, request, MEMBERS, []);
    await openAdminGroup(page);

    await linkIn(adminGroup(page), MEMBERS).click();

    await expect(adminGroup(page)).toHaveJSProperty("open", false);
    await expect(page).toHaveURL(onPath(MEMBERS));
  });
});

test.describe("AC11 — the drawer stays open while the page loads", () => {
  test("AC11: below 1024px, the drawer stays open while the tapped page's data request is held, and is closed on the page once it is let through", async ({ page, request }, testInfo) => {
    mobileOnly(testInfo);
    await signedInOn(page, request, MEMBERS, [MENUS]);

    let release: () => void = () => {};
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let held = false;
    await page.route(
      (url) => url.pathname === MENUS,
      async (route) => {
        held = true;
        await released;
        await route.continue();
      },
    );
    await openDrawer(page);

    await linkIn(drawer(page), MENUS).click({ noWaitAfter: true });

    await expect.poll(() => held, { message: "the tap asked for nothing from the menus page" }).toBe(true);
    await expect(drawer(page)).toHaveJSProperty("open", true);

    release();

    await expect(page).toHaveURL(onPath(MENUS));
    await expect(drawer(page)).toHaveJSProperty("open", false);
  });
});
