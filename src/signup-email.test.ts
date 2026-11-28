// Issue 58: deliverSignupConfirmation, the confirmation email a new member gets, over the real catalogs.
// signup-email-catalog.test.ts replaces the Spanish one to show which keys the email reads; who sends it,
// and when, is app/supper-club/actions.test.ts.
import { describe, expect, it } from "vitest";
import { FakeEmail } from "./adapters/fake-email.js";
import { createTranslator } from "./i18n.js";
import type { Member } from "./members.js";
import { formatUsdWhole } from "./money.js";
import { formatPickupDate, pickupWhereLine } from "./pickup-week.js";
import type { SignupConfirmation } from "./ports/repository.js";
import { deliverSignupConfirmation } from "./signup-email.js";

// The email's words are the catalog's: signup-email-catalog.test.ts shows which keys it reads. Here, the values it
// carries and the one line it chooses (the heading, by whether there is a first name).
const en = createTranslator("en");

const ACCOUNT_URL = "https://members.example.test/";
const SITE_URL = "https://members.example.test";

const member = (over: Partial<Member> = {}): Member => ({
  id: "6f1c2a52-8f7e-4c3b-9d0a-1b2c3d4e5f60",
  email: "ada@example.com",
  language: "en",
  role: "member",
  createdAt: new Date("2026-10-01T12:00:00.000Z"),
  firstName: "Ada",
  lastName: "Lovelace",
  phone: "216-555-0100",
  emailConfirmedAt: new Date("2026-10-01T12:00:00.000Z"),
  squareCustomerId: null,
  menuEmails: true,
  ...over,
});

const confirmation = (over: Partial<SignupConfirmation> = {}): SignupConfirmation => ({
  subscriptionId: "5eed0000-0000-4000-8000-000000000001",
  pickupDate: "2027-01-03",
  firstDay: "2027-01-03",
  lastDay: "2027-01-04",
  firstChargeCents: 5000,
  weeklyCents: 5000,
  chargedDate: "2026-11-07",
  options: [
    { typeName: "How many people?", optionName: "2 people" },
    { typeName: "Which menu?", optionName: "Standard" },
  ],
  optionsFromWeek: "2027-01-03",
  choices: { size: "two", menu: "standard" },
  ...over,
});

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

/** The one message sent for these, whatever the test is looking at in it. */
async function sent(subject: Member = member(), details: SignupConfirmation = confirmation()) {
  const email = new FakeEmail();
  await deliverSignupConfirmation(email, subject, details, ACCOUNT_URL, SITE_URL);
  expect(email.sent).toHaveLength(1);
  return email.sent[0] ?? { to: "", subject: "", text: "" };
}

describe("AC1 (issue 58) — the send", () => {
  it("AC1: one message goes to the member's address, and the port's receipt comes back", async () => {
    const email = new FakeEmail();
    const receipt = await deliverSignupConfirmation(email, member(), confirmation(), ACCOUNT_URL, SITE_URL);
    expect(email.sent.map((message) => message.to)).toEqual(["ada@example.com"]);
    expect(receipt.id).toBe("fake-0");
  });
});

describe("AC4 (issue 58) — the values, in order", () => {
  it("AC4: the body carries the member's name, the option lines, the charge date and amount, the weekly amount and the first pickup, in that order", async () => {
    const { text } = await sent();
    const values = [
      "Ada",
      "How many people?: 2 people\nWhich menu?: Standard",
      formatPickupDate("2026-11-07", "en"),
      formatUsdWhole(5000),
      formatPickupDate("2027-01-03", "en"),
    ];
    expect(inSequence(text, values)).toEqual(values);
  });

  it("AC4: the first charge and the weekly charge are each their own amount, without .00 when whole", async () => {
    const { text } = await sent(member(), confirmation({ firstChargeCents: 8000, weeklyCents: 8550 }));
    const amounts = [formatUsdWhole(8000), formatUsdWhole(8550)];
    expect(inSequence(text, amounts)).toEqual(amounts);
    expect(text).not.toContain("$80.00");
  });

  it("AC4: the money rows follow one line per option, as many as there are, the stored names as they are", async () => {
    const options = [
      { typeName: "Size", optionName: "3–4 people" },
      { typeName: "Which menu?", optionName: "Vegan" },
      { typeName: "Add a loaf", optionName: "Rye" },
    ];
    expect((await sent(member(), confirmation({ options }))).text).toContain("\nSize: 3–4 people\nWhich menu?: Vegan\nAdd a loaf: Rye\n");
  });

  it("AC4: the account line carries the whole link it is given", async () => {
    const email = new FakeEmail();
    await deliverSignupConfirmation(email, member(), confirmation(), "https://elsewhere.example.test/account", SITE_URL);
    expect(email.last()?.text ?? "").toContain("https://elsewhere.example.test/account");
  });

  it("AC4: the first pickup is the confirmation's date", async () => {
    expect(
      (await sent(member(), confirmation({ pickupDate: "2027-01-10", firstDay: "2027-01-10", lastDay: "2027-01-11" }))).text,
    ).toContain(formatPickupDate("2027-01-10", "en"));
  });
});

// Issue 133: the moved lines' words are src/pickup-week.test.ts's; this holds that the email carries them.
describe("AC4 (issue 133) — a moved first week", () => {
  const MOVED = { weekOf: "2027-01-03", firstDay: "2027-01-02", lastDay: "2027-01-03" };

  it("AC4: the first pickup is the first moved day, and the pickup line is the moved week's", async () => {
    const { text } = await sent(member(), confirmation({ firstDay: MOVED.firstDay, lastDay: MOVED.lastDay }));
    expect(text).toContain(formatPickupDate("2027-01-02", "en"));
    expect(text).toContain(pickupWhereLine(en, MOVED, "en"));
  });
});

describe("AC7 (issue 63) — the footer", () => {
  it("AC7: the email carries the terms and privacy links", async () => {
    const { text } = await sent();
    expect(text).toContain("https://members.example.test/terms");
    expect(text).toContain("https://members.example.test/privacy");
  });

  it("AC7: the links come from the site address, not the account link", async () => {
    const email = new FakeEmail();
    await deliverSignupConfirmation(email, member(), confirmation(), "https://elsewhere.example.test/account", "https://other.example.test/");
    const text = email.last()?.text ?? "";
    expect(text).toContain("https://other.example.test/terms");
    expect(text).toContain("https://other.example.test/privacy");
    expect(text).not.toContain("https://elsewhere.example.test/terms");
  });
});

describe("AC5 (issue 58) — a member with no first name", () => {
  it("AC5: the heading is the nameless line, not the named one", async () => {
    const [named, nameless] = [await sent(), await sent(member({ firstName: null }))];
    expect(named.text.split("\n")[0]).toBe(en("email.signupConfirmation.heading", { firstName: "Ada" }));
    expect(nameless.text.split("\n")[0]).toBe(en("supperClub.done.title"));
  });
});

describe("AC6 (issue 58) — the member's stored language", () => {
  it("AC6: a member stored as es gets their dates in Spanish", async () => {
    const { text } = await sent(member({ language: "es" }));
    // Issue 272: a single day takes the short month, held to its day, in Spanish too.
    expect(text).toContain("domingo, 3\u00a0de\u00a0ene");
    expect(text).toContain("sábado, 7\u00a0de\u00a0nov");
  });
});

describe("AC11 (issue 101) — the email is the first week's receipt", () => {
  it("AC11: after the option lines, the date the first charge was paid, written as a pickup date is, then its amount, then the weekly amount", async () => {
    const { text } = await sent(member(), confirmation({ chargedDate: "2026-12-28", firstChargeCents: 8000 }));
    const values = ["Which menu?: Standard", formatPickupDate("2026-12-28", "en"), formatUsdWhole(8000), formatUsdWhole(5000)];
    expect(inSequence(text, values)).toEqual(values);
  });
});

// Issue 101, AC7: the question mark is the pickers' alone; the email shows the option type's name as stored.
describe("AC7 (issue 101) — the email's option lines", () => {
  it('AC7: option types stored as "How many people" and "Which menu" read so, with no question mark', async () => {
    const options = [
      { typeName: "How many people", optionName: "2 people" },
      { typeName: "Which menu", optionName: "Standard" },
    ];
    expect((await sent(member(), confirmation({ options }))).text).toContain("\nHow many people: 2 people\nWhich menu: Standard\n");
  });
});
