/**
 * The Repository contract (AC7). One behavioural suite, run against both the in-memory adapter
 * and the Postgres adapter: if both pass it, the in-memory adapter is a faithful fake and the fast
 * tests that lean on it are honest (DEC-010).
 *
 * Not a test file itself: it registers describe/it blocks, and each adapter's test file calls it.
 * `eventActors` reads back the actor of every event row recorded so far, in order (issue 71, AC5).
 * `reset`, when given, runs before every test and before `make` — the Postgres suite truncates
 * there, so each test starts from an empty database.
 *
 * `runSignupContract` is issue 56's repository methods. A signup needs a product with options, so it
 * takes `addProduct` as `runProductContract` does, and the adapters' product test files call it.
 *
 * `runWeekCreditContract` is issue 149's: closing and reopening a week, and the week credits closing grants. It
 * takes `addProduct` and two seams each adapter's repository test file passes in: `addLedgerRow`, a ledger row
 * as the charge run would write it, and `setSubscriptionOptions`, a subscription's picks replaced as a switch
 * would (task 2.6). The fake has a method for each; Postgres writes them with raw SQL.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { AccountDetails } from "../create-account.js";
import { LANGUAGES, type Language } from "../i18n.js";
import { DuplicateEmailError, ROLES, type Role } from "../members.js";
import type { ChangedWeek } from "../pickup-week.js";
import type { Actor, PendingSignup, PendingSignupInput, Repository } from "../ports/repository.js";
import type { ProductInput, ProductWithOptions } from "../products.js";

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

const BOX: ProductInput = {
  name: "Box",
  cap: 50,
  firstPickupDate: "2027-01-03",
  cutoffWeekday: 1,
  cutoffTime: "24:00:00",
  optionTypes: [
    {
      name: "How many people?",
      position: 1,
      options: [
        { name: "2 people", priceCents: 5000, position: 1 },
        { name: "3–4 people", priceCents: 8000, position: 2 },
      ],
    },
    {
      name: "Which menu?",
      position: 2,
      options: [
        { name: "Standard", priceCents: 0, position: 1 },
        { name: "Vegan", priceCents: 0, position: 2 },
      ],
    },
  ],
};

export function runSignupContract(
  name: string,
  make: () => Promise<Repository>,
  addProduct: (input: ProductInput) => Promise<ProductWithOptions>,
  reset?: () => Promise<void>,
): void {
  describe(`Signup repository contract — ${name}`, () => {
    const CONSENT_AT = new Date("2026-11-06T15:00:00.000Z");
    const PAID_AT = new Date("2026-11-06T15:00:05.000Z");

    let repo: Repository;
    let product: ProductWithOptions;
    let memberId: string;

    beforeEach(async () => {
      if (reset) await reset();
      repo = await make();
      product = await addProduct(BOX);
      memberId = (await repo.createMember({ email: "ada@example.com" })).id;
    });

    /** The option at `size` and `menu`: a type or option the product lacks gives an id that matches nothing. */
    const picks = (size: number, menu: number): Record<string, string> => {
      const [sizes, menus] = product.optionTypes;
      return {
        [sizes?.id ?? "no size type"]: sizes?.options[size]?.id ?? "no such size",
        [menus?.id ?? "no menu type"]: menus?.options[menu]?.id ?? "no such menu",
      };
    };

    const input = (over: Partial<PendingSignupInput> = {}): PendingSignupInput => ({
      memberId,
      productId: product.id,
      choices: picks(0, 0),
      firstChargeCents: 5000,
      weeklyCents: 5000,
      pickupDate: "2027-01-03",
      consentText: "I agree to a weekly charge of $50.",
      consentAt: CONSENT_AT,
      ...over,
    });

    const pending = () => repo.findPendingSignup(memberId, product.id);

    /** Compares option ids whatever order an adapter reads them in. */
    const sorted = (ids: readonly string[] | undefined) => [...(ids ?? [])].sort();

    /** What the rows came to; an empty id here means the write that made them did nothing. */
    const saved = async (over: Partial<PendingSignupInput> = {}): Promise<PendingSignup> => {
      const signup = await repo.savePendingSignup(input(over));
      expect(signup.ledgerId).not.toBe("");
      return signup;
    };

    describe("AC6 — a member's Square customer", () => {
      it("AC6: a new member has none", async () => {
        expect((await repo.findMemberById(memberId))?.squareCustomerId).toBeNull();
      });

      it("AC6: setMemberSquareCustomer stores it, found by id and by email", async () => {
        await repo.setMemberSquareCustomer(memberId, "CUSTOMER_1");
        expect((await repo.findMemberById(memberId))?.squareCustomerId).toBe("CUSTOMER_1");
        expect((await repo.findMemberByEmail("ada@example.com"))?.squareCustomerId).toBe("CUSTOMER_1");
      });

      it("AC6: it stores it on that member and no other", async () => {
        const grace = await repo.createMember({ email: "grace@example.com" });
        await repo.setMemberSquareCustomer(memberId, "CUSTOMER_1");
        expect((await repo.findMemberById(memberId))?.squareCustomerId).toBe("CUSTOMER_1");
        expect((await repo.findMemberById(grace.id))?.squareCustomerId).toBeNull();
      });

      it("AC6: it rolls back with its withActor", async () => {
        const failure = new Error("fn failed after storing the customer");
        await expect(
          repo.withActor({ member: memberId }, async (r) => {
            await r.setMemberSquareCustomer(memberId, "CUSTOMER_1");
            throw failure;
          }),
        ).rejects.toBe(failure);
        expect((await repo.findMemberById(memberId))?.squareCustomerId).toBeNull();
      });
    });

    describe("AC7 — the pending rows", () => {
      it("AC7: with none saved, findPendingSignup is null", async () => {
        const grace = await repo.createMember({ email: "grace@example.com" });
        await saved();
        expect(await repo.findPendingSignup(grace.id, product.id)).toBeNull();
        expect(await pending()).not.toBeNull();
      });

      it("AC7: savePendingSignup creates a pending subscription and a pending ledger row, attempt 1, with no card", async () => {
        const signup = await repo.savePendingSignup(input({ choices: picks(1, 1), firstChargeCents: 8000, weeklyCents: 8000 }));
        expect(signup).toMatchObject({
          subscriptionId: expect.stringMatching(UUID),
          ledgerId: expect.stringMatching(UUID),
          ledgerStatus: "pending",
          attempt: 1,
          squareCardId: null,
          amountCents: 8000,
          weeklyCents: 8000,
          pickupDate: "2027-01-03",
        });
        expect(signup.createdAt).toBeInstanceOf(Date);
        expect(sorted(signup.optionIds)).toEqual(sorted(Object.values(picks(1, 1))));
      });

      it("AC7: findPendingSignup reads back what savePendingSignup returned", async () => {
        const signup = await saved();
        const found = await pending();
        expect({ ...found, optionIds: sorted(found?.optionIds) }).toEqual({ ...signup, optionIds: sorted(signup.optionIds) });
      });

      it("AC7: saveSubscriptionCard stores the card on the row", async () => {
        const signup = await saved();
        await repo.saveSubscriptionCard(signup.subscriptionId, "ccof:card-1");
        expect((await pending())?.squareCardId).toBe("ccof:card-1");
      });

      it("AC7: a save that a withActor rolls back leaves no row", async () => {
        const failure = new Error("fn failed after saving");
        await expect(
          repo.withActor({ member: memberId }, async (r) => {
            expect((await r.savePendingSignup(input())).ledgerId).not.toBe("");
            throw failure;
          }),
        ).rejects.toBe(failure);
        expect(await pending()).toBeNull();
      });

      it("AC7: a save that a withActor commits is there afterwards", async () => {
        await repo.withActor({ member: memberId }, (r) => r.savePendingSignup(input()));
        expect(await pending()).toMatchObject({ ledgerStatus: "pending", attempt: 1 });
      });

      it("AC7: a card that a withActor rolls back is not stored", async () => {
        const signup = await saved();
        const failure = new Error("fn failed after saving the card");
        await expect(
          repo.withActor({ member: memberId }, async (r) => {
            await r.saveSubscriptionCard(signup.subscriptionId, "ccof:card-1");
            throw failure;
          }),
        ).rejects.toBe(failure);
        expect(await pending()).toMatchObject({ subscriptionId: signup.subscriptionId, squareCardId: null });
      });
    });

    describe("AC8 — confirming", () => {
      it('AC8: confirmSignupRows returns "confirmed", then "already"', async () => {
        const signup = await saved();
        expect(await repo.confirmSignupRows(signup.ledgerId, "PAYMENT_1", signup.amountCents, PAID_AT)).toBe("confirmed");
        expect(await repo.confirmSignupRows(signup.ledgerId, "PAYMENT_1", signup.amountCents, PAID_AT)).toBe("already");
      });

      it("AC8: a confirmed signup is active and no longer pending", async () => {
        const signup = await saved();
        await repo.confirmSignupRows(signup.ledgerId, "PAYMENT_1", signup.amountCents, PAID_AT);
        expect(await repo.findActiveSubscription(memberId, product.id)).toEqual({ id: signup.subscriptionId });
        expect(await pending()).toBeNull();
      });

      it("AC8: a confirm that a withActor rolls back leaves the signup pending", async () => {
        const signup = await saved();
        const failure = new Error("fn failed after confirming");
        await expect(
          repo.withActor({ member: memberId }, async (r) => {
            expect(await r.confirmSignupRows(signup.ledgerId, "PAYMENT_1", signup.amountCents, PAID_AT)).toBe("confirmed");
            throw failure;
          }),
        ).rejects.toBe(failure);
        expect(await repo.findActiveSubscription(memberId, product.id)).toBeNull();
        expect(await pending()).toMatchObject({ subscriptionId: signup.subscriptionId, ledgerStatus: "pending" });
      });
    });

    describe("AC5 — findActiveSubscription", () => {
      it("AC5: a pending signup is not active, and a member with none has none", async () => {
        const signup = await saved();
        await repo.confirmSignupRows(signup.ledgerId, "PAYMENT_1", signup.amountCents, PAID_AT);
        const grace = await repo.createMember({ email: "grace@example.com" });
        expect(await repo.findActiveSubscription(memberId, product.id)).toEqual({ id: signup.subscriptionId });
        expect(await repo.findActiveSubscription(grace.id, product.id)).toBeNull();
        await repo.savePendingSignup(input({ memberId: grace.id }));
        expect(await repo.findActiveSubscription(grace.id, product.id)).toBeNull();
      });

      it("AC5: an active subscription to another product does not count", async () => {
        const crate = await addProduct({ ...BOX, name: "Crate" });
        const signup = await saved();
        await repo.confirmSignupRows(signup.ledgerId, "PAYMENT_1", signup.amountCents, PAID_AT);
        expect(await repo.findActiveSubscription(memberId, product.id)).toEqual({ id: signup.subscriptionId });
        expect(await repo.findActiveSubscription(memberId, crate.id)).toBeNull();
      });
    });

    describe("AC9 — a decline, and the next attempt", () => {
      it("AC9: recordSignupDecline moves the ledger row to declined, on attempt 1 still; the subscription stays pending", async () => {
        const signup = await saved();
        await repo.recordSignupDecline(signup.ledgerId);
        expect(await pending()).toMatchObject({ subscriptionId: signup.subscriptionId, ledgerStatus: "declined", attempt: 1 });
        expect(await repo.findActiveSubscription(memberId, product.id)).toBeNull();
      });

      it("AC9: a decline that a withActor rolls back leaves the row pending", async () => {
        const signup = await saved();
        const failure = new Error("fn failed after the decline");
        await expect(
          repo.withActor({ member: memberId }, async (r) => {
            await r.recordSignupDecline(signup.ledgerId);
            throw failure;
          }),
        ).rejects.toBe(failure);
        expect(await pending()).toMatchObject({ ledgerStatus: "pending" });
      });

      it("AC9: a save after a decline is a new attempt on the same rows: back to pending, attempt 2, the card gone", async () => {
        const first = await saved();
        await repo.saveSubscriptionCard(first.subscriptionId, "ccof:card-1");
        await repo.recordSignupDecline(first.ledgerId);
        const second = await saved();
        expect(second).toMatchObject({
          subscriptionId: first.subscriptionId,
          ledgerId: first.ledgerId,
          ledgerStatus: "pending",
          attempt: 2,
          squareCardId: null,
        });
        expect(await pending()).toMatchObject({ ledgerStatus: "pending", attempt: 2, squareCardId: null });
      });

      it("AC9: it rewrites the options, the amounts and the pickup date from the new submit", async () => {
        const first = await saved();
        await repo.recordSignupDecline(first.ledgerId);
        await saved({ choices: picks(1, 1), firstChargeCents: 8000, weeklyCents: 8000, pickupDate: "2027-01-10" });
        const found = await pending();
        expect(found).toMatchObject({ amountCents: 8000, weeklyCents: 8000, pickupDate: "2027-01-10" });
        expect(sorted(found?.optionIds)).toEqual(sorted(Object.values(picks(1, 1))));
      });

      it("AC10: it leaves createdAt alone, the timestamp the payment lookup starts from", async () => {
        const first = await saved();
        await repo.recordSignupDecline(first.ledgerId);
        const second = await saved({ consentAt: PAID_AT });
        expect(second.createdAt).toEqual(first.createdAt);
      });

      it("AC9: a third attempt after a second decline is attempt 3", async () => {
        const first = await saved();
        await repo.recordSignupDecline(first.ledgerId);
        await saved();
        await repo.recordSignupDecline(first.ledgerId);
        expect((await saved()).attempt).toBe(3);
      });
    });

    describe("AC10a — a resubmit after an error", () => {
      it("AC10a: a save over a pending row rewrites it and keeps the attempt", async () => {
        const first = await saved();
        const second = await saved({ choices: picks(1, 0), firstChargeCents: 8000, weeklyCents: 8000 });
        expect(second).toMatchObject({
          subscriptionId: first.subscriptionId,
          ledgerId: first.ledgerId,
          ledgerStatus: "pending",
          attempt: 1,
          amountCents: 8000,
          weeklyCents: 8000,
        });
        expect(sorted(second.optionIds)).toEqual(sorted(Object.values(picks(1, 0))));
      });
    });

    describe("AC13 — findSignupConfirmation", () => {
      it("AC13: it gives the pickup date, the amounts and each picked option's type and name, in the product's order", async () => {
        const signup = await saved({ choices: picks(1, 1), firstChargeCents: 7000, weeklyCents: 8000 });
        await repo.confirmSignupRows(signup.ledgerId, "PAYMENT_1", signup.amountCents, PAID_AT);
        expect(await repo.findSignupConfirmation(memberId, product.id)).toEqual({
          subscriptionId: signup.subscriptionId,
          pickupDate: "2027-01-03",
          firstDay: "2027-01-03",
          lastDay: "2027-01-04",
          firstChargeCents: 7000,
          weeklyCents: 8000,
          chargedDate: "2026-11-06",
          options: [
            { typeName: "How many people?", optionName: "3–4 people" },
            { typeName: "Which menu?", optionName: "Vegan" },
          ],
        });
      });

      it("AC13: a pending signup has no confirmation", async () => {
        const signup = await saved();
        const grace = await repo.createMember({ email: "grace@example.com" });
        await repo.savePendingSignup(input({ memberId: grace.id }));
        await repo.confirmSignupRows(signup.ledgerId, "PAYMENT_1", signup.amountCents, PAID_AT);
        expect(await repo.findSignupConfirmation(memberId, product.id)).not.toBeNull();
        expect(await repo.findSignupConfirmation(grace.id, product.id)).toBeNull();
      });

      it("AC13: a box for another product is not this product's confirmation", async () => {
        const crate = await addProduct({ ...BOX, name: "Crate" });
        const choices = Object.fromEntries(crate.optionTypes.map((type) => [type.id, type.options[0]?.id ?? "no such option"]));
        const signup = await saved({ productId: crate.id, choices });
        await repo.confirmSignupRows(signup.ledgerId, "PAYMENT_1", signup.amountCents, PAID_AT);
        expect(await repo.findSignupConfirmation(memberId, product.id)).toBeNull();
        expect(await repo.findSignupConfirmation(memberId, crate.id)).toMatchObject({ firstChargeCents: 5000 });
      });

      // Issue 101, AC11: the receipt's "Charged {date}" is the day the first charge was paid, on Cleveland's clock.
      it.each([
        ["at 22:30 on November 7 in Cleveland, already November 8 in UTC", "2026-11-08T03:30:00.000Z", "2026-11-07"],
        ["at 23:30 on June 30 in Cleveland, summer time, already July 1 in UTC", "2026-07-01T03:30:00.000Z", "2026-06-30"],
      ])("AC11 (issue 101): chargedDate is the day the first charge was paid, YYYY-MM-DD in Cleveland: paid %s", async (_when, paidAt, chargedDate) => {
        const signup = await saved();
        await repo.confirmSignupRows(signup.ledgerId, "PAYMENT_1", signup.amountCents, new Date(paidAt));
        expect((await repo.findSignupConfirmation(memberId, product.id))?.chargedDate).toBe(chargedDate);
      });
    });

    // Issue 133: the weeks an admin changed. BOX's cutoff is Monday, so each moved first_day here is after the
    // Monday before its week, as pickup_weeks requires (db/pickup-weeks.test.ts).
    describe("issue 133 — pickup weeks", () => {
      const CLOSED_AT = new Date("2026-11-01T12:00:00.000Z");
      const closed = (weekOf: string, note: string | null = "Farm closed"): ChangedWeek => ({
        weekOf,
        closedAt: CLOSED_AT,
        note,
        firstDay: null,
        lastDay: null,
      });
      const moved = (weekOf: string, firstDay: string, lastDay: string): ChangedWeek => ({
        weekOf,
        closedAt: null,
        note: "Moved for the holiday",
        firstDay,
        lastDay,
      });

      const confirmed = async () => {
        const signup = await saved();
        await repo.confirmSignupRows(signup.ledgerId, "PAYMENT_1", signup.amountCents, PAID_AT);
      };

      it("AC1: listChangedWeeks reads back a saved week, whole", async () => {
        await repo.savePickupWeek(product.id, closed("2027-01-03"));
        expect(await repo.listChangedWeeks(product.id, "2027-01-03")).toEqual([closed("2027-01-03")]);
      });

      it("AC1: it gives the product's weeks from the date on, ordered by week, and no other product's", async () => {
        const crate = await addProduct({ ...BOX, name: "Crate" });
        await repo.savePickupWeek(product.id, closed("2027-01-17"));
        await repo.savePickupWeek(product.id, closed("2026-12-27"));
        await repo.savePickupWeek(product.id, moved("2027-01-10", "2027-01-09", "2027-01-10"));
        await repo.savePickupWeek(product.id, closed("2027-01-03", null));
        await repo.savePickupWeek(crate.id, closed("2027-01-24"));
        expect(await repo.listChangedWeeks(product.id, "2027-01-03")).toEqual([
          closed("2027-01-03", null),
          moved("2027-01-10", "2027-01-09", "2027-01-10"),
          closed("2027-01-17"),
        ]);
      });

      it("AC1: a second save of the same week replaces every column: closedAt null reopens it and note null clears it", async () => {
        await repo.savePickupWeek(product.id, closed("2027-01-03"));
        const reopened: ChangedWeek = { weekOf: "2027-01-03", closedAt: null, note: null, firstDay: "2027-01-02", lastDay: "2027-01-03" };
        await repo.savePickupWeek(product.id, reopened);
        expect(await repo.listChangedWeeks(product.id, "2027-01-03")).toEqual([reopened]);
      });

      it("AC4: a week moved after the signup reads with its moved days; pickupDate stays its Sunday", async () => {
        await confirmed();
        await repo.savePickupWeek(product.id, moved("2027-01-03", "2027-01-02", "2027-01-03"));
        expect(await repo.findSignupConfirmation(memberId, product.id)).toMatchObject({
          pickupDate: "2027-01-03",
          firstDay: "2027-01-02",
          lastDay: "2027-01-03",
        });
      });

      it("AC4: another product's change to the same week does not move this product's", async () => {
        const crate = await addProduct({ ...BOX, name: "Crate" });
        await confirmed();
        await repo.savePickupWeek(crate.id, moved("2027-01-03", "2027-01-02", "2027-01-02"));
        expect(await repo.findSignupConfirmation(memberId, product.id)).toMatchObject({ firstDay: "2027-01-03", lastDay: "2027-01-04" });
      });
    });

    describe("AC11 — a row freezes when its card is bound", () => {
      /** A save, however an adapter refuses it: these hold what is stored afterwards. */
      const refused = (over: Partial<PendingSignupInput> = {}) => repo.savePendingSignup(input(over)).catch(() => null);

      it("AC11: a save after the signup is confirmed makes no second row: nothing is pending and the one subscription stays active", async () => {
        const signup = await saved();
        await repo.confirmSignupRows(signup.ledgerId, "PAYMENT_1", signup.amountCents, PAID_AT);
        await refused({ choices: picks(1, 0), firstChargeCents: 8000, weeklyCents: 8000 });
        expect(await pending()).toBeNull();
        expect(await repo.findActiveSubscription(memberId, product.id)).toEqual({ id: signup.subscriptionId });
      });

      it("AC11: a save over a pending row with a card rewrites nothing", async () => {
        const first = await saved();
        await repo.saveSubscriptionCard(first.subscriptionId, "ccof:card-1");
        await refused({ choices: picks(1, 1), firstChargeCents: 8000, weeklyCents: 8000, pickupDate: "2027-01-10" });
        const found = await pending();
        expect(found).toMatchObject({
          subscriptionId: first.subscriptionId,
          ledgerId: first.ledgerId,
          attempt: 1,
          squareCardId: "ccof:card-1",
          amountCents: 5000,
          weeklyCents: 5000,
          pickupDate: "2027-01-03",
        });
        expect(sorted(found?.optionIds)).toEqual(sorted(Object.values(picks(0, 0))));
      });

      it("AC11: saveSubscriptionCard returns the amount and the attempt of the row it bound", async () => {
        const signup = await saved({ firstChargeCents: 8000, weeklyCents: 8000 });
        expect(await repo.saveSubscriptionCard(signup.subscriptionId, "ccof:card-1")).toMatchObject({ amountCents: 8000, attempt: 1 });
      });

      it("AC11: after a decline's rewrite it returns the rewritten amount and the new attempt", async () => {
        const first = await saved();
        await repo.saveSubscriptionCard(first.subscriptionId, "ccof:card-1");
        await repo.recordSignupDecline(first.ledgerId);
        await saved({ firstChargeCents: 8000, weeklyCents: 8000 });
        expect(await repo.saveSubscriptionCard(first.subscriptionId, "ccof:card-2")).toMatchObject({ amountCents: 8000, attempt: 2 });
      });

      it("AC11: a second card does not bind: the first stays, and the loser gets no amount to charge", async () => {
        const signup = await saved();
        await repo.saveSubscriptionCard(signup.subscriptionId, "ccof:card-1");
        const lost = await repo.saveSubscriptionCard(signup.subscriptionId, "ccof:card-2");
        expect((await pending())?.squareCardId).toBe("ccof:card-1");
        expect(lost ?? null).toBeNull();
      });

      it('AC11: confirmSignupRows with an amount that is not the ledger\'s returns "mismatch" and leaves the row pending', async () => {
        const signup = await saved({ firstChargeCents: 8000, weeklyCents: 8000 });
        expect(await repo.confirmSignupRows(signup.ledgerId, "PAYMENT_1", 7000, PAID_AT)).toBe("mismatch");
        expect(await pending()).toMatchObject({ subscriptionId: signup.subscriptionId, ledgerStatus: "pending", amountCents: 8000 });
        expect(await repo.findActiveSubscription(memberId, product.id)).toBeNull();
      });
    });

    // Issue 57: the cap, on a product of its own so that `BOX` stays at 50 for everything above.
    describe("issue 57 — the cap", () => {
      let others = 0;

      const capped = (cap: number) => addProduct({ ...BOX, name: "Capped", cap });

      const choicesOf = (on: ProductWithOptions) => Object.fromEntries(on.optionTypes.map((type) => [type.id, type.options[0]?.id ?? "no such option"]));

      /** The member's pending rows on `on`, with no card: Ada's, or a new member's. */
      const rowsOn = async (on: ProductWithOptions, who?: string): Promise<PendingSignup> =>
        saved({ memberId: who ?? (await repo.createMember({ email: `other-${++others}@example.com` })).id, productId: on.id, choices: choicesOf(on) });

      /** A new member with a card on a pending row and the charge unanswered. */
      const boundOn = async (on: ProductWithOptions): Promise<PendingSignup> => {
        const signup = await rowsOn(on);
        await repo.saveSubscriptionCard(signup.subscriptionId, `ccof:${signup.subscriptionId}`);
        return signup;
      };

      /** A new member with an active subscription. */
      const activeOn = async (on: ProductWithOptions): Promise<PendingSignup> => {
        const signup = await rowsOn(on);
        await repo.confirmSignupRows(signup.ledgerId, `PAYMENT_${signup.ledgerId}`, signup.amountCents, PAID_AT);
        return signup;
      };

      const adaOn = (on: ProductWithOptions) => repo.findPendingSignup(memberId, on.id);

      describe("AC1 — countHeldSpots", () => {
        it("AC1 (issue 57): an active subscription holds a spot", async () => {
          await activeOn(product);
          expect(await repo.countHeldSpots(product.id)).toBe(1);
        });

        it("AC1 (issue 57): a pending row with a card on it and its ledger row pending holds a spot", async () => {
          await boundOn(product);
          expect(await repo.countHeldSpots(product.id)).toBe(1);
        });

        it("AC1 (issue 57): a pending row with no card holds none, which guards the two above", async () => {
          await rowsOn(product);
          expect(await repo.countHeldSpots(product.id)).toBe(0);
        });

        it("AC1 (issue 57): a row whose ledger row is declined holds none, with its card on it or not, which guards the two above", async () => {
          const carded = await boundOn(product);
          await repo.recordSignupDecline(carded.ledgerId);
          const cardless = await rowsOn(product);
          await repo.recordSignupDecline(cardless.ledgerId);
          expect(await repo.countHeldSpots(product.id)).toBe(0);
        });

        it("AC1 (issue 57): with one of each only the active row and the bound row count", async () => {
          await activeOn(product);
          await boundOn(product);
          await rowsOn(product);
          const declined = await boundOn(product);
          await repo.recordSignupDecline(declined.ledgerId);
          expect(await repo.countHeldSpots(product.id)).toBe(2);
        });

        it("AC1 (issue 57): a spot held on another product does not count here", async () => {
          const crate = await capped(50);
          await activeOn(product);
          await activeOn(crate);
          await boundOn(crate);
          expect(await repo.countHeldSpots(product.id)).toBe(1);
          expect(await repo.countHeldSpots(crate.id)).toBe(2);
        });
      });

      describe("AC7 — the bind refuses at the cap", () => {
        it('AC7 (issue 57): with the cap held, saveSubscriptionCard returns "sold_out" and the row stays cardless and pending', async () => {
          const club = await capped(1);
          await boundOn(club);
          const mine = await rowsOn(club, memberId);
          expect(await repo.saveSubscriptionCard(mine.subscriptionId, "ccof:card-1")).toBe("sold_out");
          expect(await adaOn(club)).toMatchObject({ subscriptionId: mine.subscriptionId, ledgerStatus: "pending", attempt: 1, squareCardId: null });
          expect(await repo.countHeldSpots(club.id)).toBe(1);
        });

        it('AC7 (issue 57): an active subscription fills the cap as a held row does: "sold_out"', async () => {
          const club = await capped(1);
          await activeOn(club);
          const mine = await rowsOn(club, memberId);
          expect(await repo.saveSubscriptionCard(mine.subscriptionId, "ccof:card-1")).toBe("sold_out");
        });

        it('AC7 (issue 57): the last spot binds with its amount and attempt, and the next is "sold_out"', async () => {
          const club = await capped(2);
          await boundOn(club);
          const mine = await rowsOn(club, memberId);
          const last = await rowsOn(club);
          expect(await repo.saveSubscriptionCard(mine.subscriptionId, "ccof:card-1")).toMatchObject({ amountCents: 5000, attempt: 1 });
          expect(await repo.saveSubscriptionCard(last.subscriptionId, "ccof:card-2")).toBe("sold_out");
        });

        it("AC7 (issue 57): a rival's cardless pending row fills nothing, so the bind goes through, which guards the refusals above", async () => {
          const club = await capped(1);
          await rowsOn(club);
          const mine = await rowsOn(club, memberId);
          expect(await repo.saveSubscriptionCard(mine.subscriptionId, "ccof:card-1")).toMatchObject({ amountCents: 5000, attempt: 1 });
        });
      });

      // What the row is outranks the cap: a member's own card must never read as the Supper Club selling out.
      describe("AC7 — the row's own state outranks the cap", () => {
        it('AC7 (issue 57): a row with a card on it returns null at the cap, not "sold_out", and keeps its card', async () => {
          const club = await capped(1);
          const mine = await rowsOn(club, memberId);
          await repo.saveSubscriptionCard(mine.subscriptionId, "ccof:card-1");
          expect((await repo.saveSubscriptionCard(mine.subscriptionId, "ccof:card-2")) ?? null).toBeNull();
          expect((await adaOn(club))?.squareCardId).toBe("ccof:card-1");
        });

        it('AC7 (issue 57): a row no longer pending returns null at the cap, not "sold_out"', async () => {
          const club = await capped(1);
          const mine = await rowsOn(club, memberId);
          await repo.confirmSignupRows(mine.ledgerId, "PAYMENT_1", mine.amountCents, PAID_AT);
          expect((await repo.saveSubscriptionCard(mine.subscriptionId, "ccof:late")) ?? null).toBeNull();
        });

        it("AC7 (issue 57): a bind refuses a cardless row whose ledger row is declined: null, and the row stays cardless", async () => {
          const mine = await saved();
          await repo.recordSignupDecline(mine.ledgerId);
          expect((await repo.saveSubscriptionCard(mine.subscriptionId, "ccof:card-1")) ?? null).toBeNull();
          expect(await pending()).toMatchObject({ ledgerStatus: "declined", squareCardId: null });
        });

        it('AC7 (issue 57): at the cap that row still returns null, not "sold_out"', async () => {
          const club = await capped(1);
          await boundOn(club);
          const mine = await rowsOn(club, memberId);
          await repo.recordSignupDecline(mine.ledgerId);
          expect((await repo.saveSubscriptionCard(mine.subscriptionId, "ccof:card-1")) ?? null).toBeNull();
          expect(await adaOn(club)).toMatchObject({ ledgerStatus: "declined", squareCardId: null });
        });
      });

      describe("AC11, AC12 — a decline releases the spot", () => {
        it("AC11 (issue 57): the decline alone takes the count down, and another member can then bind", async () => {
          const club = await capped(1);
          const holder = await boundOn(club);
          const mine = await rowsOn(club, memberId);
          expect(await repo.saveSubscriptionCard(mine.subscriptionId, "ccof:card-1")).toBe("sold_out");
          expect(await repo.countHeldSpots(club.id)).toBe(1);

          await repo.recordSignupDecline(holder.ledgerId);

          expect(await repo.countHeldSpots(club.id)).toBe(0);
          expect(await repo.saveSubscriptionCard(mine.subscriptionId, "ccof:card-1")).toMatchObject({ amountCents: 5000, attempt: 1 });
          expect(await repo.countHeldSpots(club.id)).toBe(1);
        });

        it('AC12 (issue 57): a declined row rewritten for its next attempt meets the cap at the bind: "sold_out", on attempt 2, cardless', async () => {
          const club = await capped(1);
          const mine = await rowsOn(club, memberId);
          await repo.saveSubscriptionCard(mine.subscriptionId, "ccof:card-1");
          await repo.recordSignupDecline(mine.ledgerId);
          await boundOn(club);
          await rowsOn(club, memberId);
          expect(await repo.saveSubscriptionCard(mine.subscriptionId, "ccof:card-2")).toBe("sold_out");
          expect(await adaOn(club)).toMatchObject({ ledgerStatus: "pending", attempt: 2, squareCardId: null });
        });
      });

      describe("AC14 — a confirm has no cap check", () => {
        it("AC14 (issue 57): rows confirmed past the cap all confirm, and all hold a spot", async () => {
          const club = await capped(1);
          const first = await rowsOn(club);
          const second = await rowsOn(club);
          expect(await repo.confirmSignupRows(first.ledgerId, "PAYMENT_1", first.amountCents, PAID_AT)).toBe("confirmed");
          expect(await repo.confirmSignupRows(second.ledgerId, "PAYMENT_2", second.amountCents, PAID_AT)).toBe("confirmed");
          expect(await repo.countHeldSpots(club.id)).toBe(2);
        });
      });
    });

    // Issue 59: the admin's list. Several paid rows on a subscription, and a member's two rows, are Postgres
    // only (src/adapters/postgres-repository.test.ts): the in-memory adapter cannot hold either.
    describe("issue 59 — listSubscribers", () => {
      const ADA: AccountDetails = { email: "ada@example.com", firstName: "Ada", lastName: "Lovelace", phone: "216-555-0100", language: "en" };

      /** A member's rows on `on`, paid at `paidAt`. */
      const activeOn = async (on: ProductWithOptions, who: string, paidAt = PAID_AT): Promise<PendingSignup> => {
        const choices = Object.fromEntries(on.optionTypes.map((type) => [type.id, type.options[0]?.id ?? "no such option"]));
        const signup = await saved({ memberId: who, productId: on.id, choices });
        await repo.confirmSignupRows(signup.ledgerId, `PAYMENT_${signup.ledgerId}`, signup.amountCents, paidAt);
        return signup;
      };

      const newMember = async (email: string): Promise<string> => (await repo.createMember({ email })).id;

      it("AC3: an active subscription comes back with its member, its options and the date it was paid", async () => {
        await repo.saveAccount(ADA);
        const signup = await saved({ choices: picks(1, 1) });
        await repo.confirmSignupRows(signup.ledgerId, "PAYMENT_1", signup.amountCents, PAID_AT);

        expect(await repo.listSubscribers(product.id)).toEqual([
          {
            subscriptionId: signup.subscriptionId,
            firstName: "Ada",
            lastName: "Lovelace",
            email: "ada@example.com",
            phone: "216-555-0100",
            options: [
              { typeName: "How many people?", optionName: "3–4 people" },
              { typeName: "Which menu?", optionName: "Vegan" },
            ],
            joinedDate: "2026-11-06",
          },
        ]);
      });

      it("AC3: a member with no details reads as nulls, and is listed however their email stands", async () => {
        await activeOn(product, memberId);
        expect(await repo.listSubscribers(product.id)).toEqual([
          expect.objectContaining({ firstName: null, lastName: null, phone: null, email: "ada@example.com" }),
        ]);
      });

      it("AC3: pending rows are left out: with no card, with a card and with a decline", async () => {
        const held = await activeOn(product, memberId);
        await saved({ memberId: await newMember("cardless@example.com") });
        const carded = await saved({ memberId: await newMember("carded@example.com") });
        await repo.saveSubscriptionCard(carded.subscriptionId, "ccof:card-1");
        const declined = await saved({ memberId: await newMember("declined@example.com") });
        await repo.recordSignupDecline(declined.ledgerId);

        expect((await repo.listSubscribers(product.id)).map((row) => row.subscriptionId)).toEqual([held.subscriptionId]);
      });

      it("AC3: another product's subscriptions are left out", async () => {
        const crate = await addProduct({ ...BOX, name: "Crate" });
        const held = await activeOn(product, memberId);
        await activeOn(crate, await newMember("grace@example.com"));

        expect((await repo.listSubscribers(product.id)).map((row) => row.subscriptionId)).toEqual([held.subscriptionId]);
      });

      it("AC3: options are in option-type position order, not by name", async () => {
        const [sizes, menus] = BOX.optionTypes;
        if (!sizes || !menus) throw new Error("BOX has two option types");
        const reversed = await addProduct({ ...BOX, name: "Reversed", optionTypes: [{ ...menus, position: 1 }, { ...sizes, position: 2 }] });
        await activeOn(reversed, memberId);

        const [row] = await repo.listSubscribers(reversed.id);

        expect(row?.options.map((option) => option.typeName)).toEqual(["Which menu?", "How many people?"]);
      });

      it("AC3: two reads give the rows in the same order", async () => {
        await activeOn(product, memberId);
        await activeOn(product, await newMember("grace@example.com"));
        await activeOn(product, await newMember("linh@example.com"));

        const first = await repo.listSubscribers(product.id);

        expect(first).toHaveLength(3);
        expect(await repo.listSubscribers(product.id)).toEqual(first);
      });

      it.each([
        ["an evening in winter, already tomorrow in UTC", "2026-12-02T03:30:00.000Z", "2026-12-01"],
        ["just after midnight in winter", "2026-12-02T05:30:00.000Z", "2026-12-02"],
        ["an evening in summer, already tomorrow in UTC", "2026-07-02T03:30:00.000Z", "2026-07-01"],
      ])("AC11: a payment on %s is joined on Cleveland's date", async (_what, paidAt, joined) => {
        await activeOn(product, memberId, new Date(paidAt));
        expect((await repo.listSubscribers(product.id))[0]?.joinedDate).toBe(joined);
      });
    });
  });
}

type LedgerStatus = PendingSignup["ledgerStatus"];

export function runWeekCreditContract(
  name: string,
  make: () => Promise<Repository>,
  addProduct: (input: ProductInput) => Promise<ProductWithOptions>,
  addLedgerRow: (subscriptionId: string, pickupDate: string, status: LedgerStatus, amountCents: number) => Promise<void>,
  setSubscriptionOptions: (subscriptionId: string, optionIds: string[]) => Promise<void>,
  spendWeekCredit: (weekCreditId: string, ledgerId: string) => Promise<void>,
  reset?: () => Promise<void>,
): void {
  // Issue 149. The weeks are BOX's: January 24's cutoff is the end of Monday the 18th. The repository checks no
  // cutoff (the core does), so the times here are only what each call is given.
  describe(`Week credit repository contract — ${name}`, () => {
    const WEEK = "2027-01-24";
    const NEXT = "2027-01-31";
    const EARLIER = "2027-01-17";
    const PAID_AT = new Date("2027-01-05T15:00:00.000Z");
    const CLOSED_AT = new Date("2027-01-12T15:00:00.000Z");
    const LATER = new Date("2027-01-13T15:00:00.000Z");

    let repo: Repository;
    let product: ProductWithOptions;
    let members = 0;

    beforeEach(async () => {
      if (reset) await reset();
      repo = await make();
      product = await addProduct(BOX);
    });

    /** The option ids at `size` and `menu` of `on`. */
    const picks = (size: number, menu: number, on: ProductWithOptions = product): string[] => {
      const [sizes, menus] = on.optionTypes;
      return [sizes?.options[size]?.id ?? "no such size", menus?.options[menu]?.id ?? "no such menu"];
    };

    const choicesOf = (ids: string[], on: ProductWithOptions = product): Record<string, string> =>
      Object.fromEntries(on.optionTypes.map((type, i) => [type.id, ids[i] ?? "no such option"]));

    const sorted = (ids: readonly string[] | undefined) => [...(ids ?? [])].sort();

    /** A new member's pending rows for `week`, picking `ids`. */
    const pendingFor = async (week: string, ids: string[] = picks(0, 0), on: ProductWithOptions = product): Promise<PendingSignup> => {
      const memberId = (await repo.createMember({ email: `member-${++members}@example.com` })).id;
      const signup = await repo.savePendingSignup({
        memberId,
        productId: on.id,
        choices: choicesOf(ids, on),
        firstChargeCents: 5000,
        weeklyCents: 5000,
        pickupDate: week,
        consentText: "I agree to a weekly charge of $50.",
        consentAt: PAID_AT,
      });
      expect(signup.ledgerId).not.toBe("");
      return signup;
    };

    const confirm = (signup: PendingSignup, at: Date = PAID_AT) =>
      repo.confirmSignupRows(signup.ledgerId, `PAYMENT_${signup.ledgerId}`, signup.amountCents, at);

    /** A new member's signup for `week`, charged at signup: an active subscription with a paid row for the week. */
    const paidFor = async (week: string, ids?: string[], on?: ProductWithOptions): Promise<PendingSignup> => {
      const signup = await pendingFor(week, ids, on);
      expect(await confirm(signup)).toBe("confirmed");
      return signup;
    };

    const close = (week: string, note: string | null = "Kitchen flooded", at: Date = CLOSED_AT) => repo.closePickupWeek(product.id, week, note, at);

    const credits = async (week: string = WEEK) =>
      [...(await repo.listWeekCredits(product.id, week))].sort((a, b) => a.subscriptionId.localeCompare(b.subscriptionId));

    const changedWeek = async (week: string = WEEK): Promise<ChangedWeek | null> =>
      (await repo.listChangedWeeks(product.id, week)).find((changed) => changed.weekOf === week) ?? null;

    describe("AC2 — closing a week", () => {
      it("AC2: closePickupWeek closes the week at the time given, with its note", async () => {
        await close(WEEK, "Kitchen flooded");
        expect(await changedWeek()).toEqual({ weekOf: WEEK, closedAt: CLOSED_AT, note: "Kitchen flooded", firstDay: null, lastDay: null });
      });

      it("AC2: closed with no note, its note is null", async () => {
        await close(WEEK, null);
        expect(await changedWeek()).toEqual({ weekOf: WEEK, closedAt: CLOSED_AT, note: null, firstDay: null, lastDay: null });
      });

      it("AC7: closing a moved week keeps its days", async () => {
        await repo.savePickupWeek(product.id, { weekOf: WEEK, closedAt: null, note: null, firstDay: "2027-01-23", lastDay: "2027-01-24" });
        await close(WEEK, "Kitchen flooded");
        expect(await changedWeek()).toEqual({ weekOf: WEEK, closedAt: CLOSED_AT, note: "Kitchen flooded", firstDay: "2027-01-23", lastDay: "2027-01-24" });
      });
    });

    describe("AC3 — the week credits closing grants", () => {
      it("AC3: each subscription with a paid row for the week gets one week credit for that row, granted at the closing time and unspent", async () => {
        const ada = await paidFor(WEEK);
        const grace = await paidFor(WEEK);
        await close(WEEK);
        const expected = [ada, grace]
          .map((signup) => ({
            id: expect.stringMatching(UUID),
            subscriptionId: signup.subscriptionId,
            grantedFor: signup.ledgerId,
            spentOn: null,
            grantedAt: CLOSED_AT,
            optionIds: expect.any(Array),
          }))
          .sort((a, b) => a.subscriptionId.localeCompare(b.subscriptionId));
        expect(await credits()).toEqual(expected);
      });

      it("AC3: a paid row the charge run wrote, on a subscription that started earlier, gets one too", async () => {
        const signup = await paidFor(EARLIER);
        await addLedgerRow(signup.subscriptionId, WEEK, "paid", 5000);
        await close(WEEK);
        const found = await credits();
        expect(found.map((credit) => credit.subscriptionId)).toEqual([signup.subscriptionId]);
        expect(found[0]?.grantedFor).toMatch(UUID);
        expect(found[0]?.grantedFor).not.toBe(signup.ledgerId);
      });

      it("AC3: a pending row and a declined row get none, at signup or from the run: only the paid row does", async () => {
        const paid = await paidFor(WEEK);
        await pendingFor(WEEK);
        const declined = await pendingFor(WEEK);
        await repo.recordSignupDecline(declined.ledgerId);
        const runPending = await paidFor(EARLIER);
        await addLedgerRow(runPending.subscriptionId, WEEK, "pending", 5000);
        const runDeclined = await paidFor(EARLIER);
        await addLedgerRow(runDeclined.subscriptionId, WEEK, "declined", 5000);
        await close(WEEK);
        expect((await credits()).map((credit) => credit.subscriptionId)).toEqual([paid.subscriptionId]);
      });

      it("AC3: another week's paid row and another product's paid row for the same week get none", async () => {
        const crate = await addProduct({ ...BOX, name: "Crate" });
        const paid = await paidFor(WEEK);
        await paidFor(EARLIER);
        await paidFor(WEEK, picks(0, 0, crate), crate);
        await close(WEEK);
        expect((await credits()).map((credit) => credit.subscriptionId)).toEqual([paid.subscriptionId]);
        expect(await repo.listWeekCredits(crate.id, WEEK)).toEqual([]);
      });

      it("AC3: a close that its withActor rolls back leaves the week open and grants nothing", async () => {
        await paidFor(WEEK);
        const failure = new Error("fn failed after closing");
        await expect(
          repo.withActor(null, async (r) => {
            await r.closePickupWeek(product.id, WEEK, "Kitchen flooded", CLOSED_AT);
            throw failure;
          }),
        ).rejects.toBe(failure);
        expect(await changedWeek()).toBeNull();
        expect(await credits()).toEqual([]);
      });
    });

    describe("AC4 — a week credit holds the picks that were charged", () => {
      it("AC4: a week credit holds the subscription's full set of picks", async () => {
        await paidFor(WEEK, picks(1, 1));
        await close(WEEK);
        expect((await credits()).map((credit) => sorted(credit.optionIds))).toEqual([sorted(picks(1, 1))]);
      });

      it("AC4: the picks are the subscription's at the grant: changed before the closing, the week credit holds the new ones", async () => {
        const signup = await paidFor(WEEK, picks(0, 0));
        await setSubscriptionOptions(signup.subscriptionId, picks(1, 0));
        await close(WEEK);
        expect((await credits()).map((credit) => sorted(credit.optionIds))).toEqual([sorted(picks(1, 0))]);
      });

      it("AC4: changing the subscription's picks after the grant does not change the week credit", async () => {
        const signup = await paidFor(WEEK, picks(1, 1));
        await close(WEEK);
        await setSubscriptionOptions(signup.subscriptionId, picks(0, 0));
        expect((await credits()).map((credit) => sorted(credit.optionIds))).toEqual([sorted(picks(1, 1))]);
      });
    });

    describe("AC5 — a week closed twice", () => {
      it("AC5: a second close grants no second week credit, and the first closing time is kept", async () => {
        const signup = await paidFor(WEEK);
        await close(WEEK, "Kitchen flooded", CLOSED_AT);
        await close(WEEK, "Kitchen flooded", LATER);
        expect(await credits()).toEqual([expect.objectContaining({ subscriptionId: signup.subscriptionId, grantedAt: CLOSED_AT })]);
        expect((await changedWeek())?.closedAt).toEqual(CLOSED_AT);
      });
    });

    describe("AC7 — reopening a week", () => {
      it("AC7: a reopened week with no move is ordinary again, no row, and the week credits its closing granted are gone", async () => {
        await paidFor(WEEK);
        await close(WEEK, "Kitchen flooded");
        expect(await credits()).toHaveLength(1);
        await repo.reopenPickupWeek(product.id, WEEK);
        expect(await changedWeek()).toBeNull();
        expect(await credits()).toEqual([]);
      });

      it("AC7: a move on the week stays: open again, the note cleared, the days kept", async () => {
        await repo.savePickupWeek(product.id, { weekOf: WEEK, closedAt: null, note: null, firstDay: "2027-01-23", lastDay: "2027-01-24" });
        await close(WEEK, "Kitchen flooded");
        expect((await changedWeek())?.closedAt).toEqual(CLOSED_AT);
        await repo.reopenPickupWeek(product.id, WEEK);
        expect(await changedWeek()).toEqual({ weekOf: WEEK, closedAt: null, note: null, firstDay: "2027-01-23", lastDay: "2027-01-24" });
      });

      it("AC7: it withdraws that week's week credits and no other week's", async () => {
        await paidFor(WEEK);
        const next = await paidFor(NEXT);
        await close(WEEK);
        await close(NEXT);
        expect(await credits(NEXT)).toHaveLength(1);
        await repo.reopenPickupWeek(product.id, WEEK);
        expect(await credits(WEEK)).toEqual([]);
        expect((await credits(NEXT)).map((credit) => credit.subscriptionId)).toEqual([next.subscriptionId]);
      });

      it("AC7, AC5: a week reopened and closed again grants its week credits again, once, at the new closing", async () => {
        await paidFor(WEEK);
        await close(WEEK, "Kitchen flooded", CLOSED_AT);
        await repo.reopenPickupWeek(product.id, WEEK);
        await close(WEEK, null, LATER);
        expect(await credits()).toEqual([expect.objectContaining({ grantedAt: LATER })]);
      });
    });

    describe("AC10 — no row is an ordinary week", () => {
      it("AC10: savePickupWeek with no close, no move and no note leaves the week with no row", async () => {
        await repo.savePickupWeek(product.id, { weekOf: WEEK, closedAt: null, note: null, firstDay: "2027-01-23", lastDay: "2027-01-24" });
        await repo.savePickupWeek(product.id, { weekOf: WEEK, closedAt: null, note: null, firstDay: null, lastDay: null });
        expect(await repo.listChangedWeeks(product.id, EARLIER)).toEqual([]);
      });

      it("AC10: a week left with only its note keeps its row, which guards the delete above", async () => {
        const noted: ChangedWeek = { weekOf: WEEK, closedAt: null, note: "Heads up", firstDay: null, lastDay: null };
        await repo.savePickupWeek(product.id, { ...noted, firstDay: "2027-01-23", lastDay: "2027-01-24" });
        await repo.savePickupWeek(product.id, noted);
        expect(await repo.listChangedWeeks(product.id, EARLIER)).toEqual([noted]);
      });
    });

    describe("AC12 — a signup confirmed paid after its week closed", () => {
      it("AC12: a signup pending when its week closes gets its week credit when it confirms paid, granted at the confirmation's time", async () => {
        const signup = await pendingFor(WEEK, picks(1, 1));
        await close(WEEK);
        expect(await credits()).toEqual([]);
        expect(await confirm(signup, LATER)).toBe("confirmed");
        const found = await credits();
        expect(found).toEqual([
          { id: expect.stringMatching(UUID), subscriptionId: signup.subscriptionId, grantedFor: signup.ledgerId, spentOn: null, grantedAt: LATER, optionIds: expect.any(Array) },
        ]);
        expect(sorted(found[0]?.optionIds)).toEqual(sorted(picks(1, 1)));
      });

      it("AC12: a confirmation for an open week grants nothing, though another week is closed", async () => {
        const signup = await pendingFor(WEEK);
        await close(NEXT);
        expect(await confirm(signup, LATER)).toBe("confirmed");
        expect(await credits(WEEK)).toEqual([]);
        expect(await credits(NEXT)).toEqual([]);
      });

      it('AC12, AC5: a replayed confirmation ("already") grants no second week credit', async () => {
        const signup = await pendingFor(WEEK);
        await close(WEEK);
        await confirm(signup, LATER);
        expect(await confirm(signup, LATER)).toBe("already");
        expect(await credits()).toHaveLength(1);
      });
    });

    describe("AC14 — listWeekCounts", () => {
      it("AC14: per week from the date on, the paid rows, from signup and from the run, and the week credits granted", async () => {
        await paidFor(WEEK);
        const runRow = await paidFor(EARLIER);
        await addLedgerRow(runRow.subscriptionId, WEEK, "paid", 5000);
        await pendingFor(WEEK);
        await paidFor(NEXT);
        await close(WEEK);
        const counts = await repo.listWeekCounts(product.id, WEEK);
        expect(counts.get(WEEK)).toEqual({ paid: 2, weekCredits: 2 });
        expect(counts.get(NEXT)).toEqual({ paid: 1, weekCredits: 0 });
        expect(counts.has(EARLIER)).toBe(false);
      });

      it("AC14: another product's rows are not counted", async () => {
        const crate = await addProduct({ ...BOX, name: "Crate" });
        await paidFor(WEEK);
        await paidFor(WEEK, picks(0, 0, crate), crate);
        expect((await repo.listWeekCounts(product.id, WEEK)).get(WEEK)).toEqual({ paid: 1, weekCredits: 0 });
      });
    });

    // Issue 155: what a member's account pages read of one subscription. Neither list's order is part of the
    // contract, so each is sorted here.
    describe("issue 155 — listMemberWeeks", () => {
      const weeksOf = async (subscriptionId: string) => {
        const found = await repo.listMemberWeeks(subscriptionId);
        return {
          paid: [...found.paid].sort((a, b) => a.weekOf.localeCompare(b.weekOf)),
          weekCredits: [...found.weekCredits].sort((a, b) => a.grantedForWeek.localeCompare(b.grantedForWeek)),
        };
      };

      it("AC3 (issue 155): the subscription's paid rows, from signup and from the charge run, each with its week and the amount charged", async () => {
        const signup = await paidFor(EARLIER);
        await addLedgerRow(signup.subscriptionId, WEEK, "paid", 4200);
        expect((await weeksOf(signup.subscriptionId)).paid).toEqual([
          { weekOf: EARLIER, amountCents: 5000 },
          { weekOf: WEEK, amountCents: 4200 },
        ]);
      });

      it("AC3 (issue 155): a pending row and a declined row are not paid rows, and another subscription's paid row is not this one's", async () => {
        const signup = await paidFor(EARLIER);
        await addLedgerRow(signup.subscriptionId, WEEK, "pending", 5000);
        await addLedgerRow(signup.subscriptionId, NEXT, "declined", 5000);
        await paidFor(WEEK);
        expect((await weeksOf(signup.subscriptionId)).paid).toEqual([{ weekOf: EARLIER, amountCents: 5000 }]);
      });

      it("AC5 (issue 155): its unspent week credits, each with the week of the paid row it was granted for; another subscription's are not its", async () => {
        const signup = await paidFor(EARLIER);
        await addLedgerRow(signup.subscriptionId, WEEK, "paid", 5000);
        await paidFor(WEEK);
        await close(EARLIER);
        await close(WEEK);
        expect((await weeksOf(signup.subscriptionId)).weekCredits).toEqual([{ grantedForWeek: EARLIER }, { grantedForWeek: WEEK }]);
      });

      it("AC5 (issue 155): a week credit the charge run spent is left out", async () => {
        const signup = await paidFor(WEEK);
        await close(WEEK);
        const [spent] = await credits(WEEK);
        // NEXT's paid row, the charge the week credit is spent on. Its id is read from the week credit closing NEXT
        // grants for it: the contract shows a run row's id nowhere else.
        await addLedgerRow(signup.subscriptionId, NEXT, "paid", 5000);
        await close(NEXT);
        const [nextCredit] = await credits(NEXT);
        if (!spent || !nextCredit) throw new Error("closing WEEK and NEXT granted no week credit to spend");
        await spendWeekCredit(spent.id, nextCredit.grantedFor);
        expect((await weeksOf(signup.subscriptionId)).weekCredits).toEqual([{ grantedForWeek: NEXT }]);
      });

      it("AC3 (issue 155): an unknown id and a string that isn't a UUID give nothing", async () => {
        await paidFor(WEEK);
        for (const id of ["00000000-0000-4000-8000-000000000000", "not-a-uuid"]) {
          expect(await repo.listMemberWeeks(id)).toEqual({ paid: [], weekCredits: [] });
        }
      });
    });
  });
}
