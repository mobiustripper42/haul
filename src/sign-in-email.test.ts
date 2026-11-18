// Issue 9, AC10: deliverSignInCode, haul's side of delivery — a pending code joined to
// renderEmail and the email port, in the member's own language.
import { describe, expect, it } from "vitest";
import { FakeEmail } from "./adapters/fake-email.js";
import { renderEmail } from "./email-templates.js";
import type { Language } from "./i18n.js";
import type { Member } from "./members.js";
import {
  deliverEmailChangeCode,
  deliverEmailChangedNotice,
  deliverSignInCode,
  deliverSignInLink,
  signInLinkUrl,
} from "./sign-in-email.js";
import { hashCode } from "./sign-in/code.js";

const member = (language: Language): Member => ({
  id: "6f1c2a52-8f7e-4c3b-9d0a-1b2c3d4e5f60",
  email: "ada@example.com",
  language,
  role: "member",
  createdAt: new Date("2026-10-01T12:00:00.000Z"),
  firstName: null,
  lastName: null,
  phone: null,
  emailConfirmedAt: null,
  squareCustomerId: null,
  menuEmails: true,
});

const SITE_URL = "https://members.example.test";

describe("AC10 (issue 9) — deliverSignInCode", () => {
  it.each(["en", "es"] as const)(
    "AC10: sends one message to the member, rendered as signInCode in their language (%s) with the code and 10 minutes",
    async (language) => {
      const email = new FakeEmail();
      const subject = member(language);
      await deliverSignInCode(email, { subject, code: "042517", codeHash: hashCode("042517") }, SITE_URL);

      const rendered = renderEmail("signInCode", language, { code: "042517", minutes: 10 }, SITE_URL);
      expect(email.sent).toEqual([{ to: "ada@example.com", subject: rendered.subject, text: rendered.text }]);
    },
  );

  it("AC10: the message carries the pending code, not some other", async () => {
    const email = new FakeEmail();
    await deliverSignInCode(email, { subject: member("en"), code: "000731", codeHash: hashCode("000731") }, SITE_URL);
    expect(email.last()?.text).toBe(renderEmail("signInCode", "en", { code: "000731", minutes: 10 }, SITE_URL).text);
  });
});

describe("AC16 (issue 22) — deliverSignInLink and signInLinkUrl", () => {
  const URL_A = "https://members.ohiocityfarm.com/sign-in/link?token=AbC_-123";

  it.each(["en", "es"] as const)(
    "AC16: sends one message to the member, rendered as signInLink in their language (%s) with the url and 10 minutes",
    async (language) => {
      const email = new FakeEmail();
      await deliverSignInLink(email, member(language), URL_A, SITE_URL);

      const rendered = renderEmail("signInLink", language, { link: URL_A, minutes: 10 }, SITE_URL);
      expect(email.sent).toEqual([{ to: "ada@example.com", subject: rendered.subject, text: rendered.text }]);
    },
  );

  it.each(["https://members.ohiocityfarm.com", "https://members.ohiocityfarm.com/"])(
    "AC16: signInLinkUrl(%j, token) is <siteUrl>/sign-in/link?token=<token>",
    (siteUrl) => {
      expect(signInLinkUrl(siteUrl, "AbC_-123")).toBe("https://members.ohiocityfarm.com/sign-in/link?token=AbC_-123");
    },
  );
});

// Issue 156: the two emails of an email change, checked against renderEmail in the member's language.
const NEW_EMAIL = "ada.new@example.com";

describe("AC7 (issue 156) — deliverEmailChangeCode", () => {
  it.each(["en", "es"] as const)(
    "AC7: sends one message to the new address, never the old, rendered as emailChangeCode in the member's language (%s) with the code and 10 minutes",
    async (language) => {
      const email = new FakeEmail();
      await deliverEmailChangeCode(email, { member: member(language), newEmail: NEW_EMAIL, code: "042517" }, SITE_URL);
      expect(email.sent).toEqual([{ to: NEW_EMAIL, ...renderEmail("emailChangeCode", language, { code: "042517", minutes: 10 }, SITE_URL) }]);
    },
  );
});

describe("AC19 (issue 156) — deliverEmailChangedNotice", () => {
  it.each(["en", "es"] as const)(
    "AC19: sends one message to the old address, rendered as emailChanged in the member's language (%s) naming the new one",
    async (language) => {
      const email = new FakeEmail();
      await deliverEmailChangedNotice(email, { member: { ...member(language), email: NEW_EMAIL }, oldEmail: "ada@example.com", newEmail: NEW_EMAIL }, SITE_URL);
      expect(email.sent).toEqual([{ to: "ada@example.com", ...renderEmail("emailChanged", language, { email: NEW_EMAIL }, SITE_URL) }]);
    },
  );
});

describe("AC7 (issue 63) — the footer on both sign-in emails", () => {
  const OTHER_SITE = "https://other.example.test";

  it("AC7: the sign-in code email's footer is from the site address it is given", async () => {
    const email = new FakeEmail();
    await deliverSignInCode(email, { subject: member("en"), code: "042517", codeHash: hashCode("042517") }, OTHER_SITE);
    expect(email.last()?.text).toBe(renderEmail("signInCode", "en", { code: "042517", minutes: 10 }, OTHER_SITE).text);
  });

  it("AC7: the sign-in link email's footer is from the site address it is given", async () => {
    const email = new FakeEmail();
    const link = "https://elsewhere.example.test/sign-in/link?token=AbC_-123";
    await deliverSignInLink(email, member("en"), link, OTHER_SITE);
    expect(email.last()?.text).toBe(renderEmail("signInLink", "en", { link, minutes: 10 }, OTHER_SITE).text);
  });
});
