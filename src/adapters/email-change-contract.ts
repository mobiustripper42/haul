/**
 * The email change repository contract (issue 156), run against both adapters like `runWeekCreditContract`
 * (DEC-010): `src/adapters/in-memory-repository.test.ts` and `src/adapters/postgres-repository.test.ts` call it.
 *
 * It holds what the repository promises: a member's own details saved without their email, one pending change per
 * member that a new one replaces, its attempts counted, and the change applied or dropped. Which code is right, and
 * when a change has expired, are the core's (`src/email-change.test.ts`); the repository compares no code and no time.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { DuplicateEmailError, type Member } from "../members.js";
import type { Repository } from "../ports/repository.js";
import { CODE_TTL_MS, hashCode } from "../sign-in/code.js";

export function runEmailChangeContract(name: string, make: () => Promise<Repository>, reset?: () => Promise<void>): void {
  describe(`Email change repository contract — ${name}`, () => {
    const NOW = new Date("2026-11-12T15:00:00.000Z");
    const CONFIRMED_AT = new Date("2026-10-01T12:00:00.000Z");
    const LATER = new Date("2026-11-12T15:04:00.000Z");
    const OLD = "ada@example.com";
    const NEW = "ada.new@example.com";

    let repo: Repository;

    beforeEach(async () => {
      if (reset) await reset();
      repo = await make();
    });

    /** Ada, through Create Account and confirmed: the member a Your details page belongs to. */
    const ada = async (email = OLD): Promise<Member> => {
      const member = await repo.saveAccount({ email, firstName: "Ada", lastName: "Lovelace", phone: "216-555-0100", language: "en" });
      await repo.confirmMemberEmail(member.id, CONFIRMED_AT);
      const stored = await repo.findMemberById(member.id);
      if (!stored) throw new Error("the member just saved is gone");
      return stored;
    };

    const start = (memberId: string, newEmail = NEW, code = "123456", now = NOW) =>
      repo.startEmailChange({ memberId, newEmail, codeHash: hashCode(code), now });

    it("AC3: saveMemberDetails stores first name, last name, phone and language for a confirmed member, and returns the member as stored", async () => {
      const member = await ada();
      const saved = await repo.saveMemberDetails(member.id, { firstName: "Adaline", lastName: "Byron", phone: "216-555-0199", language: "es", menuEmails: true });
      const expected = { ...member, firstName: "Adaline", lastName: "Byron", phone: "216-555-0199", language: "es" };
      expect(saved).toEqual(expected);
      expect(await repo.findMemberById(member.id)).toEqual(expected);
    });

    it("AC8: saveMemberDetails leaves the email, its confirmation and a pending change alone", async () => {
      const member = await ada();
      await start(member.id);
      await repo.saveMemberDetails(member.id, { firstName: "Adaline", lastName: "Lovelace", phone: "216-555-0100", language: "en", menuEmails: true });
      expect(await repo.findMemberById(member.id)).toMatchObject({ email: OLD, emailConfirmedAt: CONFIRMED_AT, firstName: "Adaline" });
      expect((await repo.findEmailChange(member.id))?.newEmail).toBe(NEW);
    });

    it("AC7: startEmailChange stores the new address and the code's hash, expiring CODE_TTL_MS after now, with no attempts; the member's email is unchanged", async () => {
      const member = await ada();
      await start(member.id);
      expect(await repo.findEmailChange(member.id)).toEqual({
        memberId: member.id,
        newEmail: NEW,
        codeHash: hashCode("123456"),
        expiresAt: new Date(NOW.getTime() + CODE_TTL_MS),
        attempts: 0,
      });
      expect((await repo.findMemberById(member.id))?.email).toBe(OLD);
    });

    it("AC16: a second startEmailChange replaces the row: the newest address, hash and expiry, and attempts back to 0", async () => {
      const member = await ada();
      await start(member.id);
      await repo.countEmailChangeAttempt(member.id);
      await repo.countEmailChangeAttempt(member.id);
      await start(member.id, "ada.newer@example.com", "654321", LATER);
      expect(await repo.findEmailChange(member.id)).toEqual({
        memberId: member.id,
        newEmail: "ada.newer@example.com",
        codeHash: hashCode("654321"),
        expiresAt: new Date(LATER.getTime() + CODE_TTL_MS),
        attempts: 0,
      });
    });

    it("AC20: findEmailChange is null for a member with none, and each member's row is their own", async () => {
      const member = await ada();
      const grace = await ada("grace@example.com");
      expect(await repo.findEmailChange(member.id)).toBeNull();
      await start(grace.id, "grace.new@example.com");
      expect(await repo.findEmailChange(member.id)).toBeNull();
      expect((await repo.findEmailChange(grace.id))?.newEmail).toBe("grace.new@example.com");
    });

    it("AC12: countEmailChangeAttempt adds one and returns the new count, and findEmailChange reads it back", async () => {
      const member = await ada();
      await start(member.id);
      expect([
        await repo.countEmailChangeAttempt(member.id),
        await repo.countEmailChangeAttempt(member.id),
        await repo.countEmailChangeAttempt(member.id),
      ]).toEqual([1, 2, 3]);
      expect((await repo.findEmailChange(member.id))?.attempts).toBe(3);
    });

    it("AC12: countEmailChangeAttempt is 0 with no row, and makes none", async () => {
      const member = await ada();
      expect(await repo.countEmailChangeAttempt(member.id)).toBe(0);
      expect(await repo.findEmailChange(member.id)).toBeNull();
    });

    it("AC10: applyEmailChange makes the new address the member's email, confirmed at now, deletes the row, and returns the member as stored", async () => {
      const member = await ada();
      await start(member.id);
      const applied = await repo.applyEmailChange(member.id, LATER);
      const expected = { ...member, email: NEW, emailConfirmedAt: LATER };
      expect(applied).toEqual(expected);
      expect(await repo.findMemberById(member.id)).toEqual(expected);
      expect(await repo.findEmailChange(member.id)).toBeNull();
    });

    it("AC10: after applyEmailChange the new address finds the member and the old one finds nobody", async () => {
      const member = await ada();
      await start(member.id);
      await repo.applyEmailChange(member.id, LATER);
      expect((await repo.findMemberByEmail(NEW))?.id).toBe(member.id);
      expect(await repo.findMemberByEmail(OLD)).toBeNull();
    });

    // Review of commit f65a2b3: an address taken since the request is an ordinary outcome, as a duplicate is to
    // createMember (repository-contract.ts), so meeting it inside withActor must not break the transaction.
    it("AC15: applyEmailChange to an address another member has taken since throws DuplicateEmailError without breaking the transaction — a later query in the same withActor runs, and the attempt counted before is kept", async () => {
      const member = await ada();
      await start(member.id);
      await repo.createMember({ email: NEW });
      let applied: unknown = "not thrown";
      const run = repo.withActor({ member: member.id }, async (scoped) => {
        await scoped.countEmailChangeAttempt(member.id);
        try {
          await scoped.applyEmailChange(member.id, LATER);
        } catch (error) {
          applied = error;
        }
        return scoped.findMemberById(member.id);
      });
      await expect(run).resolves.toMatchObject({ id: member.id, email: OLD });
      expect(applied).toBeInstanceOf(DuplicateEmailError);
      expect((await repo.findEmailChange(member.id))?.attempts).toBe(1);
      expect((await repo.findMemberById(member.id))?.email).toBe(OLD);
    });

    it("AC14: dropEmailChange deletes the member's row and leaves their email alone; with none it resolves", async () => {
      const member = await ada();
      await start(member.id);
      expect(await repo.findEmailChange(member.id)).not.toBeNull();
      await repo.dropEmailChange(member.id);
      expect(await repo.findEmailChange(member.id)).toBeNull();
      expect((await repo.findMemberById(member.id))?.email).toBe(OLD);
      await expect(repo.dropEmailChange(member.id)).resolves.toBeUndefined();
    });
  });
}
