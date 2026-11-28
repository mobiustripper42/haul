// Issue 59: what only a browser can show on /admin, on desktop and mobile: typing filters, a search
// matching nothing, a click on a header, and the download. The rows come from the `subscribers` seed, read
// back here, so these say nothing about who the seed holds; what search and sort do with a row is
// proved in src/member-list.test.ts. Controls are found by role and their names in the catalog (`en`), never by
// class or test id.
import { readFile } from "node:fs/promises";
import type { Page, TestInfo } from "@playwright/test";
import { runSeed } from "../db/seed.js";
import { en } from "../src/messages/en.js";
import { PostgresRepository } from "../src/adapters/postgres-repository.js";
import { compareNames, filterMembers, groupByMember, mealLabel, sortMembers, subscriberName, type MemberRow, type Sort } from "../src/member-list.js";
import { formatShortDate } from "../src/pickup-week.js";
import type { Subscriber } from "../src/ports/repository.js";
import { SUPPER_CLUB_PRODUCT_NAME } from "../src/products.js";
import { e2eDatabaseUrl } from "./database";
import { expect, signIn, test } from "./fixtures";

const LENNY = "lenny@ocf.xx";
const ERIC = "eric@ocf.xx";

const onPath = (path: string) => (url: URL) => url.pathname === path;

const desktopOnly = (testInfo: TestInfo) => test.skip(testInfo.project.name !== "desktop", "the table's headers show above 720px");

async function seededSubscribers(seed = "subscribers"): Promise<Subscriber[]> {
  const url = e2eDatabaseUrl();
  await runSeed(seed, url);
  const repo = new PostgresRepository(url);
  try {
    const product = await repo.findProductByName(SUPPER_CLUB_PRODUCT_NAME);
    expect(product, "the subscribers seed makes the Supper Club it needs").not.toBeNull();
    return await repo.listSubscribers(product?.id ?? "");
  } finally {
    await repo.close();
  }
}

const search = (page: Page) => page.getByLabel(en["admin.members.search"], { exact: true });
const COLUMNS = { name: en["admin.members.name"], joined: en["admin.members.joined"], meal: en["admin.members.meal"], status: en["admin.members.status"] } as const;
/**
 * Issue 263: the members card, the one holding the search; the never-subscribed card below it has a table and rows of its
 * own, with rows in every test (the `members` seed's members hold no subscription), and a Name column header too.
 */
const membersCard = (page: Page) => page.locator("section", { has: search(page) });
const header = (page: Page, column: keyof typeof COLUMNS) => membersCard(page).getByRole("columnheader", { name: new RegExp(`^${COLUMNS[column].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i") });
const shownNames = (page: Page) => membersCard(page).getByRole("table").locator("tbody tr > :first-child");
const shown = (page: Page, text: string) => page.getByText(text).filter({ visible: true });

async function expectOnlyThese(page: Page, people: MemberRow[], kept: MemberRow[]): Promise<void> {
  expect(kept.length).toBeGreaterThan(0);
  expect(kept.length).toBeLessThan(people.length);
  const keptIds = new Set(kept.map((person) => person.memberId));
  for (const { memberId, current } of people) {
    if (keptIds.has(memberId)) await expect(shown(page, current.email)).not.toHaveCount(0);
    else await expect(shown(page, current.email)).toHaveCount(0);
  }
}

async function expectSorted(page: Page, people: MemberRow[], sort: Sort): Promise<void> {
  await expect(shownNames(page)).toHaveText(sortMembers(people, sort).map((person) => subscriberName(person.current)));
}

test.describe("AC1 — through the real redirects", () => {
  test("AC1: signed out, /admin and the spreadsheet go to /sign-in", async ({ page }) => {
    await page.goto("/admin");
    await expect(page).toHaveURL(onPath("/sign-in"));
    await page.goto("/admin/members.csv");
    await expect(page).toHaveURL(onPath("/sign-in"));
  });

  // Issue 97, AC2: they are still sent to /, which sends a signed-in member to /account (issue 136, AC6c),
  // and a member with no Supper Club subscription stays there (issue 260, AC10).
  test("AC1, AC10 (issue 260): a signed-in member whose role is not admin ends on /account from both", async ({ page, request }) => {
    await signIn(page, request, ERIC);
    await page.goto("/admin");
    await expect(page).toHaveURL(onPath("/account"));
    await page.goto("/admin/members.csv");
    await expect(page).toHaveURL(onPath("/account"));
  });
});

test.describe("the members list", () => {
  let rows: Subscriber[];
  /** Issue 263: the list's people, each of the `subscribers` seed's twelve holding one subscription. */
  let people: MemberRow[];

  test.beforeEach(async ({ page, request }) => {
    rows = await seededSubscribers();
    expect(rows).toHaveLength(12);
    people = groupByMember(rows);
    await signIn(page, request, LENNY, "/admin");
    await page.goto("/admin");
  });

  test("AC5: typing a name filters the list as it is typed, and clearing the search brings every row back", async ({ page }) => {
    const [first] = [...rows].sort(compareNames);
    const query = first?.lastName ?? "";

    await search(page).pressSequentially(query);
    await expectOnlyThese(page, people, filterMembers(people, query));

    await search(page).clear();
    for (const row of rows) await expect(shown(page, row.email)).not.toHaveCount(0);
  });

  test("AC5: typing a phone number's digits filters on the phone", async ({ page }) => {
    const query = (rows[0]?.phone ?? "").replace(/\D/g, "");

    await search(page).pressSequentially(query);

    await expectOnlyThese(page, people, filterMembers(people, query));
  });

  test("AC7: a search matching nothing says so, naming the search", async ({ page }) => {
    await search(page).pressSequentially("zzzzqq");

    // The search's value, on the page once: the no-match line that names it.
    await expect(shown(page, "zzzzqq")).toHaveCount(1);
    for (const row of rows) await expect(shown(page, row.email)).toHaveCount(0);
  });

  test("AC6: a click on Name reverses it, and aria-sort follows", async ({ page }, testInfo) => {
    desktopOnly(testInfo);
    await expectSorted(page, people, { key: "name", direction: "asc" });
    await expect(header(page, "name")).toHaveAttribute("aria-sort", "ascending");

    await header(page, "name").getByRole("button").click();

    await expectSorted(page, people, { key: "name", direction: "desc" });
    await expect(header(page, "name")).toHaveAttribute("aria-sort", "descending");
  });

  test("AC6: a click on Joined starts newest first, a second reverses it, and only the sorted header carries aria-sort", async ({ page }, testInfo) => {
    desktopOnly(testInfo);

    await header(page, "joined").getByRole("button").click();

    await expectSorted(page, people, { key: "joined", direction: "desc" });
    await expect(header(page, "joined")).toHaveAttribute("aria-sort", "descending");
    await expect(header(page, "name")).toHaveAttribute("aria-sort", "none");

    await header(page, "joined").getByRole("button").click();

    await expectSorted(page, people, { key: "joined", direction: "asc" });
    await expect(header(page, "joined")).toHaveAttribute("aria-sort", "ascending");
  });

  test("AC6: a click on Meal or Status sorts by it ascending", async ({ page }, testInfo) => {
    desktopOnly(testInfo);

    await header(page, "meal").getByRole("button").click();
    await expectSorted(page, people, { key: "meal", direction: "asc" });
    await expect(header(page, "meal")).toHaveAttribute("aria-sort", "ascending");

    await header(page, "status").getByRole("button").click();
    await expectSorted(page, people, { key: "status", direction: "asc" });
    await expect(header(page, "status")).toHaveAttribute("aria-sort", "ascending");
    await expect(header(page, "meal")).toHaveAttribute("aria-sort", "none");
  });

  test("AC8: the download holds every active subscription in last-name order, whatever the screen is showing", async ({ page }) => {
    await search(page).pressSequentially(rows[0]?.email ?? "");
    await expect(shown(page, rows[1]?.email ?? "")).toHaveCount(0);

    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: en["admin.members.download"] }).click()]);

    expect(download.suggestedFilename()).toMatch(/\.csv$/);
    const lines = (await readFile(await download.path(), "utf8")).trim().split(/\r?\n/);
    const inOrder = [...rows].sort(compareNames);
    expect(lines).toHaveLength(inOrder.length + 1);
    inOrder.forEach((row, at) => expect(lines[at + 1]).toContain(row.email));
  });

  // Issue 101, AC8: the header sorts at 720px and wider, the select below it; only a browser can click one and
  // then narrow the window onto the other. The select names the key in effect, never its direction.
  test("AC8 (issue 101): after a click on Joined at 720px or wider, narrowing the window shows Joined in the Sort by select, whichever way it runs", async ({ page }, testInfo) => {
    desktopOnly(testInfo);
    const desktop = page.viewportSize();
    if (!desktop) throw new Error("the desktop project has no viewport size");
    const sortBy = page.getByLabel(en["admin.members.sortBy"], { exact: true });

    for (const sort of [{ key: "joined", direction: "desc" }, { key: "joined", direction: "asc" }] as const) {
      await page.setViewportSize(desktop);
      await header(page, "joined").getByRole("button").click();
      await expectSorted(page, people, sort);

      await page.setViewportSize({ width: 375, height: 800 });

      await expect(sortBy).toBeVisible();
      await expect(sortBy).toHaveValue("joined");
    }
  });
});

// Issue 263: a person's earlier subscriptions, rolled up under their row, and Past. The people come from the `members-list`
// seed (db/seeds/members-list.test.ts holds who it makes), read back and grouped here as the page groups them; which
// subscription is current and the earlier ones' order are groupByMember's (src/member-list.test.ts), and what a row shows
// as the list loads is app/admin/members-list.test.ts's. A rolldown's state is read from its toggle's aria-expanded, and
// Past is the one button with a pressed state: each found by the attribute its criterion names, as their names are copy.
test.describe("issue 263 — earlier subscriptions and Past", () => {
  let people: MemberRow[];
  /** The people with earlier subscriptions: the ones with a rolldown. */
  let rolled: MemberRow[];

  test.beforeEach(async ({ page, request }) => {
    people = groupByMember(await seededSubscribers("members-list"));
    rolled = people.filter((person) => person.earlier.length > 0);
    expect(rolled.length, "the members-list seed makes at least two people with earlier subscriptions").toBeGreaterThanOrEqual(2);
    await signIn(page, request, LENNY, "/admin");
    await page.goto("/admin");
  });

  const onDesktop = (testInfo: TestInfo) => testInfo.project.name === "desktop";
  const STATUS = new RegExp(`^(${en["account.active"]}|${en["account.cancelled"]})$`);
  const nameLink = (page: Page, person: MemberRow) => page.getByRole("link", { name: subscriberName(person.current), exact: true });
  /** The person's row as drawn: their table row on desktop, their stacked row on a phone. */
  const rowOf = (page: Page, person: MemberRow) => membersCard(page).locator("tbody tr, li").filter({ visible: true }).filter({ has: nameLink(page, person) });
  const toggleOf = (page: Page, person: MemberRow) => rowOf(page, person).locator("button[aria-expanded]");
  const past = (page: Page) => membersCard(page).locator("button[aria-pressed]").filter({ visible: true });
  /** The table's drawn rows: each person's, and each open earlier line. */
  const bodyRows = (page: Page) => membersCard(page).locator("tbody tr").filter({ visible: true });

  /**
   * Exactly `open`'s rolldowns are open: each rolled person's toggle says so, and their lines show or not — counted as the
   * table's drawn rows on desktop, and as the status badges in each stacked row on a phone.
   */
  async function expectOpen(page: Page, testInfo: TestInfo, open: MemberRow[]): Promise<void> {
    const openIds = new Set(open.map((person) => person.memberId));
    for (const person of rolled) {
      const isOpen = openIds.has(person.memberId);
      await expect(toggleOf(page, person), subscriberName(person.current)).toHaveAttribute("aria-expanded", String(isOpen));
      if (!onDesktop(testInfo)) {
        await expect(rowOf(page, person).getByText(STATUS).filter({ visible: true }), subscriberName(person.current)).toHaveCount(1 + (isOpen ? person.earlier.length : 0));
      }
    }
    if (onDesktop(testInfo)) await expect(bodyRows(page)).toHaveCount(people.length + open.reduce((lines, person) => lines + person.earlier.length, 0));
  }

  test("AC1: a person with earlier subscriptions is one row: their name shows once", async ({ page }) => {
    for (const person of rolled) {
      await expect(membersCard(page).getByRole("link", { name: subscriberName(person.current), exact: true }).filter({ visible: true })).toHaveCount(1);
      await expect(rowOf(page, person)).toHaveCount(1);
    }
  });

  test("AC3: every rolldown is closed on load; a person's toggle opens theirs alone, and closes it again", async ({ page }, testInfo) => {
    const [first, second] = rolled;
    if (!first || !second) throw new Error("the beforeEach checks two people have earlier subscriptions");
    await expectOpen(page, testInfo, []);

    await toggleOf(page, first).click();
    await expectOpen(page, testInfo, [first]);

    await toggleOf(page, second).click();
    await expectOpen(page, testInfo, [first, second]);

    await toggleOf(page, first).click();
    await expectOpen(page, testInfo, [second]);
  });

  test("AC3: an open rolldown holds a line per earlier subscription, newest first: its meal, joined date and status, Refund owed when it owes one, and no link", async ({ page }, testInfo) => {
    expect(rolled.flatMap((person) => person.earlier).some((earlier) => earlier.refundOwed), "the seed gives an earlier subscription a refund owed").toBe(true);
    for (const person of rolled) {
      await toggleOf(page, person).click();
      if (onDesktop(testInfo)) {
        const rows = bodyRows(page);
        let at = -1;
        for (let n = 0; n < (await rows.count()); n++) if ((await rows.nth(n).getByRole("link", { name: subscriberName(person.current), exact: true }).count()) === 1) at = n;
        expect(at, subscriberName(person.current)).toBeGreaterThanOrEqual(0);
        for (const [n, earlier] of person.earlier.entries()) {
          const line = rows.nth(at + 1 + n);
          await expect(line).toContainText(mealLabel(earlier.options));
          await expect(line).toContainText(formatShortDate(earlier.joinedDate, "en"));
          await expect(line.getByText(STATUS)).toHaveText(en[`account.${earlier.status}`]);
          await expect(line.getByText(en["admin.members.refundOwed"], { exact: true })).toHaveCount(earlier.refundOwed ? 1 : 0);
          await expect(line.getByRole("link")).toHaveCount(0);
        }
      } else {
        const item = rowOf(page, person);
        for (const earlier of person.earlier) {
          await expect(item).toContainText(mealLabel(earlier.options));
          await expect(item).toContainText(formatShortDate(earlier.joinedDate, "en"));
        }
        await expect(item.getByText(en["admin.members.refundOwed"], { exact: true }).filter({ visible: true })).toHaveCount(
          [person.current, ...person.earlier].filter((subscription) => subscription.refundOwed).length,
        );
        await expect(item.getByRole("link")).toHaveCount(1);
      }
    }
  });

  test("AC4: Past opens every rolldown and is pressed; pressed again it closes every one and is not; a person's toggle works on its own either way", async ({ page }, testInfo) => {
    const [one] = rolled;
    if (!one) throw new Error("the beforeEach checks people have earlier subscriptions");
    await expect(past(page)).toHaveCount(1);

    await past(page).click();
    await expect(past(page)).toHaveAttribute("aria-pressed", "true");
    await expectOpen(page, testInfo, rolled);

    await toggleOf(page, one).click();
    await expectOpen(page, testInfo, rolled.filter((person) => person !== one));
    await toggleOf(page, one).click();
    await expectOpen(page, testInfo, rolled);

    await past(page).click();
    await expect(past(page)).toHaveAttribute("aria-pressed", "false");
    await expectOpen(page, testInfo, []);

    await toggleOf(page, one).click();
    await expectOpen(page, testInfo, [one]);
  });

  test("AC5: a search for a person with earlier subscriptions shows their one row, and not another's", async ({ page }) => {
    const [found, other] = rolled;
    if (!found || !other) throw new Error("the beforeEach checks two people have earlier subscriptions");

    await search(page).pressSequentially(found.current.email);

    await expect(rowOf(page, found)).toHaveCount(1);
    await expect(rowOf(page, other)).toHaveCount(0);
  });
});
