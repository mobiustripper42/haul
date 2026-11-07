// Issue 9, AC10: deliverSignInCode, haul's side of delivery — a pending code joined to
// renderEmail and the email port, in the member's own language.
import { describe, expect, it } from "vitest";
import { FakeEmail } from "./adapters/fake-email.js";
import { renderEmail } from "./email-templates.js";
import type { Language } from "./i18n.js";
import type { Member } from "./members.js";
import { deliverSignInCode, deliverSignInLink, signInLinkUrl } from "./sign-in-email.js";
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
