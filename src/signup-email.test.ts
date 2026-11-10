// Issue 58: deliverSignupConfirmation, the confirmation email a new member gets, over the real catalogs.
// signup-email-catalog.test.ts replaces the Spanish one to show which keys the email reads; who sends it,
// and when, is app/supper-club/actions.test.ts.
import { describe, expect, it } from "vitest";
import { FakeEmail } from "./adapters/fake-email.js";
import { createTranslator } from "./i18n.js";
import type { Member } from "./members.js";
import { en } from "./messages/en.js";
import { pickupWhereLine } from "./pickup-week.js";
import type { SignupConfirmation } from "./ports/repository.js";
import { deliverSignupConfirmation } from "./signup-email.js";

// Issue 101, AC11: the email is the first week's receipt. Its subject and charged line are new words, typed once here.
const SUBJECT = "Receipt: you're in the Supper Club";
const charged = (date: string, amount: string): string => `Charged ${date}: ${amount}, for your first week`;

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
  ...over,
});

const confirmation = (over: Partial<SignupConfirmation> = {}): SignupConfirmation => ({
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
  ...over,
});

/** The one message sent for these, whatever the test is looking at in it. */
async function sent(subject: Member = member(), details: SignupConfirmation = confirmation()) {
  const email = new FakeEmail();
  await deliverSignupConfirmation(email, subject, details, ACCOUNT_URL, SITE_URL);
  expect(email.sent).toHaveLength(1);
  return email.sent[0] ?? { to: "", subject: "", text: "" };
}

/** The approved wording under the issue's Screen section, whole, with the seed's rows. */
const body = (heading: string, firstPickup: string, chargedOn = "Saturday, November 7"): string =>
  [
    heading,
    "",
    "Thank you for joining. Here is what you signed up for.",
    "",
    "How many people?: 2 people",
    "Which menu?: Standard",
    charged(chargedOn, "$50"),
    "Then every week, at the cutoff: $50",
    `First pickup: ${firstPickup}`,
    "",
    "Pickup",
    "Sunday or Monday at the farm store, 2304 Bridge Ave. Give your name at the counter.",
    "",
    "Each week",
    "Each week we email you the menu. Your card is charged $50 at the end of each Monday for the following week's pickup. To skip a week, change your subscription or cancel, sign in to your account before the end of Monday.",
    "",
    "Go to your account: https://members.example.test/",
    "",
    "You sign in with your email. We send you a 6-digit code each time, no password.",
    "",
    "Questions? Reply to this email.",
    "",
    "— Ohio City Farm",
    "Ohio City Farm · 2304 Bridge Ave, Cleveland, OH",
    "You are getting this email because you joined the Supper Club.",
    "",
    "Terms: https://members.example.test/terms",
    "Privacy: https://members.example.test/privacy",
  ].join("\n");

describe("AC1 (issue 58) — the send", () => {
  it("AC1: one message goes to the member's address, and the port's receipt comes back", async () => {
    const email = new FakeEmail();
    const receipt = await deliverSignupConfirmation(email, member(), confirmation(), ACCOUNT_URL, SITE_URL);
    expect(email.sent.map((message) => message.to)).toEqual(["ada@example.com"]);
    expect(receipt.id).toBe("fake-0");
  });
});

describe("AC4 (issue 58) — the wording, in order", () => {
  it(`AC4: the subject is "You're in the Supper Club"`, async () => {
    expect((await sent()).subject).toBe(SUBJECT);
  });

  it("AC4: the body is the wording under Screen, block by block, with the member's name in the heading", async () => {
    expect((await sent()).text).toBe(body("You're in the Supper Club, Ada", "Sunday, January 3"));
  });

  it("AC4: the first charge and the weekly charge are each their own amount, without .00 when whole", async () => {
    const { text } = await sent(member(), confirmation({ firstChargeCents: 8000, weeklyCents: 8550 }));
    expect(text).toContain(`${charged("Saturday, November 7", "$80")}\nThen every week, at the cutoff: $85.50\n`);
    expect(text).toContain("Your card is charged $85.50 at the end of each Monday");
  });

  it("AC4: the money rows follow one line per option, as many as there are, the stored names as they are", async () => {
    const options = [
      { typeName: "Size", optionName: "3–4 people" },
      { typeName: "Which menu?", optionName: "Vegan" },
      { typeName: "Add a loaf", optionName: "Rye" },
    ];
    expect((await sent(member(), confirmation({ options }))).text).toContain(
      `signed up for.\n\nSize: 3–4 people\nWhich menu?: Vegan\nAdd a loaf: Rye\n${charged("Saturday, November 7", "$50")}\n`,
    );
  });

  it("AC4: the account line carries the whole link it is given", async () => {
    const email = new FakeEmail();
    await deliverSignupConfirmation(email, member(), confirmation(), "https://elsewhere.example.test/account", SITE_URL);
    expect(email.last()?.text ?? "").toContain("\nGo to your account: https://elsewhere.example.test/account\n");
  });

  it("AC4: the first pickup is the confirmation's date", async () => {
    expect(
      (await sent(member(), confirmation({ pickupDate: "2027-01-10", firstDay: "2027-01-10", lastDay: "2027-01-11" }))).text,
    ).toContain("\nFirst pickup: Sunday, January 10\n");
  });
});

// Issue 133: the moved lines' words are src/pickup-week.test.ts's; this holds that the email uses them, in their places.
describe("AC4 (issue 133) — a moved first week", () => {
  const MOVED = { weekOf: "2027-01-03", firstDay: "2027-01-02", lastDay: "2027-01-03" };
  const t = createTranslator("en");

  it('AC4: "First pickup:" is the first moved day, and the pickup line names the moved days in place of "Sunday or Monday"', async () => {
    const { text } = await sent(member(), confirmation({ firstDay: MOVED.firstDay, lastDay: MOVED.lastDay }));
    expect(text).toContain("\nThen every week, at the cutoff: $50\nFirst pickup: Saturday, January 2\n\nPickup\n");
    expect(text).toContain(`\nPickup\n${pickupWhereLine(t, MOVED, "en")}\n\nEach week\n`);
    expect(text).not.toContain(en["supperClub.box.pickupWhere"]);
  });
});

describe("AC7 (issue 63) — the footer", () => {
  it("AC7: the email ends with the two lines, after a blank line", async () => {
    expect((await sent()).text.endsWith("\n\nTerms: https://members.example.test/terms\nPrivacy: https://members.example.test/privacy")).toBe(true);
  });

  it("AC7: the links come from the site address, not the account link", async () => {
    const email = new FakeEmail();
    await deliverSignupConfirmation(email, member(), confirmation(), "https://elsewhere.example.test/account", "https://other.example.test/");
    expect(email.last()?.text.endsWith("\nTerms: https://other.example.test/terms\nPrivacy: https://other.example.test/privacy")).toBe(true);
  });
});

describe("AC8 (issue 63) — what the email keeps", () => {
  it("AC8: the sign-off, the farm address and the why-you-got-this line stay together, before the two lines", async () => {
    expect((await sent()).text).toContain(
      "Questions? Reply to this email.\n\n" +
        "— Ohio City Farm\n" +
        "Ohio City Farm · 2304 Bridge Ave, Cleveland, OH\n" +
        "You are getting this email because you joined the Supper Club.\n\n" +
        "Terms: ",
    );
  });
});

describe("AC5 (issue 58) — a member with no first name", () => {
  it(`AC5: the heading has no name: "You're in the Supper Club"`, async () => {
    expect((await sent(member({ firstName: null }))).text).toBe(body("You're in the Supper Club", "Sunday, January 3"));
  });
});

describe("AC6 (issue 58) — the member's stored language", () => {
  it("AC6: a member stored as es gets their dates in Spanish", async () => {
    const { text } = await sent(member({ language: "es" }));
    expect(text).toContain("domingo, 3 de enero");
    expect(text).toContain("sábado, 7 de noviembre");
  });
});

describe("AC11 (issue 101) — the email is the first week's receipt", () => {
  it('AC11: the money rows open with "Charged {date}: {amount}, for your first week", the date the first charge was paid, written as a pickup date is', async () => {
    const { text } = await sent(member(), confirmation({ chargedDate: "2026-12-28", firstChargeCents: 8000 }));
    expect(text).toContain(`\nWhich menu?: Standard\n${charged("Monday, December 28", "$80")}\nThen every week, at the cutoff: $50\n`);
    expect(text).not.toContain("Paid today");
  });

  it(`AC11: the subject is "${SUBJECT}" with or without a first name; without one only the heading stays "You're in the Supper Club"`, async () => {
    const named = await sent();
    const nameless = await sent(member({ firstName: null }));
    expect([named.subject, nameless.subject]).toEqual([SUBJECT, SUBJECT]);
    expect(nameless.text.split("\n")[0]).toBe("You're in the Supper Club");
  });
});

// Issue 101, AC7: the question mark is the pickers' alone; the email shows the option type's name as stored.
describe("AC7 (issue 101) — the email's option lines", () => {
  it('AC7: option types stored as "How many people" and "Which menu" read so, with no question mark', async () => {
    const options = [
      { typeName: "How many people", optionName: "2 people" },
      { typeName: "Which menu", optionName: "Standard" },
    ];
    expect((await sent(member(), confirmation({ options }))).text).toContain("signed up for.\n\nHow many people: 2 people\nWhich menu: Standard\n");
  });
});
