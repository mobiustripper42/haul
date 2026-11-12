// Issue 9, AC10: deliverSignInCode, haul's side of delivery — a pending code joined to
// renderEmail and the email port, in the member's own language.
import { describe, expect, it } from "vitest";
import { FakeEmail } from "./adapters/fake-email.js";
import { legalFooter, renderEmail } from "./email-templates.js";
import { createTranslator, type Language } from "./i18n.js";
import type { Member } from "./members.js";
import { en } from "./messages/en.js";
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
});

const SITE_URL = "https://members.example.test";
const FOOTER = "\n\nTerms: https://members.example.test/terms\nPrivacy: https://members.example.test/privacy";

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

// Issue 156: the two emails of an email change. Their words are new copy, typed once here; the sign-off and the
// footer are every email's (renderEmail, legalFooter), read from the catalog. A Spanish member's are built from
// the es keys.
const NEW_EMAIL = "ada.new@example.com";
const es = createTranslator("es");

describe("AC7 (issue 156) — deliverEmailChangeCode", () => {
  const SUBJECT = "Confirm your new email for Ohio City Farm";
  const BODY =
    "Your code is 042517. Enter it on the Your details page to confirm this address. It works for 10 minutes. If you didn't ask for this, ignore this email.";

  it("AC7: sends one message to the new address, never the old: the subject, the body with the code and 10 minutes, the sign-off and the footer", async () => {
    const email = new FakeEmail();
    await deliverEmailChangeCode(email, { member: member("en"), newEmail: NEW_EMAIL, code: "042517" }, SITE_URL);
    expect(email.sent).toEqual([{ to: NEW_EMAIL, subject: SUBJECT, text: `${BODY}\n\n${en["email.signOff"]}${FOOTER}` }]);
  });

  it("AC7: a Spanish member's code email is built from the es keys", async () => {
    const email = new FakeEmail();
    await deliverEmailChangeCode(email, { member: member("es"), newEmail: NEW_EMAIL, code: "042517" }, SITE_URL);
    const subject = es("details.codeEmail.subject");
    expect(subject).not.toBe("");
    expect(subject).not.toBe(SUBJECT);
    expect(email.sent).toEqual([
      {
        to: NEW_EMAIL,
        subject,
        text: `${es("details.codeEmail.body", { code: "042517", minutes: 10 })}\n\n${es("email.signOff")}\n\n${legalFooter(es, SITE_URL)}`,
      },
    ]);
  });
});

describe("AC19 (issue 156) — deliverEmailChangedNotice", () => {
  const SUBJECT = "Your Ohio City Farm sign-in email was changed";
  const BODY = `The sign-in email for your Ohio City Farm account is now ${NEW_EMAIL}. If you made this change, there is nothing to do. If you didn't, contact the farm.`;

  it("AC19: sends one message to the old address naming the new one: the subject, the body, the sign-off and the footer", async () => {
    const email = new FakeEmail();
    await deliverEmailChangedNotice(email, { member: { ...member("en"), email: NEW_EMAIL }, oldEmail: "ada@example.com", newEmail: NEW_EMAIL }, SITE_URL);
    expect(email.sent).toEqual([{ to: "ada@example.com", subject: SUBJECT, text: `${BODY}\n\n${en["email.signOff"]}${FOOTER}` }]);
  });

  it("AC19: a Spanish member's notice is built from the es keys", async () => {
    const email = new FakeEmail();
    await deliverEmailChangedNotice(email, { member: { ...member("es"), email: NEW_EMAIL }, oldEmail: "ada@example.com", newEmail: NEW_EMAIL }, SITE_URL);
    const subject = es("details.changedEmail.subject");
    expect(subject).not.toBe("");
    expect(subject).not.toBe(SUBJECT);
    expect(email.sent).toEqual([
      {
        to: "ada@example.com",
        subject,
        text: `${es("details.changedEmail.body", { email: NEW_EMAIL })}\n\n${es("email.signOff")}\n\n${legalFooter(es, SITE_URL)}`,
      },
    ]);
  });
});

describe("AC7 (issue 63) — the footer on both sign-in emails", () => {
  it("AC7: the sign-in code email ends with the two lines, from the site address it is given", async () => {
    const email = new FakeEmail();
    await deliverSignInCode(email, { subject: member("en"), code: "042517", codeHash: hashCode("042517") }, SITE_URL);
    expect(email.last()?.text.slice(-FOOTER.length)).toBe(FOOTER);
  });

  it("AC7: the sign-in link email ends with the two lines, from the site address it is given", async () => {
    const email = new FakeEmail();
    await deliverSignInLink(email, member("en"), "https://elsewhere.example.test/sign-in/link?token=AbC_-123", SITE_URL);
    expect(email.last()?.text.slice(-FOOTER.length)).toBe(FOOTER);
  });
});
