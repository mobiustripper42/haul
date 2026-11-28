// Issue 258: the quiet button and the menu line look pressable, and a Save that is off because nothing changed is
// readable, as the browser draws them: computed underline, opacity, fill and contrast only a browser has. A quiet button
// is found by its class, the one mark of `kind="quiet"` on the page, and the menu line by its element; what is asserted is
// what is drawn. That an unchanged Save sends nothing is issue 235's (e2e/form-changes.spec.ts). How each looks is judged
// by eye at the hand-back (AC9).
import type { Locator, Page, TestInfo } from "@playwright/test";
import { runSeed } from "../db/seed.js";
import { e2eDatabaseUrl } from "./database";
import { expect, scriptHasRun, signIn, test } from "./fixtures";

const ERIC = "eric@ocf.xx";
const WEEKS_MEMBER = "weeks.member@example.com";

// `next dev` compiles a route on its first visit, and most of these visit several.
test.describe.configure({ timeout: 90_000 });

/** Moves the mouse to the page's top-left corner, over no control. */
const pointerOff = (page: Page) => page.mouse.move(0, 0);

/** Each drawn element `selector` finds, as its tag and whether its text is underlined. */
const underlines = (page: Page, selector: string) =>
  page
    .locator(selector)
    .filter({ visible: true })
    .evaluateAll((elements) => elements.map((el) => ({ tag: el.tagName.toLowerCase(), underlined: getComputedStyle(el).textDecorationLine.split(" ").includes("underline") })));

/** Every drawn quiet button and link on the page is underlined, and `tags` are among them. */
async function expectQuietUnderlined(page: Page, tags: string[]): Promise<void> {
  await pointerOff(page);
  const found = await underlines(page, ".btn-quiet");
  expect(found.map((one) => one.tag), "the quiet controls the page draws").toEqual(expect.arrayContaining(tags));
  expect(found.filter((one) => !one.underlined), "quiet controls not underlined").toEqual([]);
}

test.describe("AC3 — a quiet button is underlined all the time", () => {
  test("AC3: on /sign-in every quiet link, in the card and the footer, is underlined with no pointer over it", async ({ page }) => {
    await page.goto("/sign-in");

    await expectQuietUnderlined(page, ["a"]);
  });

  test("AC3: on the code step the quiet button and the quiet link are underlined with no pointer over them", async ({ page }) => {
    await page.goto("/sign-in");
    await page.locator('main input[name="email"]').fill(ERIC);
    await page.locator('main form:has(input[type="email"]) button[type="submit"]').click();
    await expect(page).toHaveURL((url) => url.pathname === "/sign-in/code");

    await expectQuietUnderlined(page, ["a", "button"]);
  });
});

test.describe("AC4 — the menu line on Upcoming weeks is underlined", () => {
  test("AC4: a week's menu line is underlined", async ({ page, request }) => {
    await runSeed("account-weeks", e2eDatabaseUrl());
    await runSeed("menus", e2eDatabaseUrl());
    await signIn(page, request, WEEKS_MEMBER);
    await page.goto("/account/weeks");
    await pointerOff(page);

    const found = await underlines(page, "main details > summary");
    expect(found.length, "no week's menu line is drawn").toBeGreaterThan(0);
    expect(found.filter((one) => !one.underlined), "menu lines not underlined").toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// Your details' Save, on Your account.

const detailsForm = (page: Page) => page.getByRole("main").locator('form:has(input[name="firstName"])');
const save = (page: Page) => detailsForm(page).locator('button[type="submit"]');

/** Eric on Your account, its script running. */
async function onDetails(page: Page, request: Parameters<typeof signIn>[1]): Promise<void> {
  await signIn(page, request, ERIC);
  // A fresh load: signing in opened the drawer, below 1024px, to find Sign out.
  await page.goto("/account");
  await expect(detailsForm(page).locator('input[name="firstName"]')).toBeVisible();
  await scriptHasRun(save(page));
}

type Rgb = [number, number, number];
type Look = { opacity: number; fill: string; gold: string[]; text: Rgb; behind: Rgb };

/**
 * How `button` is drawn: its opacity, its fill, the theme's two golds as the browser computes them, its text colour, and
 * the colour behind its text, which is its own fill or, where it has none, the first ancestor's that is not transparent.
 */
const lookOf = (button: Locator): Promise<Look> =>
  button.evaluate((el) => {
    const rgba = (css: string): number[] => (/rgba?\(([^)]*)\)/.exec(css)?.[1] ?? "0, 0, 0, 0").split(/[\s,/]+/).filter(Boolean).map(Number);
    const opaque = (css: string): boolean => (rgba(css)[3] ?? 1) > 0;
    const computed = (value: string): string => {
      const probe = document.createElement("span");
      probe.style.backgroundColor = value;
      document.body.append(probe);
      const found = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return found;
    };
    const style = getComputedStyle(el);
    let behind: Element | null = el;
    while (behind && !opaque(getComputedStyle(behind).backgroundColor)) behind = behind.parentElement;
    const rgb = (css: string): Rgb => rgba(css).slice(0, 3) as Rgb;
    return {
      opacity: Number(style.opacity),
      fill: style.backgroundColor,
      gold: [computed("var(--color-gold)"), computed("var(--color-gold-hover)")],
      text: rgb(style.color),
      behind: rgb(behind ? getComputedStyle(behind).backgroundColor : "rgb(255, 255, 255)"),
    };
  });

/** WCAG's contrast ratio between two sRGB colours. */
function contrast(a: Rgb, b: Rgb): number {
  const luminance = ([r, g, bl]: Rgb) => {
    const [lr, lg, lb] = [r, g, bl].map((c) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    }) as Rgb;
    return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
  };
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

/** The unchanged Save is not faded, has no gold fill, and its text has at least 4.5:1 contrast with what is behind it. */
async function expectReadableUnchanged(button: Locator): Promise<void> {
  const look = await lookOf(button);
  expect(look.opacity, "Save's opacity").toBe(1);
  expect(look.gold, "Save's fill is one of the theme's golds").not.toContain(look.fill);
  expect(contrast(look.text, look.behind), "Save's text against what is behind it").toBeGreaterThanOrEqual(4.5);
}

const desktopOnly = (testInfo: TestInfo, why: string) => test.skip(testInfo.project.name !== "desktop", why);

test.describe("AC5 — a Save that is off because nothing changed is readable", () => {
  test("AC5: with nothing changed and the pointer off it, Save is not faded, has no gold fill, and its text has 4.5:1 contrast with what is behind it", async ({ page, request }) => {
    await onDetails(page, request);
    await expect(save(page), "Save is not off: the form is not unchanged").toBeDisabled();
    await pointerOff(page);

    await expectReadableUnchanged(save(page));
  });

  test("AC5: with nothing changed and the pointer over it, Save is still not faded, has no gold fill, and its text has 4.5:1 contrast with what is behind it", async ({ page, request }, testInfo) => {
    desktopOnly(testInfo, "a phone has no pointer to hover with");
    await onDetails(page, request);
    await expect(save(page), "Save is not off: the form is not unchanged").toBeDisabled();
    const box = await save(page).boundingBox();
    if (!box) throw new Error("Save is not drawn");

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

    await expectReadableUnchanged(save(page));
  });

  test("AC5: once a field changes, Save has its gold fill again", async ({ page, request }) => {
    await onDetails(page, request);
    await detailsForm(page).locator('input[name="firstName"]').fill("Erica");
    await expect(save(page), "the change did not turn Save on").toBeEnabled();
    await pointerOff(page);

    const look = await lookOf(save(page));
    expect(look.fill, "Save's fill").toBe(look.gold[0]);
    expect(look.opacity, "Save's opacity").toBe(1);
  });
});
