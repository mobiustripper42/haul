// Issue 271: a URL the app has no page for, and a page that finds nothing, answer 404 with the farm's Not Found page.
// The status only the real server shows; what the page holds, and where its link goes, is Vitest's (app/not-found.test.ts,
// app/home-path.test.ts). Here: the status, the site header, and one link onward, and that a page calling `notFound()`
// shows the same page as a URL no route matches, read as its main's text under the same session.
import type { Page } from "@playwright/test";
import { expect, signIn, test } from "./fixtures";

const LENNY = "lenny@ocf.xx";
/** A path no route matches (issue 271). */
const NO_SUCH_PATH = "/menuK";
/** An id in the shape the database's ids take, which nothing has. */
const NO_SUCH_ID = "00000000-0000-4000-8000-000000000000";

// `next dev` compiles a route on its first visit, and most of these visit several.
test.describe.configure({ timeout: 90_000 });

/** Opens `path` and expects a 404 with the site header and exactly one link in the page's main; returns the main's text. */
async function expectNotFoundPage(page: Page, path: string): Promise<string> {
  const response = await page.goto(path);
  expect(response?.status(), `${path}'s status`).toBe(404);
  await expect(page.getByRole("banner"), `${path} has no site header`).toBeVisible();
  const main = page.getByRole("main");
  await expect(main.getByRole("link")).toHaveCount(1);
  return (await main.innerText()).trim();
}

test.describe("AC6 (issue 271) — a URL with no page", () => {
  test(`AC6: ${NO_SUCH_PATH} answers 404 with the site header and one link onward`, async ({ page }) => {
    await expectNotFoundPage(page, NO_SUCH_PATH);
  });
});

test.describe("AC8 (issue 271) — a page that finds nothing shows the same page", () => {
  for (const [what, path] of [
    ["Edit menu, for a menu nobody has", `/admin/menus/${NO_SUCH_ID}`],
    ["an admin's member page, for a subscription nobody has", `/admin/members/${NO_SUCH_ID}`],
  ] as const) {
    test(`AC8: ${what}, answers 404 with the page ${NO_SUCH_PATH} shows`, async ({ page, request }) => {
      await signIn(page, request, LENNY, "/admin");

      const shown = await expectNotFoundPage(page, path);

      expect(shown).toBe(await expectNotFoundPage(page, NO_SUCH_PATH));
    });
  }

  test(`AC8: the menu emails page, for a link whose token is not the member's, answers 404 with the page ${NO_SUCH_PATH} shows`, async ({ page }) => {
    const shown = await expectNotFoundPage(page, `/menu-emails?${new URLSearchParams({ m: NO_SUCH_ID, t: "not-the-token" })}`);

    expect(shown).toBe(await expectNotFoundPage(page, NO_SUCH_PATH));
  });
});
