// Issue 262: a card's padding, a divided list's ends and a data table's edges, as the browser draws them: computed
// padding and drawn boxes only a browser has. The phone is the mobile project at 375px; the desktop project is set to
// 1440px, with its mouse, so its root is 15px (app/globals.css). A card is found by its class, the one mark of a card on
// the page; what is asserted is what is drawn. The sizes are provisional, judged by eye at the hand-back (AC9).
import type { Locator, Page, TestInfo } from "@playwright/test";
import { runSeed } from "../db/seed.js";
import { SQUARE_SANDBOX_VALUES } from "../src/adapters/square-payments.js";
import { e2eDatabaseUrl } from "./database";
import { expect, signIn, test } from "./fixtures";

const ERIC = "eric@ocf.xx";
const LENNY = "lenny@ocf.xx";
const WEEKS_MEMBER = "weeks.member@example.com";

// `next dev` compiles a route on its first visit, and most of these visit several.
test.describe.configure({ timeout: 90_000 });

const desktopOnly = (testInfo: TestInfo, why: string) => test.skip(testInfo.project.name !== "desktop", why);
const mobileOnly = (testInfo: TestInfo, why: string) => test.skip(testInfo.project.name !== "mobile", why);

/** The width AC1 and AC10 draw at: 1440px on the desktop project, the phone's 375px on the mobile one. */
async function atCriterionWidth(page: Page, testInfo: TestInfo): Promise<number> {
  if (testInfo.project.name === "desktop") await page.setViewportSize({ width: 1440, height: 900 });
  const width = page.viewportSize()?.width;
  if (width === undefined) throw new Error("the project sets no viewport");
  return width;
}

/** The root's font size in px: what a rem is on this page. */
const rootPx = (page: Page) => page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));

/** Each element `selector` finds that is drawn, as its computed padding: top, right, bottom, left, in px. */
const paddingsOf = (page: Page, selector: string) =>
  page
    .locator(selector)
    .filter({ visible: true })
    .evaluateAll((elements) =>
      elements.map((el) => {
        const style = getComputedStyle(el);
        return [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft].map((side) => parseFloat(side));
      }),
    );

/** Every drawn `selector` on the page has the same padding on all four sides: 1rem below 1024px, 1.25rem at 1024px and wider. */
async function expectEvenlyPadded(page: Page, selector: string, width: number): Promise<void> {
  const each = width >= 1024 ? 1.25 * (await rootPx(page)) : await rootPx(page);
  const found = await paddingsOf(page, selector);
  expect(found.length, `no ${selector} is drawn`).toBeGreaterThan(0);
  for (const sides of found) expect(sides, `${selector}'s padding, top, right, bottom, left`).toEqual([each, each, each, each]);
}

/** Eric signed up for the Supper Club, on the confirmation (/supper-club/done). */
async function onDone(page: Page, request: Parameters<typeof signIn>[1]): Promise<void> {
  await signIn(page, request, ERIC);
  await page.goto("/supper-club");
  await page.locator('input[name="sourceId"]').fill(SQUARE_SANDBOX_VALUES.cardNonceOk);
  await page.locator('input[name="consent"]').check();
  await page.locator('form:has(input[name="consent"]) button[type="submit"]').click();
  await expect(page).toHaveURL((url) => url.pathname === "/supper-club/done");
}

test.describe("AC1 — a card's padding is the same on every side", () => {
  for (const [selector, path] of [
    [".card", "/sign-in"],
    [".card-fill", "/supper-club"],
    [".card-pane", "/supper-club/sign-in"],
    [".card-reading", "/privacy"],
  ] as const) {
    test(`AC1: a ${selector} on ${path} has the same padding on all four sides, 1rem below 1024px and 1.25rem at 1024px and wider`, async ({ page }, testInfo) => {
      const width = await atCriterionWidth(page, testInfo);
      await page.goto(path);

      await expectEvenlyPadded(page, selector, width);
    });
  }

  test("AC1: below 1024px, the confirmation's Your box (.pane-box) is a card with the same padding on all four sides, 1rem", async ({ page, request }, testInfo) => {
    mobileOnly(testInfo, "at 1024px and wider .pane-box is a section under a hairline, not a card");
    const width = await atCriterionWidth(page, testInfo);
    await onDone(page, request);

    await expectEvenlyPadded(page, ".pane-box", width);
  });

  test("AC1: at 1024px and wider, the confirmation (.pane-done) is one card with the same padding on all four sides, 1.25rem", async ({ page, request }, testInfo) => {
    desktopOnly(testInfo, "below 1024px .pane-done is not a card");
    const width = await atCriterionWidth(page, testInfo);
    await onDone(page, request);

    await expectEvenlyPadded(page, ".pane-done", width);
  });
});

type Row = { top: number; bottom: number; borderTop: number };

/** The rows of `list`, its own `<li>` children, as their computed top and bottom padding and top border, in px. */
const rowsOf = (list: Locator): Promise<Row[]> =>
  list.evaluate((ul) =>
    [...ul.children].map((li) => {
      const style = getComputedStyle(li);
      return { top: parseFloat(style.paddingTop), bottom: parseFloat(style.paddingBottom), borderTop: parseFloat(style.borderTopWidth) };
    }),
  );

/** Every edge between two rows keeps its padding: each row's bottom but the last's, each row's top but the first's. */
function expectInnerEdgesPadded(rows: Row[]): void {
  rows.forEach((row, at) => {
    if (at > 0) expect(row.top, `row ${at + 1}'s top padding`).toBeGreaterThan(0);
    if (at < rows.length - 1) expect(row.bottom, `row ${at + 1}'s bottom padding`).toBeGreaterThan(0);
  });
}

/** A divided list: no top padding on its first row, no bottom padding on its last, and the rows between keep theirs. */
async function expectDivided(list: Locator): Promise<void> {
  const rows = await rowsOf(list);
  expect(rows.length, "the list has fewer than three rows, so none is between").toBeGreaterThanOrEqual(3);
  expect(rows[0]?.top, "the first row's top padding").toBe(0);
  expect(rows.at(-1)?.bottom, "the last row's bottom padding").toBe(0);
  expectInnerEdgesPadded(rows);
}

/** The first divided list in a card on the page: a `<ul>` that is the card's own child. */
const listInCard = (page: Page) => page.locator("main section > ul").filter({ visible: true }).first();

test.describe("AC2 — a divided list adds no space at its ends", () => {
  test("AC2: Upcoming weeks' list has no space above its first row or below its last, and the rows between keep theirs", async ({ page, request }) => {
    await runSeed("account-weeks", e2eDatabaseUrl());
    await signIn(page, request, WEEKS_MEMBER);
    await page.goto("/account/weeks");

    await expectDivided(listInCard(page));
  });

  test("AC2: admin Weeks' list has no space above its first row or below its last, and the rows between keep theirs", async ({ page, request }) => {
    await signIn(page, request, LENNY, "/admin");
    await page.goto("/admin/weeks");

    await expectDivided(listInCard(page));
  });

  test("AC2: the Menus list has no space above its first row or below its last, and the rows between keep theirs", async ({ page, request }) => {
    await runSeed("menus", e2eDatabaseUrl());
    await signIn(page, request, LENNY, "/admin");
    await page.goto("/admin/menus");

    await expectDivided(listInCard(page));
  });

  test("AC2: the phone's members list keeps its first row's top border and padding under Sort by, and has no space below its last row", async ({ page, request }, testInfo) => {
    mobileOnly(testInfo, "the stacked members list is drawn below 720px only");
    await runSeed("subscribers", e2eDatabaseUrl());
    await signIn(page, request, LENNY, "/admin");
    await page.goto("/admin");

    const rows = await rowsOf(page.locator(".row-list > ul"));
    expect(rows.length, "the list has fewer than three rows, so none is between").toBeGreaterThanOrEqual(3);
    expect(rows[0]?.top, "the first row's top padding").toBeGreaterThan(0);
    expect(rows[0]?.borderTop, "the first row's top border").toBeGreaterThan(0);
    expect(rows.at(-1)?.bottom, "the last row's bottom padding").toBe(0);
    expectInnerEdgesPadded(rows);
  });
});

/** Each drawn table in the page's main, as its box's left and right edges beside its card's. */
const tableEdges = (page: Page) =>
  page
    .locator("main table")
    .filter({ visible: true })
    .evaluateAll((tables) =>
      tables.map((table) => {
        const box = table.parentElement?.getBoundingClientRect();
        const card = table.closest("section")?.getBoundingClientRect();
        return { table: box ? [box.left, box.right] : null, card: card ? [card.left, card.right] : null };
      }),
    );

/** Every drawn table meets its card's left and right edges, and the page does not scroll sideways. */
async function expectTablesMeetTheirCards(page: Page): Promise<void> {
  const found = await tableEdges(page);
  expect(found.length, "no table is drawn").toBeGreaterThan(0);
  for (const { table, card } of found) {
    expect(card, "the table is in no card").not.toBeNull();
    expect(table, "the table's left and right edges against its card's").toEqual(card);
  }
  const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(sideways, "the page scrolls sideways by this many px").toBeLessThanOrEqual(0);
}

test.describe("AC10 — a data table still meets its card's edges", () => {
  test("AC10: Weekly lists' tables meet their cards' edges, and the page does not scroll sideways", async ({ page, request }, testInfo) => {
    await atCriterionWidth(page, testInfo);
    await runSeed("week-lists", e2eDatabaseUrl());
    await signIn(page, request, LENNY, "/admin");
    await page.goto("/admin/lists");

    await expectTablesMeetTheirCards(page);
  });

  test("AC10: at 1440px the members list's table meets its card's edges, and the page does not scroll sideways", async ({ page, request }, testInfo) => {
    desktopOnly(testInfo, "the members list's table is hidden below 720px");
    await atCriterionWidth(page, testInfo);
    await runSeed("subscribers", e2eDatabaseUrl());
    await signIn(page, request, LENNY, "/admin");
    await page.goto("/admin");

    await expectTablesMeetTheirCards(page);
  });
});
