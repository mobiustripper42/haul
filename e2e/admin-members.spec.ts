// Issue 59: what only a browser can show on /admin, on desktop and mobile: typing filters, a search
// matching nothing, a click on a header, and the download. The rows come from the `subscribers` seed, read
// back here, so these say nothing about who the seed holds; what search and sort do with a row is
// proved in src/member-list.test.ts. Controls are found by role and wording, never by class or test id.
import { readFile } from "node:fs/promises";
import type { Page, TestInfo } from "@playwright/test";
import { runSeed } from "../db/seed.js";
import { PostgresRepository } from "../src/adapters/postgres-repository.js";
import { compareNames, filterSubscribers, sortSubscribers, subscriberName, type Sort } from "../src/member-list.js";
import type { Subscriber } from "../src/ports/repository.js";
import { SUPPER_CLUB_PRODUCT_NAME } from "../src/products.js";
import { e2eDatabaseUrl } from "./database";
import { expect, signIn, test } from "./fixtures";

const LENNY = "lenny@ocf.xx";
const ERIC = "eric@ocf.xx";

const onPath = (path: string) => (url: URL) => url.pathname === path;

const desktopOnly = (testInfo: TestInfo) => test.skip(testInfo.project.name !== "desktop", "the table's headers show above 720px");

async function seededSubscribers(): Promise<Subscriber[]> {
  const url = e2eDatabaseUrl();
  await runSeed("subscribers", url);
  const repo = new PostgresRepository(url);
  try {
    const product = await repo.findProductByName(SUPPER_CLUB_PRODUCT_NAME);
    expect(product, "the subscribers seed makes the Supper Club it needs").not.toBeNull();
    return await repo.listSubscribers(product?.id ?? "");
  } finally {
    await repo.close();
  }
}

const search = (page: Page) => page.getByLabel("Search", { exact: true });
const header = (page: Page, word: string) => page.getByRole("columnheader", { name: new RegExp(`^${word}`, "i") });
const shownNames = (page: Page) => page.getByRole("table").locator("tbody tr > :first-child");
const shown = (page: Page, text: string) => page.getByText(text).filter({ visible: true });

async function expectOnlyThese(page: Page, rows: Subscriber[], kept: Subscriber[]): Promise<void> {
  expect(kept.length).toBeGreaterThan(0);
  expect(kept.length).toBeLessThan(rows.length);
  const keptIds = new Set(kept.map((row) => row.subscriptionId));
  for (const row of rows) {
    if (keptIds.has(row.subscriptionId)) await expect(shown(page, row.email)).not.toHaveCount(0);
    else await expect(shown(page, row.email)).toHaveCount(0);
  }
}

async function expectSorted(page: Page, rows: Subscriber[], sort: Sort): Promise<void> {
  await expect(shownNames(page)).toHaveText(sortSubscribers(rows, sort).map(subscriberName));
}

test.describe("AC1 — through the real redirects", () => {
  test("AC1: signed out, /admin and the spreadsheet go to /sign-in", async ({ page }) => {
    await page.goto("/admin");
    await expect(page).toHaveURL(onPath("/sign-in"));
    await page.goto("/admin/members.csv");
    await expect(page).toHaveURL(onPath("/sign-in"));
  });

  // Issue 97, AC2: they are still sent to /, and the redirect there carries them on to /supper-club.
  test("AC1, AC2 (issue 97): a signed-in member whose role is not admin ends on /supper-club from both", async ({ page, request }) => {
    await signIn(page, request, ERIC);
    await page.goto("/admin");
    await expect(page).toHaveURL(onPath("/supper-club"));
    await page.goto("/admin/members.csv");
    await expect(page).toHaveURL(onPath("/supper-club"));
  });
});

test.describe("the members list", () => {
  let rows: Subscriber[];

  test.beforeEach(async ({ page, request }) => {
    rows = await seededSubscribers();
    expect(rows).toHaveLength(12);
    await signIn(page, request, LENNY);
    await page.goto("/admin");
  });

  test("AC5: typing a name filters the list as it is typed, and clearing the search brings every row back", async ({ page }) => {
    const [first] = [...rows].sort(compareNames);
    const query = first?.lastName ?? "";

    await search(page).pressSequentially(query);
    await expectOnlyThese(page, rows, filterSubscribers(rows, query));

    await search(page).clear();
    for (const row of rows) await expect(shown(page, row.email)).not.toHaveCount(0);
  });

  test("AC5: typing a phone number's digits filters on the phone", async ({ page }) => {
    const query = (rows[0]?.phone ?? "").replace(/\D/g, "");

    await search(page).pressSequentially(query);

    await expectOnlyThese(page, rows, filterSubscribers(rows, query));
  });

  test('AC7: a search matching nothing shows No members match "{q}"', async ({ page }) => {
    await search(page).pressSequentially("zzzzqq");

    await expect(shown(page, 'No members match "zzzzqq".')).toHaveCount(1);
    for (const row of rows) await expect(shown(page, row.email)).toHaveCount(0);
  });

  test("AC6: a click on Name reverses it, and aria-sort follows", async ({ page }, testInfo) => {
    desktopOnly(testInfo);
    await expectSorted(page, rows, { key: "name", direction: "asc" });
    await expect(header(page, "name")).toHaveAttribute("aria-sort", "ascending");

    await header(page, "name").getByRole("button").click();

    await expectSorted(page, rows, { key: "name", direction: "desc" });
    await expect(header(page, "name")).toHaveAttribute("aria-sort", "descending");
  });

  test("AC6: a click on Joined starts newest first, a second reverses it, and only the sorted header carries aria-sort", async ({ page }, testInfo) => {
    desktopOnly(testInfo);

    await header(page, "joined").getByRole("button").click();

    await expectSorted(page, rows, { key: "joined", direction: "desc" });
    await expect(header(page, "joined")).toHaveAttribute("aria-sort", "descending");
    await expect(header(page, "name")).toHaveAttribute("aria-sort", "none");

    await header(page, "joined").getByRole("button").click();

    await expectSorted(page, rows, { key: "joined", direction: "asc" });
    await expect(header(page, "joined")).toHaveAttribute("aria-sort", "ascending");
  });

  test("AC6: a click on Meal or Status sorts by it ascending", async ({ page }, testInfo) => {
    desktopOnly(testInfo);

    await header(page, "meal").getByRole("button").click();
    await expectSorted(page, rows, { key: "meal", direction: "asc" });
    await expect(header(page, "meal")).toHaveAttribute("aria-sort", "ascending");

    await header(page, "status").getByRole("button").click();
    await expectSorted(page, rows, { key: "status", direction: "asc" });
    await expect(header(page, "status")).toHaveAttribute("aria-sort", "ascending");
    await expect(header(page, "meal")).toHaveAttribute("aria-sort", "none");
  });

  test("AC8: the download holds every active subscription in last-name order, whatever the screen is showing", async ({ page }) => {
    await search(page).pressSequentially(rows[0]?.email ?? "");
    await expect(shown(page, rows[1]?.email ?? "")).toHaveCount(0);

    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Download spreadsheet" }).click()]);

    expect(download.suggestedFilename()).toMatch(/\.csv$/);
    const lines = (await readFile(await download.path(), "utf8")).trim().split(/\r?\n/);
    const inOrder = [...rows].sort(compareNames);
    expect(lines).toHaveLength(inOrder.length + 1);
    inOrder.forEach((row, at) => expect(lines[at + 1]).toContain(row.email));
  });
});
