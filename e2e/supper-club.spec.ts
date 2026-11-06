// Issue 55, AC2: the choices survive the round trip in a real browser, cookies through redirects, on
// desktop and mobile. Issue 77: that round trip now runs through the Supper Club page's panes, and what
// only a browser can show lives here: the pane's place and width, what each width hides. Each test
// starts from an emptied e2e database with the `members` seed (fixtures.ts), and these add the
// `supper-club` seed. Controls are found by role and wording. Issue 56: a pick changing the words, the
// client stopping an unticked pay, a card refused before it is sent, and a paid signup, on the fake,
// through CardEntry's test field; a decline is proven in Vitest, because e2e cannot force one from the
// browser (DEC-023).
import type { APIRequestContext, Locator, Page, TestInfo } from "@playwright/test";
import { runSeed } from "../db/seed.js";
import { SQUARE_SANDBOX_VALUES } from "../src/adapters/square-payments.js";
import { en } from "../src/messages/en.js";
import { e2eDatabaseUrl } from "./database";
import { expect, outboxCount, test, waitForSignInCode } from "./fixtures";

const ERIC = "eric@ocf.xx";
const NEWCOMER = "new@ocf.xx";

const CREATE_PANE = "/supper-club/create-account";
const SIGN_IN_PANE = "/supper-club/sign-in";
const BACK_TO_CHOICES = "Back to your choices";
const LEFT_COLUMN_TITLE = en["supperClub.title"];
const SAGE_SOFT = "rgb(227, 235, 232)";

const onPath = (path: string) => (url: URL) => url.pathname === path;

// 2 people, which is not the default now that the seed puts 3–4 people first.
const size = (page: Page) => page.getByRole("radio", { name: /\$50 a week/ });
const menu = (page: Page) => page.getByRole("radio", { name: /Vegan/ });

const pressCreateAccount = (page: Page) => page.getByRole("button", { name: en["supperClub.createAccount"], exact: true }).click();
const pressSignIn = (page: Page) => page.getByRole("button", { name: en["home.signIn"], exact: true }).click();
const headerSignIn = (page: Page) => page.getByRole("banner").getByRole("link", { name: en["home.signIn"], exact: true });
const inMain = (page: Page, name: string) => page.getByRole("main").getByRole("link", { name, exact: true });

/** The innermost section holding `text`: the card it sits in. */
const cardHolding = (page: Page, text: string) => page.locator("section").filter({ hasText: text }).last();
const joinCard = (page: Page) => cardHolding(page, en["supperClub.joinTitle"]);
const paneCard = (page: Page, heading: string) => page.locator("section").filter({ has: page.getByRole("heading", { name: heading, exact: true }) }).last();

const desktopOnly = (testInfo: TestInfo) => test.skip(testInfo.project.name !== "desktop", "lg and wider");
const phoneOnly = (testInfo: TestInfo) => test.skip(testInfo.project.name !== "mobile", "below lg");

/** Picks the choices that are not the defaults, so nothing but the round trip can bring them back. */
async function pickChoices(page: Page): Promise<void> {
  await page.goto("/supper-club");
  await size(page).check();
  await menu(page).check();
}

async function expectChoicesKept(page: Page): Promise<void> {
  await expect(page).toHaveURL(onPath("/supper-club"));
  await expect(size(page)).toBeChecked();
  await expect(menu(page)).toBeChecked();
}

async function fillAccountDetails(page: Page, email: string): Promise<void> {
  await page.getByLabel("First name").fill("New");
  await page.getByLabel("Last name").fill("Comer");
  await page.getByLabel(en["signIn.emailLabel"], { exact: true }).fill(email);
  await page.getByLabel("Phone").fill("216-555-0100");
}

/** On the email step: asks for ERIC's code, and returns it once it reaches the outbox. */
async function askForCode(page: Page, request: APIRequestContext): Promise<string> {
  await page.getByLabel(en["signIn.emailLabel"]).fill(ERIC);
  const before = await outboxCount(request, ERIC);
  await page.getByRole("button", { name: en["signIn.sendCode"] }).click();
  await expect(page).toHaveURL(onPath(`${SIGN_IN_PANE}/code`));
  return waitForSignInCode(request, ERIC, before);
}

async function enterSignInCode(page: Page, code: string): Promise<void> {
  await page.getByLabel(en["signIn.codeLabel"]).fill(code);
  await page.getByRole("button", { name: en["signIn.submitCode"], exact: true }).click();
}

const testCard = (page: Page) => page.getByRole("textbox", { name: "Test card" });
const consent = (page: Page) => page.getByRole("checkbox");
const joinAndPay = (page: Page, price: string) => page.getByRole("button", { name: `Join and pay ${price}`, exact: true });

const REFUSED_CARD = "refused";
const CARD_FORM_FAILED = "The card form didn't load. Refresh the page and try again.";
// Exact, because the decline notice ends in the same words and is a different message.
const cardRefusal = (page: Page) => page.getByText("Check the card details or try another card.", { exact: true });

/** Signs ERIC in from the page with the non-default picks, so section 4 shows. */
async function signedIn(page: Page, request: APIRequestContext): Promise<void> {
  await pickChoices(page);
  await pressSignIn(page);
  await enterSignInCode(page, await askForCode(page, request));
  await expectChoicesKept(page);
}

async function pay(page: Page, card: string = SQUARE_SANDBOX_VALUES.cardNonceOk): Promise<void> {
  await testCard(page).fill(card);
  await consent(page).check();
  await joinAndPay(page, "$50").click();
}

/** Counts the pay form's POSTs from here on; pay stopping in the browser leaves it at 0. */
function countPayPosts(page: Page): () => number {
  let posts = 0;
  page.on("request", (sent) => {
    if (sent.method() === "POST" && new URL(sent.url()).pathname === "/supper-club") posts += 1;
  });
  return () => posts;
}

test.beforeEach(async () => {
  await runSeed("supper-club", e2eDatabaseUrl());
});

test('AC14: the Supper Club page shows the seed\'s new names: "How many people?", "2 people", "3–4 people", "Which menu?"', async ({ page }) => {
  await page.goto("/supper-club");
  for (const name of ["1. How many people?", "2. Which menu?"]) await expect(page.getByRole("group", { name })).toBeVisible();
  await expect(page.getByRole("radio", { name: /^2 people/ })).toBeVisible();
  await expect(page.getByRole("radio", { name: /^3–4 people/ })).toBeVisible();
});

test("AC1, AC9: Create an account opens the pane, a confirmed code lands back on the Supper Club page, signed in, the choices still picked", async ({ page, request }) => {
  await pickChoices(page);
  await pressCreateAccount(page);
  await expect(page).toHaveURL(onPath(CREATE_PANE));

  await fillAccountDetails(page, NEWCOMER);
  const before = await outboxCount(request, NEWCOMER);
  await page.getByRole("button", { name: en["signIn.sendCode"] }).click();
  await expect(page).toHaveURL(onPath(`${CREATE_PANE}/code`));

  const code = await waitForSignInCode(request, NEWCOMER, before);
  await page.getByLabel(en["signIn.codeLabel"]).fill(code);
  await page.getByRole("button", { name: "Confirm email" }).click();

  await expectChoicesKept(page);
  await expect(page.getByText(`Signed in as ${NEWCOMER}.`)).toBeVisible();
});

test("AC2, AC9: Sign in opens the pane, a code lands back on the Supper Club page, signed in, the choices still picked", async ({ page, request }) => {
  await pickChoices(page);
  await pressSignIn(page);
  await expect(page).toHaveURL(onPath(SIGN_IN_PANE));

  await enterSignInCode(page, await askForCode(page, request));

  await expectChoicesKept(page);
  await expect(page.getByText(`Signed in as ${ERIC}.`)).toBeVisible();
});

test("AC4: the header's Sign in goes to the pane, and a code confirmed with no return path lands on /supper-club", async ({ page, request }) => {
  await page.goto("/supper-club");
  await headerSignIn(page).click();
  await expect(page).toHaveURL(onPath(SIGN_IN_PANE));

  await enterSignInCode(page, await askForCode(page, request));

  await expect(page).toHaveURL(onPath("/supper-club"));
  await expect(page.getByText(`Signed in as ${ERIC}.`)).toBeVisible();
});

test("AC3: at lg the pane stands where the Join card stood, at its width, beside the left column", async ({ page, request }, testInfo) => {
  desktopOnly(testInfo);
  await pickChoices(page);
  const join = (await joinCard(page).boundingBox())!;
  const left = page.getByText(LEFT_COLUMN_TITLE);

  const expectInPlace = async (card: Locator) => {
    await expect(left).toBeVisible();
    await expect(page.getByText(en["supperClub.joinTitle"])).toHaveCount(0);
    const box = await card.boundingBox();
    expect(box?.x).toBeCloseTo(join.x, 0);
    expect(box?.width).toBeCloseTo(join.width, 0);
  };

  await pressSignIn(page);
  await expect(page).toHaveURL(onPath(SIGN_IN_PANE));
  await expectInPlace(paneCard(page, en["signIn.title"]));

  await page.goto(CREATE_PANE);
  await expectInPlace(paneCard(page, en["createAccount.title"]));

  await page.goto(SIGN_IN_PANE);
  await askForCode(page, request);
  await expectInPlace(paneCard(page, en["signIn.codeTitle"]));
});

test('AC5: on the sign-in pane the header\'s Sign in is marked current, filled sage-soft, and from the code step returns to the email step', async ({ page, request }, testInfo) => {
  desktopOnly(testInfo);
  await page.goto("/supper-club");
  await expect(headerSignIn(page)).not.toHaveAttribute("aria-current", "page");

  await page.goto(SIGN_IN_PANE);
  await expect(headerSignIn(page)).toHaveAttribute("aria-current", "page");
  await expect(headerSignIn(page)).toHaveCSS("background-color", SAGE_SOFT);

  await askForCode(page, request);
  await expect(headerSignIn(page)).toHaveAttribute("aria-current", "page");
  await headerSignIn(page).click();

  await expect(page).toHaveURL(onPath(SIGN_IN_PANE));
  await expect(page.getByLabel(en["signIn.emailLabel"])).toBeVisible();
});

test("AC6: Back to your choices leaves either pane for the Supper Club page, the choices still picked", async ({ page }, testInfo) => {
  desktopOnly(testInfo);
  await pickChoices(page);
  await pressSignIn(page);
  await inMain(page, BACK_TO_CHOICES).click();
  await expectChoicesKept(page);

  await pressCreateAccount(page);
  await inMain(page, BACK_TO_CHOICES).click();
  await expectChoicesKept(page);
});

test("AC7: the closing lines switch panes, and the choices survive the switch to the end of the flow", async ({ page, request }) => {
  await pickChoices(page);
  await pressSignIn(page);

  await inMain(page, en["supperClub.createAccount"]).click();
  await expect(page).toHaveURL(onPath(CREATE_PANE));
  await inMain(page, en["home.signIn"]).click();
  await expect(page).toHaveURL(onPath(SIGN_IN_PANE));

  await enterSignInCode(page, await askForCode(page, request));
  await expectChoicesKept(page);
});

test("AC7: on the full pages the closing lines go to the full pages", async ({ page }) => {
  await page.goto("/sign-in");
  await inMain(page, en["supperClub.createAccount"]).click();
  await expect(page).toHaveURL(onPath("/create-account"));
  await inMain(page, en["home.signIn"]).click();
  await expect(page).toHaveURL(onPath("/sign-in"));
});

test("AC8: field errors stay in the pane with the form refilled", async ({ page }) => {
  await page.goto(CREATE_PANE);
  await fillAccountDetails(page, "not-an-email");
  await page.getByRole("button", { name: en["signIn.sendCode"] }).click();

  await expect(page).toHaveURL(onPath(CREATE_PANE));
  await expect(page.getByText(en["createAccount.error.email"])).toBeVisible();
  await expect(page.getByLabel("First name")).toHaveValue("New");
});

test("AC8: a resent code and a wrong code stay in the pane", async ({ page }) => {
  await page.goto(CREATE_PANE);
  await fillAccountDetails(page, NEWCOMER);
  await page.getByRole("button", { name: en["signIn.sendCode"] }).click();
  await expect(page).toHaveURL(onPath(`${CREATE_PANE}/code`));

  await page.getByLabel(en["signIn.codeLabel"]).fill("000000");
  await page.getByRole("button", { name: "Confirm email" }).click();
  await expect(page).toHaveURL(onPath(`${CREATE_PANE}/code`));
  await expect(page.getByText(en["signIn.invalidCode"])).toBeVisible();

  // The whole URL, not onPath, which ignores the query: resend redirects to the path it is already on, so
  // `?error=invalid` going is the only sign it finished.
  await page.getByRole("button", { name: en["signIn.resend"] }).click();
  await expect(page).toHaveURL(`${CREATE_PANE}/code`);
  await expect(page.getByText(en["signIn.invalidCode"])).toHaveCount(0);
});

test("AC11: below lg a pane page is the card alone, centred at card width, with no left column, back link or header Sign in", async ({ page }, testInfo) => {
  phoneOnly(testInfo);
  // 375 is the phone, where a card fills the gutters; 768 is tablet, which uses mobile.
  for (const width of [375, 768]) {
    await page.setViewportSize({ width, height: 900 });

    for (const [path, heading] of [
      [CREATE_PANE, en["createAccount.title"]],
      [SIGN_IN_PANE, en["signIn.title"]],
    ] as const) {
      await page.goto(path);
      await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
      await expect(page.getByText(LEFT_COLUMN_TITLE)).toBeHidden();
      await expect(page.getByText(BACK_TO_CHOICES)).toBeHidden();
      await expect(headerSignIn(page)).toBeHidden();
      await expect(page.getByRole("banner").getByRole("button", { name: "English" })).toBeVisible();

      const box = (await paneCard(page, heading).boundingBox())!;
      expect(box.x + box.width / 2).toBeCloseTo(width / 2, 0);
      expect(box.width).toBeCloseTo(Math.min(376, width - 32), 0);
    }
  }
});

test("AC11: below lg the Supper Club page itself keeps its left column and header Sign in", async ({ page }, testInfo) => {
  phoneOnly(testInfo);
  await page.goto("/supper-club");
  await expect(page.getByText(LEFT_COLUMN_TITLE)).toBeVisible();
  await expect(headerSignIn(page)).toBeVisible();
});

test("AC1 (issue 56): signed in, section 4 sits in the same card under section 3, the checkbox unticked", async ({ page, request }) => {
  await signedIn(page, request);
  const card = joinCard(page);
  await expect(card.getByText(`Signed in as ${ERIC}.`)).toBeVisible();
  await expect(card.getByText("4. Payment")).toBeVisible();
  await expect(card.getByText("Today, for your first week")).toBeVisible();
  await expect(consent(page)).not.toBeChecked();
  await expect(joinAndPay(page, "$50")).toBeVisible();
});

test("AC2 (issue 56): a changed pick updates the price panel, the checkbox sentence and the button, with no new page", async ({ page, request }) => {
  await signedIn(page, request);
  const url = page.url();
  await page.getByRole("radio", { name: /\$80 a week/ }).check();

  await expect(joinAndPay(page, "$80")).toBeVisible();
  await expect(page.getByText("I agree to a weekly charge of $80 until I cancel, and to the Terms and Privacy Policy.")).toBeVisible();
  await expect(page.getByText("your card is charged $80 at the end of each Monday")).toBeVisible();
  expect(page.url()).toBe(url);
});

test("AC4 (issue 56): pay with the box unticked stays on the page and says why", async ({ page, request }) => {
  await signedIn(page, request);
  await testCard(page).fill(SQUARE_SANDBOX_VALUES.cardNonceOk);
  await joinAndPay(page, "$50").click();

  await expect(page.getByText("Check the box to agree to the weekly charge.")).toBeVisible();
  await expect(page).toHaveURL(onPath("/supper-club"));
  await expect(size(page)).toBeChecked();
});

test("AC11 (issue 56): pay is disabled while the action runs, so a double-click sends one token", async ({ page, request }) => {
  await signedIn(page, request);
  await testCard(page).fill(SQUARE_SANDBOX_VALUES.cardNonceOk);
  await consent(page).check();

  let posts = 0;
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(onPath("/supper-club"), async (route) => {
    if (route.request().method() === "POST") {
      posts += 1;
      await held;
    }
    await route.continue();
  });

  const button = joinAndPay(page, "$50");
  try {
    await button.dblclick();
    await expect(button).toBeDisabled();
  } finally {
    release();
  }
  await expect(page).toHaveURL(onPath("/supper-club/done"));
  expect(posts).toBe(1);
});

// The test field stands in for Square's form: an empty one is `tokenize` throwing, and the value `refused` is
// the `TokenizationError` Square throws for a card it rejects. Square's script failing to load and a real
// throw cannot be reached from here: the e2e server always draws the test field.
test("AC1 (issue 56): a card form that gives no token shows the failure in the field's place, and pay stops there", async ({ page, request }) => {
  await signedIn(page, request);
  await consent(page).check();
  const posts = countPayPosts(page);

  await joinAndPay(page, "$50").click();

  await expect(page.getByText(CARD_FORM_FAILED)).toBeVisible();
  await expect(testCard(page)).toHaveCount(0);
  await expect(page).toHaveURL(onPath("/supper-club"));
  expect(posts()).toBe(0);
});

test("AC1 (issue 56): a card Square refuses keeps the field, says so under it and submits nothing, and a good card then pays", async ({ page, request }) => {
  await signedIn(page, request);
  const posts = countPayPosts(page);

  await pay(page, REFUSED_CARD);

  await expect(cardRefusal(page)).toBeVisible();
  await expect(testCard(page)).toBeVisible();
  const field = (await testCard(page).boundingBox())!;
  expect((await cardRefusal(page).boundingBox())!.y).toBeGreaterThanOrEqual(field.y + field.height);
  await expect(page.getByText(CARD_FORM_FAILED)).toHaveCount(0);
  await expect(page).toHaveURL(onPath("/supper-club"));
  await expect(page.getByRole("checkbox")).toBeChecked();
  expect(posts()).toBe(0);

  // Retyping does not clear it: it stays until the next pay.
  await testCard(page).fill(SQUARE_SANDBOX_VALUES.cardNonceOk);
  await expect(cardRefusal(page)).toBeVisible();

  await pay(page);
  await expect(page).toHaveURL(onPath("/supper-club/done"));
});

test("AC1 (issue 56): a refusal lasts until the next pay, and an empty field then still shows the failure in the field's place", async ({ page, request }) => {
  await signedIn(page, request);
  const posts = countPayPosts(page);

  await pay(page, REFUSED_CARD);
  await expect(cardRefusal(page)).toBeVisible();

  await pay(page, "");

  await expect(page.getByText(CARD_FORM_FAILED)).toBeVisible();
  await expect(cardRefusal(page)).toHaveCount(0);
  await expect(testCard(page)).toHaveCount(0);
  await expect(page).toHaveURL(onPath("/supper-club"));
  expect(posts()).toBe(0);
});

test("AC8, AC13 (issue 56): at lg a paid signup opens the confirmation in the right pane, the left column beside it", async ({ page, request }, testInfo) => {
  desktopOnly(testInfo);
  await signedIn(page, request);
  const join = (await joinCard(page).boundingBox())!;
  await pay(page);

  await expect(page).toHaveURL(onPath("/supper-club/done"));
  await expect(page.getByText("You're in the Supper Club")).toBeVisible();
  await expect(page.getByText(LEFT_COLUMN_TITLE)).toBeVisible();
  const box = (await page.locator("section").filter({ hasText: "You're in the Supper Club" }).last().boundingBox())!;
  expect(box.x).toBeCloseTo(join.x, 0);
  await expect(page.getByRole("banner").getByRole("link", { name: "Your account", exact: true })).toBeVisible();
});

test("AC8, AC13 (issue 56): below lg a paid signup shows the confirmation alone", async ({ page, request }, testInfo) => {
  phoneOnly(testInfo);
  await signedIn(page, request);
  await pay(page);

  await expect(page).toHaveURL(onPath("/supper-club/done"));
  await expect(page.getByText("You're in the Supper Club")).toBeVisible();
  await expect(page.getByText(LEFT_COLUMN_TITLE)).toBeHidden();
  await expect(page.getByRole("banner").getByRole("link", { name: "Your account", exact: true })).toBeVisible();
});

test("AC5 (issue 56): a member with a box who opens /supper-club lands on the already page, and goes on to their account", async ({ page, request }) => {
  await signedIn(page, request);
  await pay(page);
  await expect(page).toHaveURL(onPath("/supper-club/done"));

  await page.goto("/supper-club");
  await expect(page).toHaveURL(onPath("/supper-club/already"));
  await expect(page.getByText("You already have a Supper Club box")).toBeVisible();
  await page.getByRole("main").getByRole("link", { name: "Go to your account", exact: true }).click();
  await expect(page).toHaveURL(onPath("/"));
});
