// Issue 141: the menu run over an InMemoryRepository and a FakeEmail. Owned here: which week is current and what menu it
// holds (`currentWeekMenu`, which the menu page reads too), the email weekday read from the env (`menuEmailWeekday`),
// when the week's menu email goes out and to whom, the stamp that makes it once, the missing-menu reminder and the event
// that makes it once a day, and the words of both emails as they are sent (new copy, typed once here). Which rows a week
// makes and their picks are the repository's (`listWeekMade`, src/adapters/menu-contract.ts); the email date's edges are
// menuEmailDate's (src/pickup-week.test.ts); the off link's token is src/menu-email-link.test.ts's.
//
// The Supper Club's weeks: January 17's cutoff date is Monday the 11th, so with MENU_EMAIL_WEEKDAY 4 its email goes out
// on Thursday the 14th. On the 14th the current week is January 17, January 10's last pickup day (the 11th) having passed.
import { inspect } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeEmail } from "./adapters/fake-email.js";
import { InMemoryRepository } from "./adapters/in-memory-repository.js";
import { legalFooter } from "./email-templates.js";
import { createTranslator, type Language } from "./i18n.js";
import { menuEmailTokenMatches } from "./menu-email-link.js";
import { currentWeekMenu, menuEmailWeekday, runMenuRun, type MenuRunDeps, type MenuRunReport } from "./menu-run.js";
import type { Member } from "./members.js";
import type { Menu } from "./menus.js";
import { addDays, formatPickupDate, pickupWeek, pickupWhereLine, weekTitle, type PickupWeek } from "./pickup-week.js";
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
const MENU_URL = "https://members.example.test/menu";
const SECRET = "s".repeat(32) + "-test-secret";
const MENU_SUBJECT = "This week's Supper Club menu";

const en = createTranslator("en");
const es = createTranslator("es");

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
    menuUrl: MENU_URL,
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
const menuEmails = (): EmailMessage[] => email.sent.filter((message) => message.subject === MENU_SUBJECT);
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

    expect(sentTo(ada.member)).toHaveLength(1);
    const text = sentTo(ada.member)[0]?.text ?? "";
    expect(inSequence(text, ["Your meal: 2 people · Standard.", "Your meal: 3–4 people · Vegan."])).toEqual([
      "Your meal: 2 people · Standard.",
      "Your meal: 3–4 people · Vegan.",
    ]);
  });

  it("AC3: the meal line is the picks in effect for the week: switched from January 17, it is the new picks", async () => {
    await assign(WEEK);
    const ada = await withRow("paid");
    expect(await repo.switchPicks(ada.subscriptionId, picks(1, 1), WEEK, 8000)).toBe("switched");
    await run();
    expect(sentTo(ada.member)[0]?.text).toContain("Your meal: 3–4 people · Vegan.");
  });

  it("AC3: switched only from January 24, the meal line is still the picks January 17 was made with", async () => {
    await assign(WEEK);
    const ada = await withRow("paid");
    expect(await repo.switchPicks(ada.subscriptionId, picks(1, 1), NEXT, 8000)).toBe("switched");
    await run();
    expect(sentTo(ada.member)[0]?.text).toContain("Your meal: 2 people · Standard.");
  });

  it("AC3: the week is the current one, not merely the next to cut off: with January 17 closed the run's week is January 24, before its own email day", async () => {
    await assign(NEXT);
    await withRow("paid", { week: NEXT });
    await repo.closePickupWeek(product.id, WEEK, null, new Date("2027-01-12T15:00:00.000Z"));
    expect((await run()).menuEmail).toEqual({ weekOf: NEXT, sent: 0 });
    expect(menuEmails()).toEqual([]);
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
    expect(menuEmails()).toEqual([]);
    expect(await repo.findWeekMenu(product.id, WEEK)).toBeNull();
  });

  it("AC4: before its email day, Wednesday January 13, it sends nothing and stamps nothing", async () => {
    await assign(WEEK);
    await withRow("paid");
    expect((await run(at("2027-01-13T17:00:00.000Z"))).menuEmail).toEqual({ weekOf: WEEK, sent: 0 });
    expect(menuEmails()).toEqual([]);
    expect((await repo.findWeekMenu(product.id, WEEK))?.sentAt).toBeNull();
  });

  it("AC4: the day is Cleveland's: 23:30 on Wednesday the 13th there (already the 14th in UTC) sends nothing; midnight on the 14th sends", async () => {
    await assign(WEEK);
    const ada = await withRow("paid");
    await run(at("2027-01-14T04:30:00.000Z"));
    expect(menuEmails()).toEqual([]);
    await run(at("2027-01-14T05:00:00.000Z"));
    expect(sentTo(ada.member).map((message) => message.subject)).toEqual([MENU_SUBJECT]);
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

  it("AC5: in English: the subject, then Menu for the week, each menu option's name and lines in position order, the meal line, Pick up, the week after's charge and the Upcoming weeks link, the sign-off, the off link, and the legal footer", async () => {
    await assign(WEEK);
    const ada = await withRow("paid");
    await run();

    expect(email.sent.map((message) => [message.to, message.subject])).toEqual([[ada.member.email, MENU_SUBJECT]]);
    const text = email.sent[0]?.text ?? "";
    const order = [
      `Menu for ${titleOf(WEEK_DAYS)}\n`,
      "Standard",
      "Squash soup",
      "Rye bread",
      "Vegan",
      "Lentil soup",
      "Rye bread",
      "Your meal: 2 people · Standard.\n",
      `Pick up ${pickupWhereLine(en, WEEK_DAYS, "en")}\n`,
      "The week after is charged at the end of Monday, January 18. To skip or switch it, sign in before then.",
      ACCOUNT_WEEKS_URL,
      en("email.signOff"),
      "\nTurn off the weekly menu email: ",
    ];
    expect(inSequence(text, order)).toEqual(order);
    expect(text.endsWith(`\n${legalFooter(en, SITE_URL)}`)).toBe(true);
  });

  it("AC5: the off link is /menu-emails/off under the site, naming the member and carrying a token signed with the session secret the run is given", async () => {
    await assign(WEEK);
    const ada = await withRow("paid");
    await run();
    const link = /Turn off the weekly menu email: (\S+)\n/.exec(email.sent[0]?.text ?? "")?.[1] ?? "http://no.link/";
    const url = new URL(link);
    expect(`${url.origin}${url.pathname}`).toBe(`${SITE_URL}/menu-emails/off`);
    expect(url.searchParams.get("m")).toBe(ada.member.id);
    expect(menuEmailTokenMatches(ada.member.id, url.searchParams.get("t") ?? "", SECRET)).toBe(true);
  });

  it("AC5: a moved week is named by its moved days, and Pick up names them", async () => {
    const moved: PickupWeek = { weekOf: WEEK, firstDay: "2027-01-16", lastDay: "2027-01-17" };
    await repo.savePickupWeek(product.id, { weekOf: WEEK, closedAt: null, note: null, firstDay: moved.firstDay, lastDay: moved.lastDay });
    await assign(WEEK);
    await withRow("paid");
    await run();
    const text = email.sent[0]?.text ?? "";
    expect(text).toContain(`Menu for ${titleOf(moved)}\n`);
    expect(text).toContain(`Pick up ${pickupWhereLine(en, moved, "en")}\n`);
  });

  it("AC5: a member whose language is Spanish gets it in Spanish: its own subject, the Spanish week, Recogida over the Spanish pickup line, the Spanish date and footer", async () => {
    await assign(WEEK);
    const ana = await withRow("paid", { language: "es" });
    await run();
    const [message] = sentTo(ana.member);
    expect(message?.subject ?? "").toMatch(/\S/);
    expect(message?.subject).not.toBe(MENU_SUBJECT);
    const text = message?.text ?? "";
    expect(inSequence(text, [titleOf(WEEK_DAYS, "es"), `Recogida: ${pickupWhereLine(es, WEEK_DAYS, "es")}\n`, formatPickupDate("2027-01-18", "es")])).toEqual([
      titleOf(WEEK_DAYS, "es"),
      `Recogida: ${pickupWhereLine(es, WEEK_DAYS, "es")}\n`,
      formatPickupDate("2027-01-18", "es"),
    ]);
    expect(text).not.toContain("Menu for");
    expect(text).not.toContain("Turn off the weekly menu email");
    expect(text.endsWith(`\n${legalFooter(es, SITE_URL)}`)).toBe(true);
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
  const BODY = (weekday: string) =>
    `The menu email to members goes out on ${weekday} once the week has a menu, and the menu page says the menu is on the way until then. Assign a menu to the week under Weeks: ${ADMIN_WEEKS_URL}.`;
  const reminderTo = (member: Member) => sentTo(member).filter((message) => message.subject !== MENU_SUBJECT);

  it("AC6: on January 14, with January 17's menu set and January 24's not, every admin gets one email in English naming January 24, and a member none", async () => {
    await assign(WEEK);
    const lenny = await admin();
    const member = await repo.createMember({ email: "member@example.com" });

    const report = await run();

    expect(reminderTo(lenny).map((message) => message.subject)).toEqual([`No menu yet for ${titleOf(ordinary(NEXT))}`]);
    const text = reminderTo(lenny)[0]?.text ?? "";
    expect(text.startsWith(BODY("Thursday"))).toBe(true);
    expect(inSequence(text, [en("email.signOff"), legalFooter(en, SITE_URL)])).toEqual([en("email.signOff"), legalFooter(en, SITE_URL)]);
    expect(sentTo(member)).toEqual([]);
    expect(report.reminder).toEqual({ weeks: [NEXT], sent: 1 });
  });

  it("AC6: {weekday} is the run's email weekday as a word: with weekday 2 it is Tuesday", async () => {
    await assign(WEEK);
    const lenny = await admin();
    await run({ emailWeekday: 2 });
    expect(reminderTo(lenny)[0]?.text.startsWith(BODY("Tuesday"))).toBe(true);
  });

  it("AC6: an admin whose language is Spanish gets it in Spanish: the Spanish week and weekday, the Weeks link and the Spanish footer", async () => {
    await assign(WEEK);
    const michael = await admin("es");
    await run();
    const [message] = reminderTo(michael);
    expect(message?.subject).toContain(titleOf(ordinary(NEXT), "es"));
    expect(message?.subject).not.toBe(`No menu yet for ${titleOf(ordinary(NEXT))}`);
    expect(inSequence(message?.text ?? "", ["jueves", ADMIN_WEEKS_URL])).toEqual(["jueves", ADMIN_WEEKS_URL]);
    expect(message?.text.endsWith(`\n${legalFooter(es, SITE_URL)}`)).toBe(true);
  });

  it("AC6: an admin who turned the menu email off still gets it", async () => {
    await assign(WEEK);
    const lenny = await admin();
    await repo.setMenuEmails(lenny.id, false);
    await run();
    expect(reminderTo(lenny)).toHaveLength(1);
  });

  it("AC6: several weeks are one email, each week's title joined with ' · ', and the event carries them ascending", async () => {
    const lenny = await admin();
    await run(at("2027-01-16T17:00:00.000Z"));
    expect(reminderTo(lenny).map((message) => message.subject)).toEqual([`No menu yet for ${titleOf(ordinary(WEEK))} · ${titleOf(ordinary(NEXT))}`]);
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
    expect(reminderTo(lenny)).toHaveLength(1);
    expect(reminders()).toHaveLength(1);
  });

  it("AC6: a new day sends again while the week still has no menu, and records that day", async () => {
    await assign(WEEK);
    const lenny = await admin();
    await run();
    expect((await run(at("2027-01-15T15:00:00.000Z"))).reminder).toEqual({ weeks: [NEXT], sent: 1 });
    expect(reminderTo(lenny)).toHaveLength(2);
    expect(reminders().map((event) => (event.kind === "rate_limit_refusal" ? null : event.detail?.date))).toEqual(["2027-01-14", "2027-01-15"]);
  });

  it("AC6: once every week in the next 14 days has a menu, no admin email goes out and no week is listed", async () => {
    await assign(WEEK);
    await assign(NEXT);
    const lenny = await admin();
    expect((await run()).reminder).toEqual({ weeks: [], sent: 0 });
    expect(reminderTo(lenny)).toEqual([]);
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

    expect(reminderTo(michael)).toHaveLength(1);
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
