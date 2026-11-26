// Issue 235: two forms that react to what is in them, once the page's script runs. On Weekly lists a pick in the week
// dropdown loads that week, with no Show week button; on Your account, Your details' Save is off, reading its off line, until
// the form holds something other than what the server sent. Both pages assume their script runs (DEC-057). The comparison's edge
// cases are components/ui/form-state.test.ts's, so here each kind of control is changed and put back once; the lock while a
// week loads and Back from the browser's cache are e2e/tap-feedback.spec.ts's; what the server sends a page with no script
// on Your account, and that a save that works shows no Notice, are app/account/page.test.ts's. Each week's table and summary
// are app/admin/lists/page.test.ts's, so a loaded week is shown here by its URL and its list's heading changing.
// Save's two lines are a choice between lines, so they are read by their catalog keys; a control is found by its element.
import type { Page } from "@playwright/test";
import { runSeed } from "../db/seed.js";
import { en } from "../src/messages/en.js";
import { e2eDatabaseUrl } from "./database";
import { expect, outboxCount, scriptHasRun, signIn, test, waitForSignInCode } from "./fixtures";

const ERIC = "eric@ocf.xx";
const LENNY = "lenny@ocf.xx";

// `next dev` compiles a route on its first visit, and most of these visit several.
test.describe.configure({ timeout: 90_000 });

// ---------------------------------------------------------------------------------------------
// Weekly lists.

const LISTS_FORM = 'form[action="/admin/lists"]';
const weekSelect = (page: Page) => page.locator(`${LISTS_FORM} select[name="week"]`);
const showWeek = (page: Page) => page.locator(`${LISTS_FORM} button[type="submit"]`);
/** The list Card's heading, which names the week its list is for. */
const listHeading = (page: Page) => page.getByRole("main").getByRole("heading", { level: 2 });
const onWeek = (week: string) => (url: URL) => url.pathname === "/admin/lists" && url.searchParams.get("week") === week;

/** Lenny on Weekly lists, two weeks with lists: the week its list is for, another week, and the list's heading. */
async function onWeeklyLists(page: Page, request: Parameters<typeof signIn>[1]): Promise<{ shown: string; other: string; heading: string }> {
  await runSeed("week-lists", e2eDatabaseUrl());
  await signIn(page, request, LENNY, "/admin");
  await page.goto("/admin/lists");
  const shown = await weekSelect(page).inputValue();
  const other = (await weekSelect(page).locator("option").last().getAttribute("value")) ?? "";
  expect(other, "the last week is the one already showing").not.toBe(shown);
  const heading = ((await listHeading(page).textContent()) ?? "").trim();
  expect(heading).not.toBe("");
  return { shown, other, heading };
}

test.describe("AC1 (issue 235) — a pick loads its week", () => {
  test("AC1: with the script running, picking another week loads /admin/lists?week=<that week> with that week's list", async ({ page, request }) => {
    const { other, heading } = await onWeeklyLists(page, request);
    await scriptHasRun(weekSelect(page));

    await weekSelect(page).selectOption(other);

    await expect(page).toHaveURL(onWeek(other));
    await expect(listHeading(page)).not.toHaveText(heading);
    await expect(weekSelect(page)).toHaveValue(other);
  });
});

test.describe("AC2 (issue 235) — Show week, with the script running", () => {
  test("AC2: once the script runs, the Show week button is not on the page", async ({ page, request }) => {
    await onWeeklyLists(page, request);
    await scriptHasRun(weekSelect(page));

    await expect(showWeek(page)).toBeHidden();
  });
});

test.describe("AC5 (issue 235) — Back that reloads the page", () => {
  test("AC5: when Back reloads the earlier page, the script puts the dropdown back to the week its list is for, whatever the browser put in it", async ({ page, request }) => {
    const { shown, other } = await onWeeklyLists(page, request);
    await scriptHasRun(weekSelect(page));
    // The week is sent by the form itself, not by the dropdown's pick, so what Back puts in the dropdown is the browser's alone.
    await weekSelect(page).evaluate((select: HTMLSelectElement, week) => {
      select.value = week;
      select.form?.requestSubmit();
    }, other);
    await expect(page).toHaveURL(onWeek(other));

    await page.goBack();

    await expect(page).toHaveURL((url) => url.pathname === "/admin/lists" && !url.searchParams.has("week"));
    await scriptHasRun(weekSelect(page));
    await expect(weekSelect(page)).toHaveValue(shown);
  });
});

test.describe("AC16 (issue 235) — a pick made before the script starts", () => {
  test("AC16: a week picked before the page's script starts loads once the script starts", async ({ page, request }) => {
    const { other, heading } = await onWeeklyLists(page, request);
    // The page's scripts are held, so the pick lands on the page as the server sent it.
    let release = () => {};
    const released = new Promise<void>((resolve) => (release = resolve));
    await page.route("**/_next/static/**/*.js", async (route) => {
      await released;
      await route.continue();
    });
    await page.goto("/admin/lists", { waitUntil: "commit" });
    await weekSelect(page).waitFor();
    const running = await weekSelect(page).evaluate((el) => Object.keys(el).some((key) => key.startsWith("__reactProps$")));
    expect(running, "the script ran before the pick").toBe(false);

    await weekSelect(page).selectOption(other);
    release();

    await expect(page).toHaveURL(onWeek(other));
    await expect(listHeading(page)).not.toHaveText(heading);
    await expect(weekSelect(page)).toHaveValue(other);
  });
});

// ---------------------------------------------------------------------------------------------
// Your details, on Your account.

const detailsForm = (page: Page) => page.getByRole("main").locator('form:has(input[name="firstName"])');
const save = (page: Page) => detailsForm(page).locator('button[type="submit"]');
const field = (page: Page, name: string) => detailsForm(page).locator(`[name="${name}"]`);

async function expectSaveOff(page: Page): Promise<void> {
  await expect(save(page)).toBeDisabled();
  await expect(save(page)).toHaveText(en["details.saved"]);
}

async function expectSaveOn(page: Page): Promise<void> {
  await expect(save(page)).toBeEnabled();
  await expect(save(page)).toHaveText(en["details.save"]);
}

/** Eric on Your account, its script running. */
async function onDetails(page: Page, request: Parameters<typeof signIn>[1]): Promise<void> {
  await signIn(page, request, ERIC);
  // A fresh load: signing in opened the drawer, below 1024px, to find Sign out, and reached the page inside the app.
  await page.goto("/account");
  await expect(field(page, "firstName")).toBeVisible();
  await scriptHasRun(save(page));
}

/** A kind of control: how to change it from what the server sent, and how to put that back. */
type Control = { kind: string; change: (page: Page) => Promise<void>; putBack: (page: Page) => Promise<void> };

/** Each kind of control Your details holds; `putBack` puts back what the test's `change` found. */
const CONTROLS: Control[] = (() => {
  const remembered = new Map<string, string | boolean>();
  const text = (name: string, value: string): Control => ({
    kind: `${name}, a text box`,
    change: async (page) => {
      remembered.set(name, await field(page, name).inputValue());
      await field(page, name).fill(value);
    },
    putBack: (page) => field(page, name).fill(String(remembered.get(name))),
  });
  return [
    text("firstName", "Erica"),
    // The phone box is formatted as it is typed, and React sets it (app/phone-input.tsx).
    { ...text("phone", "216-555-0199"), kind: "phone, the box formatted as it is typed" },
    {
      kind: "language, a dropdown",
      change: async (page) => {
        const now = await field(page, "language").inputValue();
        remembered.set("language", now);
        await field(page, "language").selectOption(now === "es" ? "en" : "es");
      },
      putBack: async (page) => {
        await field(page, "language").selectOption(String(remembered.get("language")));
      },
    },
    {
      kind: "menu emails, a checkbox",
      change: async (page) => {
        const ticked = await field(page, "menuEmails").isChecked();
        remembered.set("menuEmails", ticked);
        await field(page, "menuEmails").setChecked(!ticked);
      },
      putBack: (page) => field(page, "menuEmails").setChecked(remembered.get("menuEmails") === true),
    },
  ];
})();

test.describe("AC6 (issue 235) — Save, with nothing changed", () => {
  test("AC6: with the script running and nothing changed, Save is off and reads its off line", async ({ page, request }) => {
    await onDetails(page, request);

    await expectSaveOff(page);
  });
});

test.describe("AC7 (issue 235) — a change turns Save on", () => {
  for (const control of CONTROLS) {
    test(`AC7: changing ${control.kind} turns Save on, reading its on line`, async ({ page, request }) => {
      await onDetails(page, request);

      await control.change(page);

      await expectSaveOn(page);
    });
  }
});

test.describe("AC8 (issue 235) — a form put back turns Save off", () => {
  for (const control of CONTROLS) {
    test(`AC8: ${control.kind} changed and put back turns Save off again, reading its off line`, async ({ page, request }) => {
      await onDetails(page, request);
      await control.change(page);
      await expectSaveOn(page);

      await control.putBack(page);

      await expectSaveOff(page);
    });
  }

  test("AC8: a character typed then deleted turns Save off again", async ({ page, request }) => {
    await onDetails(page, request);
    const box = field(page, "firstName");
    await box.press("End");
    await box.pressSequentially("x");
    await expectSaveOn(page);

    await box.press("Backspace");

    await expectSaveOff(page);
  });
});

test.describe("AC9 (issue 235) — values the browser puts back", () => {
  test("AC9: when Back after a full page load puts a changed value back in the form, Save is on once the page has loaded", async ({ page, request }) => {
    await onDetails(page, request);
    const first = await field(page, "firstName").inputValue();
    await field(page, "firstName").fill(`${first}-restored`);
    await page.goto("/supper-club");
    await expect(page).toHaveURL((url) => url.pathname === "/supper-club");

    await page.goBack();

    await expect(page).toHaveURL((url) => url.pathname === "/account");
    await expect(field(page, "firstName"), "the browser put nothing back").toHaveValue(`${first}-restored`);
    await scriptHasRun(save(page));
    await expectSaveOn(page);
  });
});

test.describe("AC10 (issue 235) — Enter in an unchanged form", () => {
  test("AC10: with the form unchanged, Enter in a field sends nothing", async ({ page, request }) => {
    await onDetails(page, request);
    const sent = page.waitForRequest((asked) => asked.method() === "POST", { timeout: 3_000 }).then(
      () => true,
      () => false,
    );

    await field(page, "firstName").press("Enter");

    expect(await sent, "Enter sent the unchanged form").toBe(false);
    await expect(page).toHaveURL((url) => url.pathname === "/account" && url.search === "");
  });
});

test.describe("AC12 (issue 235) — the form refilled after a save that broke a rule", () => {
  test("AC12: when the page comes back refilled with what was typed, Save is on, reading its on line, from the start", async ({ page, request }) => {
    await onDetails(page, request);
    await field(page, "email").fill("not-an-email");
    await save(page).click();

    await expect(page).toHaveURL((url) => url.pathname === "/account" && url.searchParams.has("error"));
    await expect(field(page, "email"), "the form was not refilled").toHaveValue("not-an-email");
    await scriptHasRun(save(page));

    await expectSaveOn(page);
  });
});

test.describe("AC14 (issue 235) — a save that works is the new baseline", () => {
  /** Clicks Save and waits for the page the save lands on. */
  async function saveAndLand(page: Page): Promise<void> {
    const landed = page.waitForResponse((answer) => answer.request().method() === "POST");
    await save(page).click();
    await landed;
  }

  test("AC14: after two good saves in a row Save is off each time, and a change between them turns it on", async ({ page, request }) => {
    await onDetails(page, request);
    await field(page, "firstName").fill("Erica");

    await saveAndLand(page);

    await expect(page).toHaveURL((url) => url.pathname === "/account" && url.searchParams.get("saved") === "1");
    await expect(field(page, "firstName")).toHaveValue("Erica");
    await expectSaveOff(page);

    await field(page, "lastName").fill("Stoffer-Saved");
    await expectSaveOn(page);
    await saveAndLand(page);

    await expect(field(page, "lastName")).toHaveValue("Stoffer-Saved");
    await expectSaveOff(page);
  });

  test("AC14: a good save the server stores as the values the page already held leaves Save off", async ({ page, request }) => {
    await onDetails(page, request);
    const first = await field(page, "firstName").inputValue();
    // The save trims what was typed (src/create-account.ts), so the stored values come back as they were.
    await field(page, "firstName").fill(`${first} `);
    await expectSaveOn(page);

    await saveAndLand(page);

    await expect(page).toHaveURL((url) => url.pathname === "/account" && url.searchParams.get("saved") === "1");
    await expectSaveOff(page);
  });

  test("AC14: a good save after one that broke a rule leaves Save off", async ({ page, request }) => {
    await onDetails(page, request);
    const email = await field(page, "email").inputValue();
    await field(page, "email").fill("not-an-email");
    await saveAndLand(page);
    await expect(page).toHaveURL((url) => url.searchParams.has("error"));

    await field(page, "email").fill(email);
    await field(page, "firstName").fill("Erica");
    await saveAndLand(page);

    await expect(page).toHaveURL((url) => url.pathname === "/account" && url.searchParams.get("saved") === "1");
    await expect(field(page, "firstName")).toHaveValue("Erica");
    await expectSaveOff(page);
  });

  test("AC14: an email change whose code lands the member back on the form leaves Save off", async ({ page, request }) => {
    const NEW = "eric.new@ocf.xx";
    await onDetails(page, request);
    const before = await outboxCount(request, NEW);
    await field(page, "email").fill(NEW);
    await saveAndLand(page);
    const code = page.getByRole("main").locator('input[name="code"]');
    await expect(code).toBeVisible();

    await code.fill(await waitForSignInCode(request, NEW, before));
    await page.getByRole("main").locator('form:has(input[name="code"]) button[type="submit"]').click();

    await expect(page).toHaveURL((url) => url.pathname === "/account" && url.searchParams.get("saved") === "1");
    await expect(field(page, "email")).toHaveValue(NEW);
    await expectSaveOff(page);
  });
});
