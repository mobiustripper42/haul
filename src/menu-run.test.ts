// Issue 141: the menu run over an InMemoryRepository and a FakeEmail. Owned here: which week is current and what menu it
// holds (`currentWeekMenu`, which the menu page reads too), the email weekday read from the env (`menuEmailWeekday`),
// when the week's menu email goes out and to whom, the stamp that makes it once, the missing-menu reminder and the event
// that makes it once a day, and which email each recipient gets, checked against renderEmail. Which rows a week
// makes and their picks are the repository's (`listWeekMade`, src/adapters/menu-contract.ts); the email date's edges are
// menuEmailDate's (src/pickup-week.test.ts); the off link's token is src/menu-email-link.test.ts's.
//
// The Supper Club's weeks: January 17's cutoff date is Monday the 11th, so with MENU_EMAIL_WEEKDAY 4 its email goes out
// on Thursday the 14th. On the 14th the current week is January 17, January 10's last pickup day (the 11th) having passed.
import { inspect } from "node:util";
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { FakeEmail } from "./adapters/fake-email.js";
import { InMemoryRepository } from "./adapters/in-memory-repository.js";
import { noteBlock, renderEmail } from "./email-templates.js";
import { createTranslator, type Language } from "./i18n.js";
import { menuEmailOffLink, menuEmailTokenMatches } from "./menu-email-link.js";
import * as menuRunModule from "./menu-run.js";
import { currentWeekMenu, menuEmailWeekday, runMenuRun, type MenuRunDeps, type MenuRunReport } from "./menu-run.js";
import type { Member } from "./members.js";
import type { Menu } from "./menus.js";
import { addDays, formatPickupDate, pickupWeek, pickupWhereLine, weekdayName, weekTitle, type PickupWeek } from "./pickup-week.js";
import { EmailSendError, type EmailMessage } from "./ports/email.js";
import { priceOfChoices, type ProductWithOptions } from "./products.js";
import { errorFields } from "./record-event.js";

const FIRST = "2027-01-03";
const WEEK = "2027-01-17";
const NEXT = "2027-01-24";
const LATER = "2027-01-31";
const SIGNED_UP_AT = new Date("2026-12-01T15:00:00.000Z");
/** Thursday January 14, 15:00 in Cleveland: January 17's email day, with MENU_EMAIL_WEEKDAY 4. */
const RUN_AT = new Date("2027-01-14T20:00:00.000Z");
const THURSDAY = 4;
const SITE_URL = "https://members.example.test";
const ACCOUNT_WEEKS_URL = "https://members.example.test/account/weeks";
const ADMIN_WEEKS_URL = "https://members.example.test/admin/weeks";
const SECRET = "s".repeat(32) + "-test-secret";
/** The autumn menu's two options and their lines, in position order, as the email's menus value. */
const AUTUMN_MENUS = "Standard\nSquash soup\nRye bread\n\nVegan\nLentil soup\nRye bread";
/** The cutoff date of the week after January 17: the date the menu email's charge line carries. */
const CHARGED = "2027-01-18";

let repo: InMemoryRepository;
let email: FakeEmail;
let product: ProductWithOptions;
let autumn: Menu;
let members = 0;

beforeEach(async () => {
  repo = new InMemoryRepository();
  email = new FakeEmail();
  product = repo.addProduct({
    name: "Supper Club",
    cap: 50,
    firstPickupDate: FIRST,
    cutoffWeekday: 1,
    cutoffTime: "24:00:00",
    optionTypes: [
      {
        name: "How many people",
        position: 1,
        options: [
          { name: "2 people", priceCents: 5000, position: 1 },
          { name: "3–4 people", priceCents: 8000, position: 2 },
        ],
      },
      {
        name: "Which menu",
        position: 2,
        menuTexts: true,
        options: [
          { name: "Standard", priceCents: 0, position: 1 },
          { name: "Vegan", priceCents: 0, position: 2 },
        ],
      },
    ],
  });
  autumn = await repo.createMenu({ name: "Autumn harvest", texts: { [optionId(1, 0)]: "Squash soup\nRye bread", [optionId(1, 1)]: "Lentil soup\n\n  Rye bread  " } });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function optionId(type: number, option: number): string {
  return product.optionTypes[type]?.options[option]?.id ?? "no such option";
}

/** The picks at these positions: 2 people or 3–4, Standard or Vegan. */
const picks = (size = 0, menu = 0): Record<string, string> => ({
  [product.optionTypes[0]?.id ?? "no size type"]: optionId(0, size),
  [product.optionTypes[1]?.id ?? "no menu type"]: optionId(1, menu),
});

const run = (over: Partial<MenuRunDeps> = {}): Promise<MenuRunReport> =>
  runMenuRun({
    repo,
    email,
    now: RUN_AT,
    siteUrl: SITE_URL,
    accountWeeksUrl: ACCOUNT_WEEKS_URL,
    adminWeeksUrl: ADMIN_WEEKS_URL,
    emailWeekday: THURSDAY,
    sessionSecret: SECRET,
    ...over,
  });

const at = (instant: string) => ({ now: new Date(instant) });

const assign = (week: string, menu: Menu | null = autumn) => repo.assignWeekMenu(product.id, week, menu?.id ?? null);

type Subscriber = { member: Member; subscriptionId: string };

/**
 * A member through Create Account, with an active subscription first paid for January 3 at `choices`; a moment after
 * the last, so the order between subscriptions is fixed.
 */
async function subscriber({ language = "en", choices = picks() }: { language?: Language; choices?: Record<string, string> } = {}): Promise<Subscriber> {
  await new Promise((resolve) => setTimeout(resolve, 2));
  const n = ++members;
  const saved = await repo.saveAccount({ email: `member-${n}@example.com`, firstName: `Member${n}`, lastName: "Lovelace", phone: "216-555-0100", language });
  const cents = priceOfChoices(product, choices);
  const signup = await repo.savePendingSignup({
    memberId: saved.id,
    productId: product.id,
    choices,
    firstChargeCents: cents,
    weeklyCents: cents,
    pickupDate: FIRST,
    consentText: "I agree to a weekly charge until I cancel.",
    consentAt: SIGNED_UP_AT,
  });
  expect(await repo.confirmSignupRows(signup.ledgerId, `PAYMENT_${n}`, cents, SIGNED_UP_AT)).toBe("confirmed");
  const member = await repo.findMemberById(saved.id);
  if (!member) throw new Error("the member just saved is gone");
  return { member, subscriptionId: signup.subscriptionId };
}

/** A subscriber with a ledger row of `status` for the week. */
async function withRow(status: "paid" | "declined" | "pending" | "skipped", over: { language?: Language; choices?: Record<string, string>; week?: string } = {}): Promise<Subscriber> {
  const who = await subscriber(over);
  await repo.addLedgerRow(who.subscriptionId, over.week ?? WEEK, status, status === "skipped" ? 0 : 5000);
  return who;
}

let admins = 0;
const admin = async (language: Language = "en"): Promise<Member> => repo.createMember({ email: `admin-${++admins}@example.com`, role: "admin", language });

const sentTo = (member: Member): EmailMessage[] => email.sent.filter((message) => message.to === member.email);
const reminders = () => repo.events().filter((event) => event.kind === "menu_reminder_sent");

/** Of `parts`, those found in `text` one after another, each after the end of the last: equal to `parts` when all are there in that order. */
function inSequence(text: string, parts: readonly string[]): string[] {
  const found: string[] = [];
  let from = 0;
  for (const part of parts) {
    const index = text.indexOf(part, from);
    if (index < 0) break;
    found.push(part);
    from = index + part.length;
  }
  return found;
}

const titleOf = (week: PickupWeek, language: Language = "en") => weekTitle(createTranslator(language), week, language);
const ordinary = (weekOf: string) => pickupWeek(weekOf, null);

/**
 * The menu email `who` gets for `week`, a meal line for each of `meals` (each box's picks), in their language; with
 * `note`, the week's note block above the heading (issue 231), and with none, no block.
 */
function menuEmailFor(who: Member, week: PickupWeek, meals: string[], note: string | null = null): EmailMessage {
  const t = createTranslator(who.language);
  return {
    to: who.email,
    ...renderEmail(
      "menuEmail",
      who.language,
      {
        heading: t("menu.heading", { week: titleOf(week, who.language) }),
        menus: AUTUMN_MENUS,
        meals: meals.map((picks) => t("email.menu.meal", { picks })).join("\n"),
        pickupLine: t("menu.pickup", { pickup: pickupWhereLine(t, week, who.language) }),
        date: formatPickupDate(CHARGED, who.language),
        link: ACCOUNT_WEEKS_URL,
        offLink: menuEmailOffLink(SITE_URL, who.id, SECRET),
        note: noteBlock(note === null ? null : t("email.menu.note", { note }), "above"),
      },
      SITE_URL,
    ),
  };
}

/** The missing-note email `who` gets naming `weeks`, in their language (issue 231). */
function missingNoteFor(who: Member, weeks: PickupWeek[]): EmailMessage {
  return {
    to: who.email,
    ...renderEmail("missingNote", who.language, { weeks: weeks.map((week) => titleOf(week, who.language)).join(" · "), link: ADMIN_WEEKS_URL }, SITE_URL),
  };
}

const escaped = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Issue 231: whether `message` is the `name` email in `language`, whatever values fill it — its subject and text are
 * that template's catalog words around its values — so an admin's missing-menu and missing-note emails are told apart
 * by the renderer rather than by typed words.
 */
function isTemplate(name: "missingMenu" | "missingNote", language: Language, message: EmailMessage): boolean {
  const HOLE = "\u0000";
  const shape = renderEmail(name, language, { weeks: HOLE, weekday: HOLE, link: HOLE }, SITE_URL);
  const matches = (rendered: string, actual: string) => new RegExp(`^${rendered.split(HOLE).map(escaped).join("[\\s\\S]*?")}$`).test(actual);
  return matches(shape.subject, message.subject) && matches(shape.text, message.text);
}

/** The missing-menu emails `who` got: the reminder this file's issue 141 tests are about, the note reminder's left out. */
const menuRemindersTo = (who: Member): EmailMessage[] => sentTo(who).filter((message) => isTemplate("missingMenu", who.language, message));
/** The missing-note emails `who` got (issue 231). */
const noteRemindersTo = (who: Member): EmailMessage[] => sentTo(who).filter((message) => isTemplate("missingNote", who.language, message));
const noteReminders = () => repo.events().filter((event) => event.kind === "note_reminder_sent");

/** Issue 231: a note on `weekOf`, its days ordinary and the week open. */
const noteOn = (weekOf: string, note: string) => repo.savePickupWeek(product.id, { weekOf, closedAt: null, note, firstDay: null, lastDay: null });

/** The missing-menu email `who` gets naming `weeks`, the email weekday being `weekdayOn`'s, in their language. */
function missingMenuFor(who: Member, weeks: PickupWeek[], weekdayOn: string): EmailMessage {
  return {
    to: who.email,
    ...renderEmail(
      "missingMenu",
      who.language,
      { weeks: weeks.map((week) => titleOf(week, who.language)).join(" · "), weekday: weekdayName(weekdayOn, who.language), link: ADMIN_WEEKS_URL },
      SITE_URL,
    ),
  };
}

/** Thursday and Tuesday: days whose weekday names the run's email weekday 4 and 2. */
const A_THURSDAY = "2027-01-14";
const A_TUESDAY = "2027-01-12";

describe("AC2 — menuEmailWeekday", () => {
  it.each([
    ["0", 0],
    ["3", 3],
    ["6", 6],
  ])("AC2: %j is weekday %i", (value, weekday) => {
    expect(menuEmailWeekday({ MENU_EMAIL_WEEKDAY: value })).toBe(weekday);
  });

  it.each([
    ["unset", undefined],
    ["empty", ""],
    ["7", "7"],
    ["-1", "-1"],
    ["03", "03"],
    [" 3", " 3"],
    ["3 ", "3 "],
    ["+3", "+3"],
    ["3.0", "3.0"],
    ["a word", "Thursday"],
  ])("AC2: %s throws", (_what, value) => {
    expect(() => menuEmailWeekday(value === undefined ? {} : { MENU_EMAIL_WEEKDAY: value })).toThrow();
  });
});

describe("AC3, AC7 — currentWeekMenu", () => {
  it("AC3: on Thursday January 14 the current week is January 17, with the menu on it, not yet sent", async () => {
    await assign(WEEK);
    expect(await currentWeekMenu(repo, product, RUN_AT)).toEqual({
      week: expect.objectContaining({ weekOf: WEEK, firstDay: WEEK, lastDay: "2027-01-18", closedAt: null }),
      menu: autumn,
      sentAt: null,
    });
  });

  it("AC3: on Monday January 11 the current week is still January 10: its last pickup day has not passed", async () => {
    expect((await currentWeekMenu(repo, product, new Date("2027-01-11T17:00:00.000Z")))?.week.weekOf).toBe("2027-01-10");
  });

  it("AC3: a current week moved to Monday and Tuesday is still current on its Tuesday, with its moved days", async () => {
    await repo.savePickupWeek(product.id, { weekOf: "2027-01-10", closedAt: null, note: null, firstDay: "2027-01-11", lastDay: "2027-01-12" });
    const current = await currentWeekMenu(repo, product, new Date("2027-01-12T17:00:00.000Z"));
    expect(current?.week).toMatchObject({ weekOf: "2027-01-10", firstDay: "2027-01-11", lastDay: "2027-01-12" });
  });

  it("AC3, AC7: a closed week is never the current one: with January 17 closed it is January 24, with January 24's menu", async () => {
    const winter = await repo.createMenu({ name: "Winter roots", texts: { [optionId(1, 0)]: "Beef stew", [optionId(1, 1)]: "Mushroom stew" } });
    await assign(WEEK);
    await assign(NEXT, winter);
    await repo.closePickupWeek(product.id, WEEK, null, new Date("2027-01-12T15:00:00.000Z"));
    const current = await currentWeekMenu(repo, product, RUN_AT);
    expect(current?.week.weekOf).toBe(NEXT);
    expect(current?.menu).toEqual(winter);
  });

  it("AC3: a current week with no menu is given with menu null", async () => {
    expect(await currentWeekMenu(repo, product, RUN_AT)).toEqual({ week: expect.objectContaining({ weekOf: WEEK }), menu: null, sentAt: null });
  });

  it("AC3: once the week is stamped sent, sentAt is the stamp", async () => {
    await assign(WEEK);
    await repo.markWeekMenuSent(product.id, WEEK, RUN_AT);
    expect((await currentWeekMenu(repo, product, RUN_AT))?.sentAt).toEqual(RUN_AT);
  });

  it("AC3: with every listed week closed there is no current week: null", async () => {
    for (let i = 0; i < 12; i++) await repo.closePickupWeek(product.id, addDays(WEEK, 7 * i), null, RUN_AT);
    expect(await currentWeekMenu(repo, product, RUN_AT)).toBeNull();
  });
});

describe("AC3 — who gets the menu email", () => {
  it("AC3: a paid row and a declined row for the week each get one; a pending row, a skipped row, a preference off and no row get none; the report counts the sends", async () => {
    await assign(WEEK);
    const paid = await withRow("paid");
    const declined = await withRow("declined");
    await withRow("pending");
    await withRow("skipped");
    const off = await withRow("paid");
    await repo.setMenuEmails(off.member.id, false);
    await subscriber();

    const report = await run();

    expect(email.sent.map((message) => message.to).sort()).toEqual([paid.member.email, declined.member.email].sort());
    expect(report.menuEmail).toEqual({ weekOf: WEEK, sent: 2 });
  });

  it("AC3: then the week is stamped sent at the run's now", async () => {
    await assign(WEEK);
    await withRow("paid");
    await run();
    expect(await repo.findWeekMenu(product.id, WEEK)).toEqual({ menu: autumn, sentAt: RUN_AT });
  });

  it("AC3: a member holding two boxes for the week gets one email, with a meal line for each, in the order they joined", async () => {
    await assign(WEEK);
    const ada = await withRow("paid");
    expect(await repo.cancelSubscription(ada.subscriptionId, RUN_AT)).toBe(true);
    const second = await repo.savePendingSignup({
      memberId: ada.member.id,
      productId: product.id,
      choices: picks(1, 1),
      firstChargeCents: 8000,
      weeklyCents: 8000,
      pickupDate: WEEK,
      consentText: "I agree to a weekly charge until I cancel.",
      consentAt: RUN_AT,
    });
    expect(await repo.confirmSignupRows(second.ledgerId, "PAYMENT_SECOND", 8000, RUN_AT)).toBe("confirmed");

    await run();

    expect(sentTo(ada.member)).toEqual([menuEmailFor(ada.member, ordinary(WEEK), ["2 people · Standard", "3–4 people · Vegan"])]);
  });

  it("AC3: the meal line is the picks in effect for the week: switched from January 17, it is the new picks", async () => {
    await assign(WEEK);
    const ada = await withRow("paid");
    expect(await repo.switchPicks(ada.subscriptionId, picks(1, 1), WEEK, 8000)).toBe("switched");
    await run();
    expect(sentTo(ada.member)).toEqual([menuEmailFor(ada.member, ordinary(WEEK), ["3–4 people · Vegan"])]);
  });

  it("AC3: switched only from January 24, the meal line is still the picks January 17 was made with", async () => {
    await assign(WEEK);
    const ada = await withRow("paid");
    expect(await repo.switchPicks(ada.subscriptionId, picks(1, 1), NEXT, 8000)).toBe("switched");
    await run();
    expect(sentTo(ada.member)).toEqual([menuEmailFor(ada.member, ordinary(WEEK), ["2 people · Standard"])]);
  });

  it("AC3: the week is the current one, not merely the next to cut off: with January 17 closed the run's week is January 24, before its own email day", async () => {
    await assign(NEXT);
    await withRow("paid", { week: NEXT });
    await repo.closePickupWeek(product.id, WEEK, null, new Date("2027-01-12T15:00:00.000Z"));
    expect((await run()).menuEmail).toEqual({ weekOf: NEXT, sent: 0 });
    expect(email.sent).toEqual([]);
  });

  it("AC3: with no current week at all, the report's week is null", async () => {
    for (let i = 0; i < 12; i++) await repo.closePickupWeek(product.id, addDays(WEEK, 7 * i), null, RUN_AT);
    expect((await run()).menuEmail).toEqual({ weekOf: null, sent: 0 });
  });
});

describe("AC4 — when the menu email goes out, and only once", () => {
  it("AC4: a week with no menu sends nothing and stamps nothing", async () => {
    await withRow("paid");
    expect((await run()).menuEmail).toEqual({ weekOf: WEEK, sent: 0 });
    expect(email.sent).toEqual([]);
    expect(await repo.findWeekMenu(product.id, WEEK)).toBeNull();
  });

  it("AC4: before its email day, Wednesday January 13, it sends nothing and stamps nothing", async () => {
    await assign(WEEK);
    await withRow("paid");
    expect((await run(at("2027-01-13T17:00:00.000Z"))).menuEmail).toEqual({ weekOf: WEEK, sent: 0 });
    expect(email.sent).toEqual([]);
    expect((await repo.findWeekMenu(product.id, WEEK))?.sentAt).toBeNull();
  });

  it("AC4: the day is Cleveland's: 23:30 on Wednesday the 13th there (already the 14th in UTC) sends nothing; midnight on the 14th sends", async () => {
    await assign(WEEK);
    const ada = await withRow("paid");
    await run(at("2027-01-14T04:30:00.000Z"));
    expect(email.sent).toEqual([]);
    await run(at("2027-01-14T05:00:00.000Z"));
    expect(sentTo(ada.member)).toEqual([menuEmailFor(ada.member, ordinary(WEEK), ["2 people · Standard"])]);
  });

  it("AC4: after its email day, a week not yet stamped still goes out: a menu put on late is sent on Saturday the 16th", async () => {
    await assign(WEEK);
    const ada = await withRow("paid");
    expect((await run(at("2027-01-16T17:00:00.000Z"))).menuEmail).toEqual({ weekOf: WEEK, sent: 1 });
    expect(sentTo(ada.member)).toHaveLength(1);
  });

  it("AC4: a second firing over the stamped week sends nothing", async () => {
    await assign(WEEK);
    const ada = await withRow("paid");
    await run();
    expect((await run(at("2027-01-15T15:00:00.000Z"))).menuEmail).toEqual({ weekOf: WEEK, sent: 0 });
    expect(sentTo(ada.member)).toHaveLength(1);
  });

  it("AC4: the stamp survives a change of menu on the week: nothing is sent again", async () => {
    await assign(WEEK);
    const ada = await withRow("paid");
    await run();
    const winter = await repo.createMenu({ name: "Winter roots", texts: { [optionId(1, 0)]: "Beef stew", [optionId(1, 1)]: "Mushroom stew" } });
    await assign(WEEK, winter);
    await run(at("2027-01-15T15:00:00.000Z"));
    expect(sentTo(ada.member)).toHaveLength(1);
  });

  it("AC4: a menu taken off the week and put on again is emailed again", async () => {
    await assign(WEEK);
    const ada = await withRow("paid");
    await run();
    await assign(WEEK, null);
    await assign(WEEK);
    expect((await run(at("2027-01-15T15:00:00.000Z"))).menuEmail).toEqual({ weekOf: WEEK, sent: 1 });
    expect(sentTo(ada.member)).toHaveLength(2);
  });

  it("AC4: a member's failed send is logged with its errorFields and never its message, and stops neither the rest nor the stamp", async () => {
    await assign(WEEK);
    const ada = await withRow("paid");
    const grace = await withRow("paid");
    const failure = new EmailSendError("Resend", 503, "the provider's whole reply, with an address in it");
    const send = email.send.bind(email);
    vi.spyOn(email, "send").mockImplementation(async (message) => (message.to === ada.member.email ? Promise.reject(failure) : send(message)));
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect((await run()).menuEmail).toEqual({ weekOf: WEEK, sent: 1 });

    expect(email.sent.map((message) => message.to)).toEqual([grace.member.email]);
    expect(logged.mock.calls.flat()).toContainEqual(expect.objectContaining(errorFields(failure)));
    expect(inspect(logged.mock.calls, { depth: 5 })).not.toContain("the provider's whole reply");
    expect((await repo.findWeekMenu(product.id, WEEK))?.sentAt).toEqual(RUN_AT);
  });
});

describe("AC5 — the menu email", () => {
  const WEEK_DAYS = ordinary(WEEK);

  it("AC5: in English: the menu email for the week, each menu option's name and lines in position order, the meal, the week after's charge date, the Upcoming weeks link and the off link", async () => {
    await assign(WEEK);
    const ada = await withRow("paid");
    await run();
    expect(email.sent).toEqual([menuEmailFor(ada.member, WEEK_DAYS, ["2 people · Standard"])]);
  });

  it("AC5: the off link is /menu-emails/off under the site, naming the member and carrying a token signed with the session secret the run is given", async () => {
    await assign(WEEK);
    const ada = await withRow("paid");
    await run();
    const link = new RegExp(`(${SITE_URL}/menu-emails/off\\?\\S+)`).exec(email.sent[0]?.text ?? "")?.[1] ?? "http://no.link/";
    const url = new URL(link);
    expect(`${url.origin}${url.pathname}`).toBe(`${SITE_URL}/menu-emails/off`);
    expect(url.searchParams.get("m")).toBe(ada.member.id);
    expect(menuEmailTokenMatches(ada.member.id, url.searchParams.get("t") ?? "", SECRET)).toBe(true);
  });

  it("AC5: a moved week is named by its moved days, in the heading and the pickup line", async () => {
    const moved: PickupWeek = { weekOf: WEEK, firstDay: "2027-01-16", lastDay: "2027-01-17" };
    await repo.savePickupWeek(product.id, { weekOf: WEEK, closedAt: null, note: null, firstDay: moved.firstDay, lastDay: moved.lastDay });
    await assign(WEEK);
    const ada = await withRow("paid");
    await run();
    expect(email.sent).toEqual([menuEmailFor(ada.member, moved, ["2 people · Standard"])]);
  });

  it("AC5: a member whose language is Spanish gets it in Spanish: the Spanish week, pickup line and date", async () => {
    await assign(WEEK);
    const ana = await withRow("paid", { language: "es" });
    await run();
    expect(sentTo(ana.member)).toEqual([menuEmailFor(ana.member, WEEK_DAYS, ["2 people · Standard"])]);
  });

  it("AC5: the menu texts go out as written, in every language: the Spanish email carries the same dishes", async () => {
    await assign(WEEK);
    const ana = await withRow("paid", { language: "es" });
    await run();
    const text = sentTo(ana.member)[0]?.text ?? "";
    expect(inSequence(text, ["Standard", "Squash soup", "Rye bread", "Vegan", "Lentil soup", "Rye bread"])).toEqual([
      "Standard",
      "Squash soup",
      "Rye bread",
      "Vegan",
      "Lentil soup",
      "Rye bread",
    ]);
  });
});

describe("AC6 — the missing-menu email", () => {
  // The admins below hold no box, so every email one of them gets is a reminder. Issue 231: the note reminder emails
  // them too, so these read only their missing-menu emails (menuRemindersTo); the window is the fallback 14, no row set.

  it("AC6: on January 14, with January 17's menu set and January 24's not, every admin gets one email in English naming January 24, and a member none", async () => {
    await assign(WEEK);
    const lenny = await admin();
    const member = await repo.createMember({ email: "member@example.com" });

    const report = await run();

    expect(menuRemindersTo(lenny)).toEqual([missingMenuFor(lenny, [ordinary(NEXT)], A_THURSDAY)]);
    expect(sentTo(member)).toEqual([]);
    expect(report.reminder).toEqual({ weeks: [NEXT], sent: 1 });
  });

  it("AC6: {weekday} is the run's email weekday as a word: with weekday 2 it is Tuesday", async () => {
    await assign(WEEK);
    const lenny = await admin();
    await run({ emailWeekday: 2 });
    expect(menuRemindersTo(lenny)).toEqual([missingMenuFor(lenny, [ordinary(NEXT)], A_TUESDAY)]);
  });

  it("AC6: an admin whose language is Spanish gets it in Spanish: the Spanish week and weekday, and the Weeks link", async () => {
    await assign(WEEK);
    const michael = await admin("es");
    await run();
    expect(menuRemindersTo(michael)).toEqual([missingMenuFor(michael, [ordinary(NEXT)], A_THURSDAY)]);
  });

  it("AC6: an admin who turned the menu email off still gets it", async () => {
    await assign(WEEK);
    const lenny = await admin();
    await repo.setMenuEmails(lenny.id, false);
    await run();
    expect(menuRemindersTo(lenny)).toHaveLength(1);
  });

  it("AC6: several weeks are one email, each week's title joined with ' · ', and the event carries them ascending", async () => {
    const lenny = await admin();
    await run(at("2027-01-16T17:00:00.000Z"));
    expect(menuRemindersTo(lenny)).toEqual([missingMenuFor(lenny, [ordinary(WEEK), ordinary(NEXT)], A_THURSDAY)]);
    expect(reminders()).toEqual([expect.objectContaining({ kind: "menu_reminder_sent", memberId: lenny.id, detail: { weeks: [WEEK, NEXT], date: "2027-01-16" } })]);
  });

  it("AC6: one menu_reminder_sent event per admin the email reached, on that admin's member id, with the weeks and the run's Cleveland date", async () => {
    await assign(WEEK);
    const lenny = await admin();
    const michael = await admin("es");
    await run();
    expect(reminders()).toEqual([
      expect.objectContaining({ kind: "menu_reminder_sent", memberId: lenny.id, detail: { weeks: [NEXT], date: "2027-01-14" } }),
      expect.objectContaining({ kind: "menu_reminder_sent", memberId: michael.id, detail: { weeks: [NEXT], date: "2027-01-14" } }),
    ]);
  });

  it("AC6: a second firing the same Cleveland day sends nothing, records nothing, and still lists the weeks: 23:30 on the 14th there is already the 15th in UTC", async () => {
    await assign(WEEK);
    const lenny = await admin();
    await run();
    expect((await run(at("2027-01-15T04:30:00.000Z"))).reminder).toEqual({ weeks: [NEXT], sent: 0 });
    expect(menuRemindersTo(lenny)).toHaveLength(1);
    expect(reminders()).toHaveLength(1);
  });

  it("AC6: a new day sends again while the week still has no menu, and records that day", async () => {
    await assign(WEEK);
    const lenny = await admin();
    await run();
    expect((await run(at("2027-01-15T15:00:00.000Z"))).reminder).toEqual({ weeks: [NEXT], sent: 1 });
    expect(menuRemindersTo(lenny)).toHaveLength(2);
    expect(reminders().map((event) => (event.kind === "rate_limit_refusal" ? null : event.detail?.date))).toEqual(["2027-01-14", "2027-01-15"]);
  });

  it("AC6: once every week in the next 14 days has a menu, no admin email goes out and no week is listed", async () => {
    await assign(WEEK);
    await assign(NEXT);
    const lenny = await admin();
    expect((await run()).reminder).toEqual({ weeks: [], sent: 0 });
    expect(menuRemindersTo(lenny)).toEqual([]);
    expect(reminders()).toEqual([]);
  });

  it("AC6: an admin's failed send is logged with its errorFields, records no event for that admin, and never stops the others", async () => {
    await assign(WEEK);
    const lenny = await admin();
    const michael = await admin();
    const failure = new EmailSendError("Resend", 503, "the provider's whole reply, with an address in it");
    const send = email.send.bind(email);
    vi.spyOn(email, "send").mockImplementation(async (message) => (message.to === lenny.email ? Promise.reject(failure) : send(message)));
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect((await run()).reminder).toEqual({ weeks: [NEXT], sent: 1 });

    expect(menuRemindersTo(michael)).toHaveLength(1);
    expect(reminders().map((event) => (event.kind === "rate_limit_refusal" ? null : event.memberId))).toEqual([michael.id]);
    expect(logged.mock.calls.flat()).toContainEqual(expect.objectContaining(errorFields(failure)));
    expect(inspect(logged.mock.calls, { depth: 5 })).not.toContain("the provider's whole reply");
  });

  describe("AC6 — which weeks count: open, first pickup day from today to today + 14", () => {
    it("AC6: on Saturday January 16, January 17 and 24 count, and January 31, fifteen days on, does not", async () => {
      expect((await run(at("2027-01-16T17:00:00.000Z"))).reminder.weeks).toEqual([WEEK, NEXT]);
    });

    it("AC6: on Sunday January 17, the week picked up today counts, and January 31, day 14, counts", async () => {
      expect((await run(at("2027-01-17T17:00:00.000Z"))).reminder.weeks).toEqual([WEEK, NEXT, LATER]);
    });

    it("AC6: on Monday January 18, January 17's first pickup day has passed, so it does not count though the week is still current", async () => {
      expect((await run(at("2027-01-18T17:00:00.000Z"))).reminder.weeks).toEqual([NEXT, LATER]);
    });

    it("AC6: a closed week does not count", async () => {
      await repo.closePickupWeek(product.id, NEXT, null, new Date("2027-01-15T15:00:00.000Z"));
      expect((await run(at("2027-01-16T17:00:00.000Z"))).reminder.weeks).toEqual([WEEK]);
    });

    it("AC6: a moved week counts by its moved first day: January 31 moved to Saturday the 30th is day 14 on the 16th", async () => {
      await repo.savePickupWeek(product.id, { weekOf: LATER, closedAt: null, note: null, firstDay: "2027-01-30", lastDay: "2027-01-31" });
      expect((await run(at("2027-01-16T17:00:00.000Z"))).reminder.weeks).toEqual([WEEK, NEXT, LATER]);
    });
  });
});

// Issue 231: the week's note in the menu email, the missing-note reminder, and the two reminders' day counts read from
// settings rows. The block's words and placement are noteBlock's (src/email-templates.test.ts); the parse of a setting is
// wholeNumberSetting's (src/settings.test.ts), each reminder read here once through a seeded row; the window's edges and
// the shared send's cases (once a day, a failed send logged, no event for a failed admin) are the missing-menu
// reminder's tests above, the two reminders' weeks and sends having one home.
describe("AC5 (issue 231) — the note in the menu email", () => {
  const NOTE = "Bring a cooler bag this week";

  it("AC5 (issue 231): with a note on the current week, every menu email carries it, in its note block", async () => {
    await assign(WEEK);
    await noteOn(WEEK, NOTE);
    const ada = await withRow("paid");
    const grace = await withRow("declined");

    expect((await run()).menuEmail).toEqual({ weekOf: WEEK, sent: 2 });

    expect(sentTo(ada.member)).toEqual([menuEmailFor(ada.member, ordinary(WEEK), ["2 people · Standard"], NOTE)]);
    expect(sentTo(grace.member)).toEqual([menuEmailFor(grace.member, ordinary(WEEK), ["2 people · Standard"], NOTE)]);
    for (const message of email.sent) expect(message.text).toContain(NOTE);
  });

  it("AC5 (issue 231): with no note on the current week, no menu email carries one: January 24's note is not January 17's", async () => {
    await assign(WEEK);
    await noteOn(NEXT, NOTE);
    const ada = await withRow("paid");
    await run();
    expect(sentTo(ada.member)).toEqual([menuEmailFor(ada.member, ordinary(WEEK), ["2 people · Standard"])]);
  });
});

describe("AC8 (issue 231) — the missing-note email", () => {
  // On Thursday January 14 the fallback window of 3 days runs to Sunday the 17th: January 17 is in it, January 24 is not.
  // No week here has a menu, so the missing-menu reminder fires first and records its own event that day.

  it("AC8 (issue 231): January 17 open with no note: every admin gets one missing-note email in their language naming it, with the Weeks link; a member none; the report lists it, and not January 24", async () => {
    const lenny = await admin();
    const michael = await admin("es");
    const member = await repo.createMember({ email: "member@example.com" });

    const report = await run();

    expect(noteRemindersTo(lenny)).toEqual([missingNoteFor(lenny, [ordinary(WEEK)])]);
    expect(noteRemindersTo(michael)).toEqual([missingNoteFor(michael, [ordinary(WEEK)])]);
    for (const who of [lenny, michael]) {
      const text = noteRemindersTo(who)[0]?.text ?? "";
      expect(text).toContain(ADMIN_WEEKS_URL);
      expect(`${noteRemindersTo(who)[0]?.subject ?? ""}\n${text}`).toContain(titleOf(ordinary(WEEK), who.language));
    }
    expect(sentTo(member)).toEqual([]);
    expect(report.noteReminder).toEqual({ weeks: [WEEK], sent: 2 });
  });

  it("AC8 (issue 231): one note_reminder_sent event per admin reached, on that admin's member id, with the weeks and the run's Cleveland date", async () => {
    const lenny = await admin();
    const michael = await admin("es");
    await run();
    expect(noteReminders()).toEqual([
      expect.objectContaining({ kind: "note_reminder_sent", memberId: lenny.id, detail: { weeks: [WEEK], date: "2027-01-14" } }),
      expect.objectContaining({ kind: "note_reminder_sent", memberId: michael.id, detail: { weeks: [WEEK], date: "2027-01-14" } }),
    ]);
  });

  it("AC8 (issue 231): a second firing the same Cleveland day sends none and records none, and still lists the week", async () => {
    const lenny = await admin();
    await run();
    expect((await run(at("2027-01-15T04:30:00.000Z"))).noteReminder).toEqual({ weeks: [WEEK], sent: 0 });
    expect(noteRemindersTo(lenny)).toHaveLength(1);
    expect(noteReminders()).toHaveLength(1);
  });

  it("AC8 (issue 231): a week with a note counts for nothing: January 17 noted, no week is listed and no admin gets one", async () => {
    await noteOn(WEEK, "Bring a cooler bag this week");
    const lenny = await admin();
    expect((await run()).noteReminder).toEqual({ weeks: [], sent: 0 });
    expect(noteRemindersTo(lenny)).toEqual([]);
    expect(noteReminders()).toEqual([]);
  });

  it("AC8 (issue 231): a closed week counts for nothing: January 17 closed, no week is listed and no admin gets one", async () => {
    await repo.closePickupWeek(product.id, WEEK, null, new Date("2027-01-12T15:00:00.000Z"));
    const lenny = await admin();
    expect((await run()).noteReminder).toEqual({ weeks: [], sent: 0 });
    expect(noteRemindersTo(lenny)).toEqual([]);
  });
});

describe("AC9 (issue 231) — the reminders' day counts are settings rows", () => {
  it("AC9 (issue 231): the missing-menu reminder reads missing_menu_days: at 7, on January 16 January 17 counts and January 24, eight days on, does not", async () => {
    repo.setSetting("missing_menu_days", "7");
    expect((await run(at("2027-01-16T17:00:00.000Z"))).reminder.weeks).toEqual([WEEK]);
  });

  it("AC9 (issue 231): the missing-note reminder reads missing_note_days: at 10, on January 14 January 17 and January 24 both count", async () => {
    repo.setSetting("missing_note_days", "10");
    expect((await run()).noteReminder?.weeks).toEqual([WEEK, NEXT]);
  });

  it("AC9 (issue 231): MISSING_MENU_DAYS is gone from the menu run's exports", () => {
    expect(Object.keys(menuRunModule)).not.toContain("MISSING_MENU_DAYS");
  });
});

// Issue 186, AC2: the run's inputs carry no menuUrl. A type assertion, so it bites under `npm run typecheck`
// (tsconfig.core.json includes src), not under `vitest run`, where expectTypeOf does nothing.
describe("Issue 186, AC2 — MenuRunDeps", () => {
  it("AC2 (issue 186): MenuRunDeps has no menuUrl field, so a caller passing one fails typecheck", () => {
    expectTypeOf<MenuRunDeps>().not.toHaveProperty("menuUrl");
  });
});
