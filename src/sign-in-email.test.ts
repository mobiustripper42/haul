// Issue 9, AC10: deliverSignInCode, haul's side of delivery — a pending code joined to
// renderEmail and the email port, in the member's own language.
import { describe, expect, it } from "vitest";
import { FakeEmail } from "./adapters/fake-email.js";
import { renderEmail } from "./email-templates.js";
import type { Language } from "./i18n.js";
import type { Member } from "./members.js";
import { deliverSignInCode } from "./sign-in-email.js";
import { hashCode } from "./sign-in/code.js";

const member = (language: Language): Member => ({
  id: "6f1c2a52-8f7e-4c3b-9d0a-1b2c3d4e5f60",
  email: "ada@example.com",
  language,
  role: "member",
  createdAt: new Date("2026-10-01T12:00:00.000Z"),
});

describe("AC10 (issue 9) — deliverSignInCode", () => {
  it.each(["en", "es"] as const)(
    "AC10: sends one message to the member, rendered as signInCode in their language (%s) with the code and 10 minutes",
    async (language) => {
      const email = new FakeEmail();
      const subject = member(language);
      await deliverSignInCode(email, { subject, code: "042517", codeHash: hashCode("042517") });

      const rendered = renderEmail("signInCode", language, { code: "042517", minutes: 10 });
      expect(email.sent).toEqual([{ to: "ada@example.com", subject: rendered.subject, text: rendered.text }]);
    },
  );

  it("AC10: the message carries the pending code, not some other", async () => {
    const email = new FakeEmail();
    await deliverSignInCode(email, { subject: member("en"), code: "000731", codeHash: hashCode("000731") });
    expect(email.last()?.text).toBe(renderEmail("signInCode", "en", { code: "000731", minutes: 10 }).text);
  });
});
