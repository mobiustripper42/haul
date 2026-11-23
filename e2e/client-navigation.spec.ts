// Issue 245, AC6–AC11: every in-app link is a next/link, so a tap swaps the page body instead of loading the whole page,
// and the header's menus still end closed on the page a tap opens. Which component draws a next/link is Vitest's
// (components/ui/*.test.ts); that a tap keeps the page, and where the menus end, only a browser can show.
// "Without a full page load" is read as a value set on `window` before the tap still being there after it. Each test
// visits the pages it taps to once first: `next dev` compiles a route on its first visit, which can reload the page.
// Lenny, the `members` seed's admin, is used throughout: the admin pages need no subscription, and an admin's header holds
// the Admin group at 1024px and wider and the admin links in the drawer below it. Links are found by where they go, the
// menus by the attributes the header gives them.
// Issue 240, AC14–AC16 (below, each named for it): which menus a page's arrival closes, on a step that keeps the header
// mounted: one between two weeks' panels on /admin/weeks, which changes only the query.
import type { Locator, Page, TestInfo } from "@playwright/test";
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

// ---------------------------------------------------------------------------------------------
// Issue 240.

/** The rows of /admin/weeks whose More holds a Note link: the open weeks whose cutoff is ahead, in order. */
const weekRows = (page: Page) => page.locator("li").filter({ has: page.locator(`details[data-menu-group] a[href^="${WEEKS}?note="]`) });
/** Two rows far enough apart that the first's open More does not cover the second's, and one more between them. */
const A = 0;
const B = 4;
const C = 2;
const weekRow = (page: Page, at: number) => weekRows(page).nth(at);
const moreOf = (row: Locator) => row.locator("details[data-menu-group]");
const noteLink = (row: Locator) => row.locator(`a[href^="${WEEKS}?note="]`);
/** The row's menu link, outside any menu. */
const menuPanelLink = (row: Locator) => row.locator(`a[href^="${WEEKS}?menu="]`);

async function openMore(row: Locator): Promise<void> {
  await moreOf(row).locator("summary").click();
  await expect(moreOf(row)).toHaveJSProperty("open", true);
}

/** Which week the panel `link` opens is for. */
const weekIn = async (link: Locator, panel: "note" | "menu") => new URL((await link.getAttribute("href")) ?? "", "http://haul.test").searchParams.get(panel);
/** The page with `week`'s panel open has arrived: its row carries #open-panel. */
async function expectPanel(page: Page, panel: "note" | "menu", week: string | null): Promise<void> {
  expect(week).toBeTruthy();
  await expect(page).toHaveURL((url) => url.pathname === WEEKS && url.searchParams.get(panel) === week);
  await expect(page.locator("#open-panel").locator(`a[href^="${WEEKS}?${panel}=${week}"]`)).toHaveCount(1);
}

/** Holds /admin/weeks' data requests until `release`. */
async function holdWeeks(page: Page): Promise<{ count(): number; release(): void }> {
  let release: () => void = () => {};
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let count = 0;
  await page.route(
    (url) => url.pathname === WEEKS,
    async (route) => {
      count += 1;
      await released;
      await route.continue();
    },
  );
  return { count: () => count, release: () => release() };
}

/** A menu that is to stay open: what closes one on arrival does so on a change to the page after it, so this gives it time to. */
async function expectStaysOpen(page: Page, menu: Locator): Promise<void> {
  await page.waitForTimeout(500);
  await expect(menu).toHaveJSProperty("open", true);
}

test.describe("AC14 (issue 240) — a link opened elsewhere closes nothing later", () => {
  const opensATab = async (page: Page, tap: () => Promise<void>) => {
    const opened = page.context().waitForEvent("page");
    await tap();
    await (await opened).close();
  };
  const TAPS: Array<[string, (page: Page, link: Locator) => Promise<void>]> = [
    ["a ctrl click on a link in a menu", (page, link) => opensATab(page, () => link.click({ modifiers: ["Control"] }))],
    ["a shift click on a link in a menu", (page, link) => opensATab(page, () => link.click({ modifiers: ["Shift"] }))],
    [
      "a cmd click on a link in a menu",
      // Off a Mac the browser itself would follow it in this tab; the page's own handlers have all run by the window.
      (_page, link) =>
        link.evaluate((a) => {
          window.addEventListener("click", (event) => event.preventDefault(), { once: true });
          a.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, metaKey: true }));
        }),
    ],
    [
      "a click on a link in a menu that opens a new tab",
      async (page, link) => {
        // No menu link opens a new tab today.
        await link.evaluate((a) => a.setAttribute("target", "_blank"));
        await opensATab(page, () => link.click());
      },
    ],
  ];

  for (const [what, tap] of TAPS) {
    test(`AC14 (issue 240): after ${what}, the same menu opened while another link's page loads is still open on arrival`, async ({ page, request }) => {
      await signedInOn(page, request, WEEKS, []);
      const [row, other] = [weekRow(page, A), weekRow(page, B)];
      const week = await weekIn(menuPanelLink(other), "menu");
      await openMore(row);
      await tap(page, noteLink(row));
      await expect(page).toHaveURL(onPath(WEEKS));
      const held = await holdWeeks(page);

      await menuPanelLink(other).click({ noWaitAfter: true });
      await expect.poll(() => held.count(), { message: "the link asked for nothing" }).toBeGreaterThan(0);
      await expect(moreOf(row)).toHaveJSProperty("open", false);
      await openMore(row);
      held.release();

      await expectPanel(page, "menu", week);
      await expectStaysOpen(page, moreOf(row));
    });
  }
});

test.describe("AC15 (issue 240) — Back and Forward close an open menu", () => {
  /** On /admin/weeks with two steps taken: row A's menu panel, then row B's. The weeks they are for. */
  async function twoPanelsDeep(page: Page, request: Parameters<typeof signIn>[1]): Promise<[string | null, string | null]> {
    await signedInOn(page, request, WEEKS, []);
    const weeks: [string | null, string | null] = [await weekIn(menuPanelLink(weekRow(page, A)), "menu"), await weekIn(menuPanelLink(weekRow(page, B)), "menu")];
    for (const [at, week] of [[A, weeks[0]], [B, weeks[1]]] as const) {
      await menuPanelLink(weekRow(page, at)).click();
      await expectPanel(page, "menu", week);
    }
    return weeks;
  }

  async function expectBackAndForwardClose(page: Page, weeks: [string | null, string | null], menu: Locator, open: () => Promise<void>): Promise<void> {
    await open();
    await page.goBack();
    await expectPanel(page, "menu", weeks[0]);
    await expect(menu).toHaveJSProperty("open", false);

    await open();
    await page.goForward();
    await expectPanel(page, "menu", weeks[1]);
    await expect(menu).toHaveJSProperty("open", false);
  }

  test("AC15 (issue 240): a row's open More closes when Back or Forward steps between two weeks' panels", async ({ page, request }) => {
    const weeks = await twoPanelsDeep(page, request);
    const row = weekRow(page, C);
    await expectBackAndForwardClose(page, weeks, moreOf(row), () => openMore(row));
  });

  test("AC15 (issue 240): at 1024px and wider, so does an open Admin group", async ({ page, request }, testInfo) => {
    desktopOnly(testInfo);
    const weeks = await twoPanelsDeep(page, request);
    await expectBackAndForwardClose(page, weeks, adminGroup(page), () => openAdminGroup(page));
  });

  test("AC15 (issue 240): below 1024px, so does an open drawer", async ({ page, request }, testInfo) => {
    mobileOnly(testInfo);
    const weeks = await twoPanelsDeep(page, request);
    await expectBackAndForwardClose(page, weeks, drawer(page), () => openDrawer(page));
  });
});

test.describe("AC16 (issue 240) — a menu opened while a page loads stays open when it arrives", () => {
  /** Row A's Note tapped in its More and held, `menu` opened while it loads, and the page let through. */
  async function openWhileLoading(page: Page, request: Parameters<typeof signIn>[1], menu: Locator, open: () => Promise<void>): Promise<void> {
    await signedInOn(page, request, WEEKS, []);
    const row = weekRow(page, A);
    const week = await weekIn(noteLink(row), "note");
    await openMore(row);
    const held = await holdWeeks(page);
    await noteLink(row).click({ noWaitAfter: true });
    await expect.poll(() => held.count(), { message: "the tap asked for nothing" }).toBeGreaterThan(0);

    await open();
    held.release();

    await expectPanel(page, "note", week);
    await expectStaysOpen(page, menu);
    await expect(moreOf(row)).toHaveJSProperty("open", false);
  }

  test("AC16 (issue 240): another row's More stays open, and the More the link was tapped in is closed", async ({ page, request }) => {
    const other = weekRow(page, B);
    await openWhileLoading(page, request, moreOf(other), () => openMore(other));
  });

  test("AC16 (issue 240): at 1024px and wider, so does the Admin group", async ({ page, request }, testInfo) => {
    desktopOnly(testInfo);
    await openWhileLoading(page, request, adminGroup(page), () => openAdminGroup(page));
  });

  test("AC16 (issue 240): below 1024px, so does the drawer", async ({ page, request }, testInfo) => {
    mobileOnly(testInfo);
    await openWhileLoading(page, request, drawer(page), () => openDrawer(page));
  });
});
