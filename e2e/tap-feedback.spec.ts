// Issue 240: every button and in-app link shows it was tapped, and the page is locked while a form is being sent but not
// while a link opens. What WaitingLabel draws is Vitest's (components/ui/waiting-label.test.ts), as is a download's plain <a>
// (components/ui/button.test.ts); when a control shows the ring, what is locked and when it is let go, only a browser can
// show. The menus (AC14–AC16) are e2e/client-navigation.spec.ts's. The pressed look, reduced motion, a production build's
// prefetched links and Square's bank check (AC1, AC2, AC12, AC8's last part) are by hand.
// A send or a page is kept waiting by holding its request. A control is found by its element, not its words, so it is the
// same control when the ring covers them. "Locked" is what a person can do: nothing takes the focus and no point of the
// page hits a control (`reachable`).
import type { Locator, Page, Request } from "@playwright/test";
import { runSeed } from "../db/seed.js";
import { SQUARE_SANDBOX_VALUES } from "../src/adapters/square-payments.js";
import { e2eDatabaseUrl } from "./database";
import { expect, headerMenu, headerSignOut, outboxCount, signIn, test } from "./fixtures";

const ERIC = "eric@ocf.xx";
const LENNY = "lenny@ocf.xx";

const onPath = (path: string) => (url: URL) => url.pathname === path;

// `next dev` compiles a route on its first visit, and most of these visit several.
test.describe.configure({ timeout: 90_000 });

type Held = { count(): number; firstUrl(): URL; release(): void; fail(): void };

/** Holds every request to `path` that `matches` until `release` lets them through or `fail` aborts them. */
async function hold(page: Page, path: string, matches: (request: Request) => boolean): Promise<Held> {
  let settle: (outcome: "release" | "fail") => void = () => {};
  const settled = new Promise<"release" | "fail">((resolve) => {
    settle = resolve;
  });
  const urls: string[] = [];
  await page.route(onPath(path), async (route) => {
    if (!matches(route.request())) return route.continue();
    urls.push(route.request().url());
    if ((await settled) === "fail") return route.abort();
    // A link the person changed their mind about has had its request cancelled.
    await route.continue().catch(() => {});
  });
  return { count: () => urls.length, firstUrl: () => new URL(urls[0] ?? "held:nothing"), release: () => settle("release"), fail: () => settle("fail") };
}
const holdSends = (page: Page, path: string) => hold(page, path, (request) => request.method() === "POST");
const holdPages = (page: Page, path: string) => hold(page, path, (request) => request.method() === "GET");

const expectHeld = (held: Held) => expect.poll(() => held.count(), { message: "the tap asked the server for nothing" }).toBeGreaterThan(0);

const ringIn = (control: Locator) => control.locator('[aria-hidden="true"]');
/** How many elements of the page match, the dev server's own overlay (a shadow root, which a locator reads into) aside. */
const expectCount = (page: Page, selector: string, count: number) => expect.poll(() => page.evaluate((css) => document.querySelectorAll(css).length, selector), { message: selector }).toBe(count);
const expectNothingInert = (page: Page) => expectCount(page, "[inert]", 0);

/** The name a screen reader hears for `control`, as the accessibility tree gives it. */
async function nameOf(control: Locator): Promise<string> {
  const name = /^- '?\w+ "([^"]*)"/.exec(await control.ariaSnapshot())?.[1];
  expect(name, "the control has no accessible name").toBeTruthy();
  return name ?? "";
}

/** A button at rest: on, not busy, and without the ring. */
async function expectAtRest(button: Locator): Promise<void> {
  await expect(button).toBeEnabled();
  await expect(button).not.toHaveAttribute("aria-busy", "true");
  await expect(ringIn(button)).toHaveCount(0);
}

/** `button`'s form is being sent: it is off, busy and shows the one ring, and no other button does. `words` are its text at rest. */
async function expectSending(page: Page, button: Locator, words: string): Promise<void> {
  await expect(button).toBeDisabled();
  await expect(button).toHaveAttribute("aria-busy", "true");
  await expect(ringIn(button)).toHaveCount(1);
  await expect(ringIn(button)).toBeVisible();
  await expectCount(page, 'button[aria-busy="true"]', 1);
  await expectCount(page, 'button [aria-hidden="true"]', 1);
  // A screen reader still finds it, by the same name, its words written once.
  expect(await nameOf(button)).toBe(words);
  expect(((await button.textContent()) ?? "").trim()).toBe(words);
  expect(await button.evaluate((el) => el.closest("[inert]") === null), "the tapped button is inert").toBe(true);
}

/**
 * Run in the page: every control that takes the focus, or that a tap on its middle would land on, as its tag and its name,
 * address or words. A control that is off is neither.
 */
function reachableControls(): string[] {
  const controls = document.querySelectorAll<HTMLElement>('a[href], button, input:not([type="hidden"]), select, textarea, summary, label');
  return [...controls]
    .filter((el) => {
      if (el.matches(":disabled")) return false;
      el.focus({ preventScroll: true });
      const focused = document.activeElement === el;
      if (focused) el.blur();
      const box = el.getBoundingClientRect();
      const hit = box.width > 0 && box.height > 0 ? document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2) : null;
      return focused || (hit !== null && el.contains(hit));
    })
    .map((el) => `${el.tagName.toLowerCase()} ${el.getAttribute("name") ?? el.getAttribute("href") ?? el.textContent?.trim()}`);
}
const reachable = (page: Page): Promise<string[]> => page.evaluate(reachableControls);

/** The page is locked: nothing but `spared` can be reached. Polled: the lock follows the ring by a moment. */
const expectLocked = (page: Page, spared: string[] = []) => expect.poll(() => reachable(page)).toEqual(spared);

async function expectUnlocked(page: Page): Promise<void> {
  await expectNothingInert(page);
  await expect.poll(async () => (await reachable(page)).length).toBeGreaterThan(0);
}

// ---------------------------------------------------------------------------------------------
// The screens.

const submitIn = (form: string) => `${form} button[type="submit"]`;

/** /sign-in's one form. */
const EMAIL_FIELD = 'main input[name="email"]';
const sendCode = (page: Page) => page.locator(submitIn('form:has(input[type="email"])'));

async function onSignIn(page: Page): Promise<void> {
  await page.goto("/sign-in");
  await page.locator(EMAIL_FIELD).fill(ERIC);
}

/** The code step: the code's form and the resend form. */
const confirmCode = (page: Page) => page.locator(submitIn('form:has(input[name="code"])'));
const resendCode = (page: Page) => page.locator(submitIn('form:has(input[name="resend"])'));

async function onCodeStep(page: Page): Promise<void> {
  await onSignIn(page);
  await sendCode(page).click();
  await expect(page).toHaveURL(onPath("/sign-in/code"));
  await expectAtRest(confirmCode(page));
}

/** The Supper Club's pay form. */
const PAY_BUTTON = submitIn('form:has(input[name="consent"])');
const CONSENT = 'input[name="consent"]';
const CARD = 'input[name="sourceId"]';

async function onPay(page: Page, request: Parameters<typeof signIn>[1]): Promise<void> {
  await signIn(page, request, ERIC);
  // A fresh load: signing in opened the drawer, below 1024px, to find Sign out.
  await page.goto("/supper-club");
  await expectAtRest(page.locator(PAY_BUTTON));
}

async function fillPay(page: Page): Promise<void> {
  await page.locator(CARD).fill(SQUARE_SANDBOX_VALUES.cardNonceOk);
  await page.locator(CONSENT).check();
}

const wordsOf = async (button: Locator): Promise<string> => ((await button.textContent()) ?? "").trim();

// ---------------------------------------------------------------------------------------------

test.describe("AC3 — the tapped button", () => {
  test("AC3: while its form is being sent the tapped button is off, busy and shows the ring, and the page's other buttons do not", async ({ page }) => {
    await onCodeStep(page);
    const button = resendCode(page);
    const words = await wordsOf(button);
    const held = await holdSends(page, "/sign-in/code");

    await button.click({ noWaitAfter: true });
    await expectHeld(held);

    await expectSending(page, button, words);
    await expect(ringIn(confirmCode(page))).toHaveCount(0);

    held.release();
    await expect(page).toHaveURL((url) => url.pathname === "/sign-in/code" && url.searchParams.get("sent") === "1");
    await expectAtRest(button);
  });

  test("AC3: Enter in a field is a tap on the form's submit button: it gets the ring and the page locks", async ({ page }) => {
    await onSignIn(page);
    const button = sendCode(page);
    const words = await wordsOf(button);
    const held = await holdSends(page, "/sign-in");

    await page.locator(EMAIL_FIELD).press("Enter", { noWaitAfter: true });
    await expectHeld(held);

    await expectSending(page, button, words);
    await expectLocked(page);
    held.release();
    await expect(page).toHaveURL(onPath("/sign-in/code"));
  });
});

test.describe("AC4 — the page is locked while a form is being sent", () => {
  test("AC4: no other control can be tapped or reached by keyboard, and a second tap sends nothing", async ({ page, request }) => {
    await onSignIn(page);
    expect((await reachable(page)).length, "nothing on the page can be reached before the send").toBeGreaterThan(1);
    const before = await outboxCount(request, ERIC);
    const held = await holdSends(page, "/sign-in");
    const button = sendCode(page);
    await button.scrollIntoViewIfNeeded();
    const box = (await button.boundingBox())!;

    await button.click({ noWaitAfter: true });
    await expectHeld(held);

    await expectLocked(page);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { clickCount: 2 });
    await page.keyboard.press("Enter");
    await expect(button).toBeDisabled();

    held.release();
    await expect(page).toHaveURL(onPath("/sign-in/code"));
    await expect.poll(() => outboxCount(request, ERIC)).toBeGreaterThan(before);
    expect(held.count(), "the second tap sent the form again").toBe(1);
    expect(await outboxCount(request, ERIC)).toBe(before + 1);
  });

  test("AC4: below 1024px, closing the drawer while its Sign out is being sent leaves the page locked", async ({ page, request }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "the drawer is the phone width's");
    await signIn(page, request, LENNY, "/admin");
    await page.goto("/admin");
    const drawer = page.locator("details[data-menu-drawer]");
    await headerMenu(page).click();
    await expect(drawer).toHaveJSProperty("open", true);
    const button = drawer.locator('button[type="submit"]');
    const words = await wordsOf(button);
    const held = await holdSends(page, "/admin");

    await headerSignOut(page).click({ noWaitAfter: true });
    await expectHeld(held);
    await expectSending(page, button, words);
    await expectLocked(page);

    await page.keyboard.press("Escape");
    await expect(drawer).toHaveJSProperty("open", false);
    expect(await reachable(page), "closing the drawer unlocked the page").toEqual([]);

    held.release();
    // Signed out: the header's account links are gone, and so is the drawer.
    await expect(drawer).toHaveCount(0);
    await expectUnlocked(page);
  });
});

test.describe("AC5 — the ring stays 600ms", () => {
  test("AC5: a Pay stopped in the browser keeps the button busy and off, with its ring, until 600ms after the tap, and the rest of the page is unlocked before that", async ({ page, request }) => {
    await onPay(page, request);
    type Sample = { at: number; busy: boolean; off: boolean; ring: boolean; locked: boolean };
    // One sample a frame, from the tap on: the answer comes in a few milliseconds, sooner than a check from out here.
    await page.evaluate(
      ({ button: buttonIs, consent }) => {
        const button = document.querySelector<HTMLButtonElement>(buttonIs)!;
        const rest = document.querySelector(consent)!;
        const samples: Sample[] = [];
        Object.assign(window, { haulSamples: samples });
        let tapped = 0;
        button.addEventListener("click", () => (tapped = performance.now()), { capture: true, once: true });
        const sample = () => {
          if (tapped > 0) {
            samples.push({
              at: performance.now() - tapped,
              busy: button.getAttribute("aria-busy") === "true",
              off: button.disabled,
              ring: button.querySelector('[aria-hidden="true"]') !== null,
              locked: rest.closest("[inert]") !== null,
            });
          }
          requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      },
      { button: PAY_BUTTON, consent: CONSENT },
    );
    const samplesNow = () => page.evaluate(() => (window as unknown as { haulSamples: Sample[] }).haulSamples);

    await page.locator(PAY_BUTTON).click();
    await expect(page.locator("#consent-error"), "the unticked box did not stop the Pay").toBeVisible();
    await expect.poll(async () => (await samplesNow()).at(-1)?.at ?? 0).toBeGreaterThan(1500);
    const samples = await samplesNow();

    const first = samples.findIndex((sample) => sample.busy);
    expect(first, "the button was never busy").toBeGreaterThan(-1);
    const ended = samples.findIndex((sample, at) => at > first && !sample.busy);
    expect(ended, "the button was still busy 1.5s after the tap").toBeGreaterThan(-1);
    // A frame's slack under 600ms, for the timer; well short of a second hold over it.
    expect(samples[ended]?.at).toBeGreaterThanOrEqual(590);
    expect(samples[ended]?.at).toBeLessThan(1100);
    expect(samples.slice(first, ended).filter((sample) => sample.at > 100 && (!sample.off || !sample.ring)), "the ring or the off state dropped while busy").toEqual([]);
    expect(samples.slice(ended).filter((sample) => sample.busy || sample.off || sample.ring || sample.locked), "something came back after the hold").toEqual([]);
    // The answer came in the browser, in far less than the hold.
    const late = samples.slice(first, ended).filter((sample) => sample.at > 350);
    expect(late.length, "no frame was sampled late in the hold").toBeGreaterThan(0);
    expect(late.filter((sample) => sample.locked), "the rest of the page stayed locked with the ring").toEqual([]);
  });
});

test.describe("AC6 — every answer unlocks the page", () => {
  test("AC6: a send that succeeds, opening another page, unlocks it, the footer that stays included", async ({ page }) => {
    await onSignIn(page);
    const held = await holdSends(page, "/sign-in");
    await sendCode(page).click({ noWaitAfter: true });
    await expectHeld(held);
    await expectLocked(page);

    held.release();

    await expect(page).toHaveURL(onPath("/sign-in/code"));
    await expectUnlocked(page);
    await expectAtRest(confirmCode(page));
  });

  test("AC6: a send that is refused, coming back to the same page, unlocks it and turns the button back on", async ({ page }) => {
    await onCodeStep(page);
    await page.locator('input[name="code"]').fill("000000");
    const held = await holdSends(page, "/sign-in/code");
    await confirmCode(page).click({ noWaitAfter: true });
    await expectHeld(held);
    await expectLocked(page);

    held.release();

    await expect(page).toHaveURL((url) => url.pathname === "/sign-in/code" && url.searchParams.get("error") === "invalid");
    await expectUnlocked(page);
    await expectAtRest(confirmCode(page));
  });

  test("AC6: a send that fails leaves nothing inert on the error screen that replaces the page", async ({ page }) => {
    await onSignIn(page);
    const held = await holdSends(page, "/sign-in");
    await sendCode(page).click({ noWaitAfter: true });
    await expectHeld(held);
    await expectLocked(page);

    held.fail();

    // Next's own error screen, in the form's place.
    await expect(sendCode(page)).toHaveCount(0);
    await expectNothingInert(page);
  });
});

test.describe("AC7 — the focus comes back to the button", () => {
  test("AC7: a button that had the keyboard focus has it again when its ring ends", async ({ page, request }) => {
    await onPay(page, request);
    const button = page.locator(PAY_BUTTON);

    await button.focus();
    await page.keyboard.press("Enter");

    await expect(button).toHaveAttribute("aria-busy", "true");
    await expectAtRest(button);
    await expect(button).toBeFocused();
  });

  test("AC7: the focus stays where it is when something else has it by then", async ({ page, request }) => {
    await onPay(page, request);
    const button = page.locator(PAY_BUTTON);

    // Once the answer has unlocked the page and the ring has not ended, the box takes the focus. Watching before the tap: there are 600ms to catch.
    const taken = page.waitForFunction(
      ({ button: buttonIs, consent }) => {
        const box = document.querySelector<HTMLInputElement>(consent);
        if (document.querySelector(buttonIs)?.getAttribute("aria-busy") !== "true" || !box || box.closest("[inert]")) return false;
        box.focus();
        return document.activeElement === box;
      },
      { button: PAY_BUTTON, consent: CONSENT },
      { timeout: 5_000 },
    );
    const caught = taken.then(
      () => true,
      () => false,
    );
    await button.focus();
    await page.keyboard.press("Enter");
    expect(await caught, "the button was never busy with the rest of the page unlocked").toBe(true);

    await expectAtRest(button);
    // Two frames: a focus that comes back with the ring's end has come by then.
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect(page.locator(CONSENT)).toBeFocused();
  });
});

test.describe("AC8 — the card box is locked with the rest of the page", () => {
  test("AC8: while Pay is being sent the card box is locked with the rest of the page, and anything added to the page since can be used", async ({ page, request }) => {
    await onPay(page, request);
    await fillPay(page);
    const held = await holdSends(page, "/supper-club");

    await page.locator(PAY_BUTTON).click({ noWaitAfter: true });
    await expectHeld(held);

    await expectLocked(page);
    // What Square adds (a bank check) is not there to test with; this stands in for where it would go.
    await page.evaluate(() => {
      const added = document.createElement("button");
      added.name = "added";
      document.body.append(added);
      added.textContent = "x";
    });
    await expectLocked(page, ["button added"]);

    held.release();
    await expect(page).toHaveURL(onPath("/supper-club/done"));
    await expectUnlocked(page);
  });

  test("AC8: while Save card is being sent the card box is locked with the rest of the page", async ({ page, request }) => {
    await onPay(page, request);
    await fillPay(page);
    await page.locator(PAY_BUTTON).click();
    await expect(page).toHaveURL(onPath("/supper-club/done"));
    await page.goto("/account/card");
    await page.locator(CARD).fill(SQUARE_SANDBOX_VALUES.cardNonceOk);
    const button = page.locator(submitIn(`form:has(${CARD})`));
    const words = await wordsOf(button);
    const held = await holdSends(page, "/account/card");

    await button.click({ noWaitAfter: true });
    await expectHeld(held);

    await expectSending(page, button, words);
    await expectLocked(page);
    held.release();
    await expect(page).toHaveURL((url) => url.pathname === "/account/card" && url.searchParams.has("state"));
    await expectUnlocked(page);
  });
});

/** A form that loads a whole page, as the page itself reports it while the new page is held. */
type Report = { restored: boolean; off: boolean; busy: boolean; inert: boolean; words: string; busyButtons: number; rings: number; inertOnPage: number; reachable: string[] };

/**
 * Chromium runs no script from out here while a whole page is on its way, so the page watches itself: from its form's
 * submit on, it reports what it finds to the console. `restore`, when given, is how long after the submit the page is told
 * it was restored from the back-forward cache, which Playwright turns off.
 */
async function watchSend(page: Page, button: string, restore?: number): Promise<Report[]> {
  const reports: Report[] = [];
  page.on("console", (message) => {
    const [, report] = /^haul-report (.*)$/.exec(message.text()) ?? [];
    if (report) reports.push(JSON.parse(report) as Report);
  });
  await page.evaluate(
    ({ buttonIs, controls, restoreAfter }) => {
      const reachableNow = new Function(`return (${controls})()`) as () => string[];
      let restored = false;
      const report = () => {
        const el = document.querySelector<HTMLButtonElement>(buttonIs)!;
        const found: Report = {
          restored,
          off: el.disabled,
          busy: el.getAttribute("aria-busy") === "true",
          inert: el.closest("[inert]") !== null,
          words: (el.textContent ?? "").trim(),
          busyButtons: document.querySelectorAll('button[aria-busy="true"]').length,
          rings: document.querySelectorAll('button [aria-hidden="true"]').length,
          inertOnPage: document.querySelectorAll("[inert]").length,
          reachable: reachableNow(),
        };
        console.log(`haul-report ${JSON.stringify(found)}`);
      };
      const start = () => {
        setInterval(report, 100);
        if (restoreAfter === undefined) return;
        setTimeout(() => {
          restored = true;
          window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
        }, restoreAfter);
      };
      document.addEventListener("submit", start, { capture: true, once: true });
    },
    { buttonIs: button, controls: reachableControls.toString(), restoreAfter: restore },
  );
  return reports;
}

/** What the page reports while the button with `words` is sending: as in AC3 and AC4. */
const sending = (words: string) => ({ restored: false, off: true, busy: true, inert: false, words, busyButtons: 1, rings: 1, reachable: [] });

test.describe("AC9 — the forms that load a whole page", () => {
  for (const [next, path] of [
    ["create-account", "/supper-club/create-account"],
    ["sign-in", "/supper-club/sign-in"],
  ] as const) {
    test(`AC9: the meal picks' "${next}" button gets the ring and the page locks, and it opens ${path} with the picks, as today`, async ({ page }) => {
      await page.goto("/supper-club");
      // The last meal of each type, which is not the one picked at first.
      for (const picker of await page.locator('form[action="/supper-club/continue"] fieldset').all()) await picker.locator('input[type="radio"]').last().check();
      const picked = await page.locator('input[type="radio"]:checked').evaluateAll((radios) => radios.map((radio) => (radio as HTMLInputElement).value));
      expect(picked.length).toBeGreaterThan(0);
      const selector = `button[name="next"][value="${next}"]`;
      const button = page.locator(selector);
      const words = await wordsOf(button);
      await expectAtRest(button);
      const held = await holdPages(page, "/supper-club/continue");
      const reports = await watchSend(page, selector);

      await button.click({ noWaitAfter: true });
      await expectHeld(held);

      await expect.poll(() => reports.at(-1)).toMatchObject(sending(words));
      held.release();
      await expect(page).toHaveURL(onPath(path));
      expect([...held.firstUrl().searchParams.values()]).toEqual([...picked, next]);
    });
  }

  test("AC9: the weekly lists' Show gets the ring and the page locks, and the week picked opens", async ({ page, request }) => {
    await runSeed("week-lists", e2eDatabaseUrl());
    await signIn(page, request, LENNY, "/admin");
    await page.goto("/admin/lists");
    const form = 'form[action="/admin/lists"]';
    const select = page.locator(`${form} select[name="week"]`);
    const week = (await select.locator("option").last().getAttribute("value")) ?? "";
    expect(await select.inputValue(), "the last week is the one already showing").not.toBe(week);
    await select.selectOption(week);
    const button = page.locator(submitIn(form));
    const words = await wordsOf(button);
    const held = await holdPages(page, "/admin/lists");
    const reports = await watchSend(page, submitIn(form));

    await button.click({ noWaitAfter: true });
    await expectHeld(held);

    await expect.poll(() => reports.at(-1)).toMatchObject(sending(words));
    held.release();
    await expect(page).toHaveURL((url) => url.pathname === "/admin/lists" && url.searchParams.get("week") === week);
    await expect(select).toHaveValue(week);
    await expectUnlocked(page);
  });

  test("AC9: coming Back to the page finds it unlocked with no ring", async ({ page }) => {
    await page.goto("/supper-club");
    const selector = 'button[name="next"][value="create-account"]';
    const button = page.locator(selector);
    const words = await wordsOf(button);
    const held = await holdPages(page, "/supper-club/continue");
    const reports = await watchSend(page, selector, 1500);
    await button.click({ noWaitAfter: true });
    await expectHeld(held);

    await expect.poll(() => reports.some((report) => report.restored), { message: "the page was not told it was restored" }).toBe(true);
    expect(reports.filter((report) => !report.restored).at(-1)).toMatchObject(sending(words));
    await expect.poll(() => reports.at(-1)).toMatchObject({ restored: true, off: false, busy: false, busyButtons: 0, rings: 0, inertOnPage: 0 });
    expect(reports.at(-1)?.reachable).toContain("button next");
    held.release();
    await expect(page).toHaveURL(onPath("/supper-club/create-account"));
  });
});

/** `link`'s page is loading: its label is busy and shows the one ring, and it is still called `name`. */
async function expectOpening(link: Locator, name: string): Promise<void> {
  await expect(link.locator('[aria-busy="true"]')).toHaveCount(1);
  await expect(ringIn(link)).toHaveCount(1);
  await expect(ringIn(link)).toBeVisible();
  expect(await nameOf(link)).toBe(name);
}

test.describe("AC10 — a tapped link", () => {
  for (const [what, selector, asked, opens] of [
    ["Button's link form", 'main a[href="/create-account"]', "/create-account", "/create-account"],
    ["Wordmark", 'header a[href="/"]', "/", "/supper-club"],
  ] as const) {
    test(`AC10: ${what}: while its page is loading its label is busy and shows the ring, and it keeps its name`, async ({ page }) => {
      await page.goto("/sign-in");
      const link = page.locator(selector);
      const name = await nameOf(link);
      const held = await holdPages(page, asked);

      await link.click({ noWaitAfter: true });
      await expectHeld(held);

      await expectOpening(link, name);
      held.release();
      await expect(page).toHaveURL(onPath(opens));
      await expect(page.locator('a [aria-busy="true"]')).toHaveCount(0);
    });
  }

  test("AC10: TextLink: while its page is loading its label is busy and shows the ring, and it keeps its name", async ({ page, request }) => {
    await runSeed("subscribers", e2eDatabaseUrl());
    await signIn(page, request, LENNY, "/admin");
    await page.goto("/admin");
    const link = page.locator('main a[href^="/admin/members/"]').filter({ visible: true }).first();
    const name = await nameOf(link);
    const path = (await link.getAttribute("href")) ?? "";
    const held = await holdPages(page, path);

    await link.click({ noWaitAfter: true });
    await expectHeld(held);

    await expectOpening(link, name);
    held.release();
    await expect(page).toHaveURL(onPath(path));
  });
});

test("AC11: when a second link is tapped while the first's page is loading, the ring is on the second alone, the page is not locked, and the second page opens", async ({ page }) => {
  await page.goto("/sign-in");
  const first = page.locator('header a[href="/"]');
  const second = page.locator('main a[href="/create-account"]');
  const [firstName, secondName] = [await nameOf(first), await nameOf(second)];
  const heldFirst = await holdPages(page, "/");
  const heldSecond = await holdPages(page, "/create-account");

  await first.click({ noWaitAfter: true });
  await expectOpening(first, firstName);
  await second.click({ noWaitAfter: true });

  // Read in one go when the second's ring is drawn: a ring held on the first would still be there.
  const busy = await page.waitForFunction(() => {
    const labels = [...document.querySelectorAll('a [aria-busy="true"]')];
    const hrefs = labels.map((label) => label.closest("a")?.getAttribute("href"));
    return hrefs.includes("/create-account") ? hrefs : null;
  });
  expect(await busy.jsonValue()).toEqual(["/create-account"]);
  await expectOpening(second, secondName);
  await expect(ringIn(first)).toHaveCount(0);

  await expectNothingInert(page);
  await page.locator(EMAIL_FIELD).click();
  await expect(page.locator(EMAIL_FIELD)).toBeFocused();

  heldFirst.release();
  heldSecond.release();
  await expect(page).toHaveURL(onPath("/create-account"));
});

test("AC13: with an expired session, tapping a CSV button opens the sign-in page", async ({ page, request }) => {
  await signIn(page, request, LENNY, "/admin");
  await page.goto("/admin");
  const csv = page.locator('a[href="/admin/members.csv"]');
  await expect(csv).toBeVisible();
  await page.context().clearCookies();

  await csv.click();

  await expect(page).toHaveURL(onPath("/sign-in"));
});
