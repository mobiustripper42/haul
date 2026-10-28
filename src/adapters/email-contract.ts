/**
 * The email port contract (issue 9, AC1). One behavioural suite, run against `FakeEmail` and
 * against `ResendEmail` over a stubbed `fetch`: if both pass it, the fake is a faithful stand-in
 * for the real adapter (DEC-010).
 *
 * Not a test file itself, as `repository-contract.ts` isn't: it registers describe/it blocks, and
 * `fake-email.test.ts` and `resend-email.test.ts` call it. `make` builds an adapter on the clock
 * it is handed.
 */
import { describe, expect, it } from "vitest";
import type { EmailPort } from "../ports/email.js";

const INSTANT = new Date("2026-10-28T14:25:30.000Z");

export function runEmailContract(name: string, make: (now: () => Date) => EmailPort): void {
  describe(`Email contract — ${name}`, () => {
    it("AC1 (issue 9): send resolves to { sentAt, id }, sentAt the injected clock's instant and id a non-empty string", async () => {
      const email = make(() => new Date(INSTANT));
      const receipt = await email.send({
        to: "ada@example.com",
        subject: "Your OCF Member Portal sign-in code",
        text: "Your sign-in code is 042517.",
      });
      expect(receipt.sentAt).toBeInstanceOf(Date);
      expect(receipt.sentAt.getTime()).toBe(INSTANT.getTime());
      expect(typeof receipt.id).toBe("string");
      expect(receipt.id).not.toBe("");
    });
  });
}
