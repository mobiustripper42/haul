// Issue 97: `/` is no longer the developer placeholder; it redirects to /supper-club, on desktop and
// mobile. AC1's status code only a real request shows; the unit test (app/page.test.ts) sees only the
// target. AC2's landings follow the redirect with the session cookie set, which only a browser does:
// the code and link sign-ins are in sign-in.spec.ts, a turned-away /admin in admin-members.spec.ts,
// and Create Account here. Each test starts from an emptied e2e database with the `members` and
// `supper-club` seeds (fixtures.ts). Controls are found by role and the English wording in `en`.
import { en } from "../src/messages/en.js";
import { expect, headerSignOut, outboxCount, test, waitForSignInCode } from "./fixtures";

const NEWCOMER = "new@ocf.xx";

const onPath = (path: string) => (url: URL) => url.pathname === path;

test("AC1: / answers with a temporary redirect, a 307, whose Location is /supper-club", async ({ request }) => {
  const response = await request.get("/", { maxRedirects: 0 });

  expect(response.status()).toBe(307);
  expect(response.headers()["location"]).toBe("/supper-club");
});

test("AC2: creating an account at /create-account ends on /supper-club, signed in", async ({ page, request }) => {
  await page.goto("/create-account");
  await page.getByLabel(en["createAccount.firstName"]).fill("New");
  await page.getByLabel(en["createAccount.lastName"]).fill("Comer");
  await page.getByLabel(en["signIn.emailLabel"], { exact: true }).fill(NEWCOMER);
  await page.getByLabel(en["createAccount.phone"], { exact: true }).fill("216-555-0100");
  const before = await outboxCount(request, NEWCOMER);
  await page.getByRole("button", { name: en["signIn.sendCode"] }).click();
  await expect(page).toHaveURL(onPath("/create-account/code"));

  const code = await waitForSignInCode(request, NEWCOMER, before);
  await page.getByLabel(en["signIn.codeLabel"]).fill(code);
  await page.getByRole("button", { name: en["createAccount.confirm"], exact: true }).click();

  await expect(page).toHaveURL(onPath("/supper-club"));
  await expect(headerSignOut(page)).toBeVisible();
});
