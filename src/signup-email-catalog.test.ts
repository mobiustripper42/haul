// Issue 58, AC6: as src/email-templates.test.ts, the Spanish catalog is replaced for this whole file by a
// stand-in whose every value is its own key in guillemets, so a Spanish render shows exactly which keys the
// email reads, and any English it wrote itself shows up beside them. The stand-in lacks one key, so the same
// render shows the translator's fallback. The spec names no suffixes under `email.signupConfirmation.`, so
// those read as «new»; the reused keys are read by name. Issue 97 moved the address line to `brand.address`,
// shared with the site footer, so it reads by name.
import { describe, expect, it, vi } from "vitest";
import { FakeEmail } from "./adapters/fake-email.js";
import type { Member } from "./members.js";
import { deliverSignupConfirmation } from "./signup-email.js";

vi.mock("./messages/es.js", async () => {
  const { en } = await import("./messages/en.js");
  return {
    es: Object.fromEntries(
      Object.keys(en)
        .filter((key) => key !== "email.signupConfirmation.charged")
        .map((key) => [key, `«${key}»`]),
    ),
  };
});

const member = (firstName: string | null): Member => ({
  id: "6f1c2a52-8f7e-4c3b-9d0a-1b2c3d4e5f60",
  email: "ada@example.com",
  language: "es",
  role: "member",
  createdAt: new Date("2026-10-01T12:00:00.000Z"),
  firstName,
  lastName: null,
  phone: null,
  emailConfirmedAt: null,
  squareCustomerId: null,
});

const CONFIRMATION = {
  pickupDate: "2027-01-03",
  firstChargeCents: 5000,
  weeklyCents: 8550,
  chargedDate: "2026-11-07",
  options: [
    { typeName: "How many people?", optionName: "2 people" },
    { typeName: "Which menu?", optionName: "Standard" },
  ],
};

async function sent(firstName: string | null) {
  const email = new FakeEmail();
  await deliverSignupConfirmation(email, member(firstName), CONFIRMATION, "https://members.example.test/", "https://members.example.test");
  expect(email.sent).toHaveLength(1);
  const message = email.sent[0] ?? { subject: "", text: "" };
  return { subject: message.subject, text: message.text.replace(/«email\.signupConfirmation\.[\w.]+»/g, "«new»") };
}

const body = (heading: string): string =>
  [
    heading,
    "",
    "«new»",
    "",
    "How many people?: 2 people",
    "Which menu?: Standard",
    "Charged sábado, 7 de noviembre: $50, for your first week",
    "«supperClub.weeklyLabel»: $85.50",
    "«supperClub.box.firstPickup»",
    "",
    "«new»",
    "«supperClub.box.pickupWhere»",
    "",
    "«new»",
    "«supperClub.next.menu» «supperClub.next.charge» «supperClub.next.change»",
    "",
    "«supperClub.done.account»: https://members.example.test/",
    "",
    "«new»",
    "",
    "«new»",
    "",
    "«email.signOff»",
    "«brand.address»",
    "«new»",
    "",
    "«email.legalTerms»",
    "«email.legalPrivacy»",
  ].join("\n");

describe("AC6 (issue 58) — the email through the stand-in catalog", () => {
  it("AC6: every word comes from the catalog of the member's stored language, and a string it lacks falls back to English", async () => {
    expect((await sent("Ada")).text).toBe(body("«new»"));
  });

  it("AC4, AC6: the subject is the done page's title", async () => {
    expect((await sent("Ada")).subject).toBe("«email.signupConfirmation.subject»");
  });

  it("AC5, AC6: with no first name the heading is the done page's title", async () => {
    expect((await sent(null)).text).toBe(body("«supperClub.done.title»"));
  });
});
