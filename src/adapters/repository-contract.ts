/**
 * The Repository contract (AC7). One behavioural suite, run against both the in-memory adapter
 * and the Postgres adapter: if both pass it, the in-memory adapter is a faithful fake and the fast
 * tests that lean on it are honest (DEC-010).
 *
 * Not a test file itself: it registers describe/it blocks, and each adapter's test file calls it.
 * `eventActors` reads back the actor of every event row recorded so far, in order (issue 71, AC5).
 * `reset`, when given, runs before every test and before `make` — the Postgres suite truncates
 * there, so each test starts from an empty database.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { AccountDetails } from "../create-account.js";
import { LANGUAGES, type Language } from "../i18n.js";
import { DuplicateEmailError, ROLES, type Role } from "../members.js";
import type { Actor, Repository } from "../ports/repository.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UNKNOWN_UUID = "00000000-0000-4000-8000-000000000000";

export function runRepositoryContract(
  name: string,
  make: () => Promise<Repository>,
  eventActors: () => Promise<Actor[]>,
  reset?: () => Promise<void>,
): void {
  describe(`Repository contract — ${name}`, () => {
    let repo: Repository;

    beforeEach(async () => {
      if (reset) await reset();
      repo = await make();
    });

    describe("createMember", () => {
      it("AC7: returns a member with a UUID id, the normalized email and a createdAt Date", async () => {
        const member = await repo.createMember({ email: "  Ada@Example.COM " });
        expect(member.id).toMatch(UUID);
        expect(member.email).toBe("ada@example.com");
        expect(member.createdAt).toBeInstanceOf(Date);
        expect(Number.isNaN(member.createdAt.getTime())).toBe(false);
      });

      it.each(["ada@example.com", "ADA@EXAMPLE.COM", "  Ada@example.com  "])(
        "AC7: a second createMember with %j throws DuplicateEmailError",
        async (again) => {
          const first = await repo.createMember({ email: "Ada@Example.com" });
          await expect(repo.createMember({ email: again })).rejects.toBeInstanceOf(DuplicateEmailError);
          expect(await repo.findMemberByEmail("ada@example.com")).toEqual(first);
        },
      );
    });

    describe("findMemberByEmail", () => {
      it.each(["ada@example.com", "ADA@EXAMPLE.COM", "  aDa@eXample.com\t"])(
        "AC7: finds the member by %j, regardless of case and surrounding whitespace",
        async (lookup) => {
          const created = await repo.createMember({ email: "  Ada@Example.COM " });
          expect(await repo.findMemberByEmail(lookup)).toEqual(created);
        },
      );

      it("AC7: returns null for an unknown email", async () => {
        await repo.createMember({ email: "ada@example.com" });
        expect(await repo.findMemberByEmail("grace@example.com")).toBeNull();
      });
    });

    describe("findMemberById", () => {
      it("AC7: returns each member by its own id", async () => {
        const ada = await repo.createMember({ email: "ada@example.com" });
        const grace = await repo.createMember({ email: "grace@example.com" });
        expect(ada.id).not.toBe(grace.id);
        expect(await repo.findMemberById(ada.id)).toEqual(ada);
        expect(await repo.findMemberById(grace.id)).toEqual(grace);
      });

      it("AC7: returns null for an unknown UUID", async () => {
        await repo.createMember({ email: "ada@example.com" });
        expect(await repo.findMemberById(UNKNOWN_UUID)).toBeNull();
      });

      it.each(["not-a-uuid", "", "12345"])(
        "AC7: returns null, and does not throw, for %j, which isn't a UUID",
        async (id) => {
          await repo.createMember({ email: "ada@example.com" });
          await expect(repo.findMemberById(id)).resolves.toBeNull();
        },
      );
    });

    describe("member language (issue 7)", () => {
      it('AC9 (issue 7): createMember without a language returns language "en"', async () => {
        const member = await repo.createMember({ email: "ada@example.com" });
        expect(member.language).toBe("en");
      });

      it('AC9 (issue 7): createMember with language "es" returns language "es"', async () => {
        const member = await repo.createMember({ email: "ada@example.com", language: "es" });
        expect(member.language).toBe("es");
      });

      it('AC9 (issue 7): createMember with language "en" returns language "en"', async () => {
        const member = await repo.createMember({ email: "ada@example.com", language: "en" });
        expect(member.language).toBe("en");
      });

      // LANGUAGES and the members.language check constraint must list the same codes; this is what
      // fails (SQLSTATE 23514 on Postgres) when a language is added to one and not the other.
      it.each(Object.keys(LANGUAGES) as Language[])(
        "AC9 (issue 7): createMember accepts every supported language — %j",
        async (code) => {
          const member = await repo.createMember({ email: "ada@example.com", language: code });
          expect(member.language).toBe(code);
        },
      );

      it("AC9 (issue 7): findMemberByEmail returns the stored language", async () => {
        await repo.createMember({ email: "ada@example.com", language: "es" });
        await repo.createMember({ email: "grace@example.com" });
        expect((await repo.findMemberByEmail("ada@example.com"))?.language).toBe("es");
        expect((await repo.findMemberByEmail("grace@example.com"))?.language).toBe("en");
      });

      it("AC9 (issue 7): findMemberById returns the stored language", async () => {
        const ada = await repo.createMember({ email: "ada@example.com", language: "es" });
        const grace = await repo.createMember({ email: "grace@example.com" });
        expect((await repo.findMemberById(ada.id))?.language).toBe("es");
        expect((await repo.findMemberById(grace.id))?.language).toBe("en");
      });
    });

    describe("member role (issue 10)", () => {
      it('AC1 (issue 10): createMember without a role returns role "member"', async () => {
        const member = await repo.createMember({ email: "ada@example.com" });
        expect(member.role).toBe("member");
      });

      it('AC1 (issue 10): createMember with role "admin" returns role "admin"', async () => {
        const member = await repo.createMember({ email: "ada@example.com", role: "admin" });
        expect(member.role).toBe("admin");
      });

      it("AC1 (issue 10): findMemberById returns the stored role", async () => {
        const ada = await repo.createMember({ email: "ada@example.com", role: "admin" });
        const grace = await repo.createMember({ email: "grace@example.com" });
        expect((await repo.findMemberById(ada.id))?.role).toBe("admin");
        expect((await repo.findMemberById(grace.id))?.role).toBe("member");
      });

      it("AC1 (issue 10): findMemberByEmail returns the stored role", async () => {
        await repo.createMember({ email: "ada@example.com", role: "admin" });
        await repo.createMember({ email: "grace@example.com" });
        expect((await repo.findMemberByEmail("ada@example.com"))?.role).toBe("admin");
        expect((await repo.findMemberByEmail("grace@example.com"))?.role).toBe("member");
      });

      // ROLES and the members.role check constraint must list the same roles; this is what fails
      // (SQLSTATE 23514 on Postgres) when a role is added to one and not the other.
      it.each([...ROLES])("AC2 (issue 10): createMember accepts every role in ROLES — %j", async (role: Role) => {
        const member = await repo.createMember({ email: "ada@example.com", role });
        expect(member.role).toBe(role);
        expect((await repo.findMemberById(member.id))?.role).toBe(role);
      });
    });

    // Issue 55: Create Account's one writer, and the one place an email is confirmed.
    describe("saveAccount and confirmMemberEmail (issue 55)", () => {
      const EARLIER = new Date("2026-10-28T13:00:00.000Z");
      const LATER = new Date("2026-10-28T15:00:00.000Z");
      const ADA: AccountDetails = { email: "ada@example.com", firstName: "Ada", lastName: "Lovelace", phone: "216-555-0100", language: "en" };
      const OTHER = { firstName: "Augusta", lastName: "King", phone: "216-555-0199", language: "es" } as const;

      it("AC5: a member made by createMember has no details and is unconfirmed", async () => {
        const member = await repo.createMember({ email: "ada@example.com" });
        expect(member).toMatchObject({ firstName: null, lastName: null, phone: null, emailConfirmedAt: null });
        expect(await repo.findMemberById(member.id)).toEqual(member);
      });

      it("AC5: for a new email it inserts an unconfirmed member, with a UUID id, the role member and the details given", async () => {
        const member = await repo.saveAccount(ADA);
        expect(member.id).toMatch(UUID);
        expect(member).toMatchObject({ ...ADA, role: "member", emailConfirmedAt: null });
        expect(member.createdAt).toBeInstanceOf(Date);
      });

      it("AC5: what it returns is what is stored, found by email and by id", async () => {
        const member = await repo.saveAccount(ADA);
        expect(member.email).toBe("ada@example.com");
        expect(await repo.findMemberByEmail("ada@example.com")).toEqual(member);
        expect(await repo.findMemberById(member.id)).toEqual(member);
      });

      it("AC5: the email is stored normalized", async () => {
        const member = await repo.saveAccount({ ...ADA, email: "  Ada@Example.COM " });
        expect(member.email).toBe("ada@example.com");
      });

      it("AC5: a new member saved inside withActor is gone when fn throws", async () => {
        const failure = new Error("fn failed after saving");
        await expect(
          repo.withActor(null, async (r) => {
            expect((await r.saveAccount(ADA)).email).toBe("ada@example.com");
            throw failure;
          }),
        ).rejects.toBe(failure);
        expect(await repo.findMemberByEmail("ada@example.com")).toBeNull();
      });

      it("AC6: for an unconfirmed member it replaces first name, last name, phone and language, on the same row", async () => {
        const first = await repo.saveAccount(ADA);
        const second = await repo.saveAccount({ ...ADA, ...OTHER });
        expect(second).toEqual({ ...first, ...OTHER });
        expect(await repo.findMemberById(first.id)).toEqual(second);
      });

      it("AC6: the match ignores the email's case and surrounding whitespace", async () => {
        const first = await repo.saveAccount(ADA);
        const second = await repo.saveAccount({ ...ADA, ...OTHER, email: " ADA@example.com " });
        expect(second.id).toBe(first.id);
        expect(second.firstName).toBe("Augusta");
      });

      it("AC6: a member made by createMember is unconfirmed, and takes the details", async () => {
        const created = await repo.createMember({ email: "ada@example.com" });
        const saved = await repo.saveAccount(ADA);
        expect(saved).toMatchObject({ ...ADA, id: created.id, createdAt: created.createdAt });
      });

      it("AC6: it does not touch the role", async () => {
        const admin = await repo.createMember({ email: "ada@example.com", role: "admin" });
        expect(await repo.saveAccount(ADA)).toMatchObject({ id: admin.id, role: "admin", firstName: "Ada" });
      });

      it("AC6: a replacement inside withActor goes back to what it was when fn throws", async () => {
        const first = await repo.saveAccount(ADA);
        const failure = new Error("fn failed after saving");
        await expect(
          repo.withActor(null, async (r) => {
            expect((await r.saveAccount({ ...ADA, ...OTHER })).firstName).toBe("Augusta");
            throw failure;
          }),
        ).rejects.toBe(failure);
        expect(await repo.findMemberById(first.id)).toEqual(first);
      });

      it("AC7: for a confirmed member it changes nothing and returns the member as stored", async () => {
        const { id } = await repo.saveAccount(ADA);
        await repo.confirmMemberEmail(id, EARLIER);
        const stored = await repo.findMemberById(id);
        expect(stored?.firstName).toBe("Ada");
        expect(await repo.saveAccount({ ...ADA, ...OTHER })).toEqual(stored);
        expect(await repo.findMemberById(id)).toEqual(stored);
      });

      it("AC8: confirmMemberEmail sets emailConfirmedAt where it was null", async () => {
        const { id } = await repo.saveAccount(ADA);
        await repo.confirmMemberEmail(id, EARLIER);
        expect((await repo.findMemberById(id))?.emailConfirmedAt).toEqual(EARLIER);
      });

      it("AC8: a second confirmMemberEmail changes nothing", async () => {
        const { id } = await repo.saveAccount(ADA);
        await repo.confirmMemberEmail(id, EARLIER);
        await repo.confirmMemberEmail(id, LATER);
        expect((await repo.findMemberById(id))?.emailConfirmedAt).toEqual(EARLIER);
      });

      it("AC8: it confirms that member and no other", async () => {
        const ada = await repo.saveAccount(ADA);
        const grace = await repo.saveAccount({ ...ADA, email: "grace@example.com" });
        await repo.confirmMemberEmail(ada.id, EARLIER);
        expect((await repo.findMemberById(ada.id))?.emailConfirmedAt).toEqual(EARLIER);
        expect((await repo.findMemberById(grace.id))?.emailConfirmedAt).toBeNull();
      });

      it("AC8: for an unknown member it does nothing and does not throw", async () => {
        await expect(repo.confirmMemberEmail(UNKNOWN_UUID, EARLIER)).resolves.toBeUndefined();
      });
    });

    // Issue 71: a write runs inside withActor, one transaction that names who acted.
    describe("withActor (issue 71)", () => {
      const T0 = new Date("2026-10-28T14:00:00.000Z");
      const MINUTE = 60_000;
      const DAY = 24 * 60 * MINUTE;
      const RIGHT = "a".repeat(64);
      const WRONG = "f".repeat(64);

      /** Which way `promise` settled, so a test can assert a rejection whatever it carries. */
      const outcome = (promise: Promise<unknown>): Promise<"resolved" | "rejected"> =>
        promise.then(
          () => "resolved",
          () => "rejected",
        );

      const saveCode = (r: Repository, subjectId: string) =>
        r.saveSignInCode({ subjectId, codeHash: RIGHT, createdAt: T0, expiresAt: new Date(T0.getTime() + 10 * MINUTE) });

      const hit = (r: Repository) =>
        r.incrementRateLimit("sign-in-request", "203.0.113.7", T0, new Date(T0.getTime() + 60 * MINUTE), new Date(T0.getTime() + MINUTE));

      it("AC2: an event recorded through withActor({ member }) carries that member as its actor", async () => {
        const ada = await repo.createMember({ email: "ada@example.com" });
        await repo.withActor({ member: ada.id }, (r) => r.recordEvent({ kind: "sign_in_by_code", memberId: ada.id }));
        expect(await eventActors()).toEqual([{ member: ada.id }]);
      });

      it("AC4: an event recorded through withActor({ system }) carries that system actor", async () => {
        const ada = await repo.createMember({ email: "ada@example.com" });
        await repo.withActor({ system: "charge-run" }, (r) => r.recordEvent({ kind: "lock", memberId: ada.id }));
        expect(await eventActors()).toEqual([{ system: "charge-run" }]);
      });

      it("AC4: an event recorded through withActor(null) carries a null actor", async () => {
        await repo.withActor(null, (r) =>
          r.recordEvent({ kind: "rate_limit_refusal", bucket: "sign-in-request", key: "203.0.113.7", windowStart: T0 }),
        );
        expect(await eventActors()).toEqual([null]);
      });

      it("AC4: an event recorded outside withActor carries a null actor, as today", async () => {
        const ada = await repo.createMember({ email: "ada@example.com" });
        await repo.recordEvent({ kind: "lock", memberId: ada.id });
        expect(await eventActors()).toEqual([null]);
      });

      it("AC4: actors are per call — events through withActor(Ada), then withActor(Grace), then outside either, carry Ada, Grace and null", async () => {
        const ada = await repo.createMember({ email: "ada@example.com" });
        const grace = await repo.createMember({ email: "grace@example.com" });
        await repo.withActor({ member: ada.id }, (r) => r.recordEvent({ kind: "sign_in_by_code", memberId: ada.id }));
        await repo.withActor({ member: grace.id }, (r) => r.recordEvent({ kind: "sign_in_by_link", memberId: grace.id }));
        await repo.recordEvent({ kind: "lock", memberId: ada.id });
        expect(await eventActors()).toEqual([{ member: ada.id }, { member: grace.id }, null]);
      });

      it("AC5: withActor resolves to what fn resolves to", async () => {
        await expect(repo.withActor(null, async (r) => (await r.createMember({ email: "ada@example.com" })).email)).resolves.toBe(
          "ada@example.com",
        );
      });

      it("AC3: the writes fn makes are kept when fn resolves", async () => {
        const created = await repo.withActor(null, async (r) => {
          const member = await r.createMember({ email: "ada@example.com" });
          await r.recordEvent({ kind: "lock", memberId: member.id });
          return member;
        });
        expect(await repo.findMemberByEmail("ada@example.com")).toEqual(created);
        expect(await eventActors()).toEqual([null]);
      });

      it("AC3: when fn makes two writes and then throws, withActor rejects with that error and neither is kept — no member, no event", async () => {
        const ada = await repo.createMember({ email: "ada@example.com" });
        const failure = new Error("fn failed after two writes");
        await expect(
          repo.withActor({ member: ada.id }, async (r) => {
            const grace = await r.createMember({ email: "grace@example.com" });
            await r.recordEvent({ kind: "lock", memberId: grace.id });
            throw failure;
          }),
        ).rejects.toBe(failure);
        expect(await repo.findMemberByEmail("grace@example.com")).toBeNull();
        expect(await eventActors()).toEqual([]);
      });

      it("AC3: the sign-in store's writes roll back too — a saved code and a rate-limit hit are gone after fn throws", async () => {
        const ada = await repo.createMember({ email: "ada@example.com" });
        const failure = new Error("fn failed after two writes");
        await expect(
          repo.withActor(null, async (r) => {
            await saveCode(r, ada.id);
            await hit(r);
            throw failure;
          }),
        ).rejects.toBe(failure);
        expect(await repo.getSignInCode(ada.id)).toBeNull();
        expect(await hit(repo)).toBe(1);
      });

      it("AC3: a change to a row that existed before fn rolls back to what it was — a claimed attempt on a saved code", async () => {
        const ada = await repo.createMember({ email: "ada@example.com" });
        await saveCode(repo, ada.id);
        const before = await repo.getSignInCode(ada.id);
        const failure = new Error("fn failed after a claim");
        await expect(
          repo.withActor(null, async (r) => {
            await r.claimSignInAttempt(ada.id, { presentedHash: WRONG, maxAttempts: 5, now: new Date(T0.getTime() + MINUTE), windowMs: DAY, maxFailures: 5 });
            await r.consumeSignInCode(ada.id, new Date(T0.getTime() + MINUTE));
            throw failure;
          }),
        ).rejects.toBe(failure);
        expect(await repo.getSignInCode(ada.id)).toEqual(before);
      });

      // The port promises a duplicate email and a non-UUID id as ordinary outcomes (src/ports/repository.ts),
      // so one met inside fn must not break the transaction: fn's later writes still run, and all commit.
      it("AC3/AC5: a DuplicateEmailError caught inside withActor does not break the transaction — withActor resolves, and the member and the later event are kept", async () => {
        const grace = await repo.createMember({ email: "grace@example.com" });
        let duplicate: unknown = "not thrown";
        const run = repo.withActor({ member: grace.id }, async (r) => {
          const member = await r.createMember({ email: "ada@example.com" });
          try {
            await r.createMember({ email: "ADA@example.com" });
          } catch (error) {
            duplicate = error;
          }
          await r.recordEvent({ kind: "lock", memberId: member.id });
          return member;
        });
        await expect(run).resolves.toMatchObject({ email: "ada@example.com" });
        expect(duplicate).toBeInstanceOf(DuplicateEmailError);
        expect(await repo.findMemberByEmail("ada@example.com")).toEqual(await run);
        expect(await eventActors()).toEqual([{ member: grace.id }]);
      });

      it('AC3/AC5: findMemberById("not-a-uuid") returning null inside withActor does not break the transaction — withActor resolves, and the member and the event written after it are kept', async () => {
        const grace = await repo.createMember({ email: "grace@example.com" });
        let found: unknown = "not looked up";
        const run = repo.withActor({ member: grace.id }, async (r) => {
          found = await r.findMemberById("not-a-uuid");
          const member = await r.createMember({ email: "ada@example.com" });
          await r.recordEvent({ kind: "lock", memberId: member.id });
          return member;
        });
        await expect(run).resolves.toMatchObject({ email: "ada@example.com" });
        expect(found).toBeNull();
        expect(await repo.findMemberByEmail("ada@example.com")).toEqual(await run);
        expect(await eventActors()).toEqual([{ member: grace.id }]);
      });

      it("AC3: withActor does not nest — calling withActor on the repository fn receives rejects", async () => {
        let nested: "resolved" | "rejected" | "not called" = "not called";
        await repo.withActor(null, async (r) => {
          nested = await outcome(r.withActor(null, async () => 1));
        });
        expect(nested).toBe("rejected");
      });
    });
  });
}
