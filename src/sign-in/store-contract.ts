/**
 * The sign-in store contract (issue 9, AC16–AC19; issue 22, AC2, AC3 and AC14). One behavioural suite, run against
 * `MemorySignInStore` and against haul's two Repository adapters: if all three pass it, the
 * memory store the code-flow tests lean on behaves as the real ones do (DEC-010).
 *
 * Not a test file itself, as `repository-contract.ts` isn't: it registers describe/it blocks, and
 * each store's test file calls it. It travels with `src/sign-in/`, so it imports nothing but
 * vitest and the folder's own files (AC39). `reset`, when given, runs before every test and
 * before `make`. `makeSubject` creates a subject and returns its id.
 *
 * The concurrency cases are Postgres only and live in `src/adapters/postgres-repository.test.ts`.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { RateLimitStore, SignInStore } from "./store.js";

type Store = SignInStore & RateLimitStore;

const T0 = new Date("2026-10-28T14:00:00.000Z");
const SECOND = 1000;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const at = (ms: number): Date => new Date(T0.getTime() + ms);

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const WRONG = "f".repeat(64);
const LINK_A = "c".repeat(64);
const LINK_B = "d".repeat(64);
const NO_LINK = { linkHash: null, linkCreatedAt: null, linkExpiresAt: null };

/** A claim with roomy caps, overridden per case. */
const claim = (
  presentedHash: string,
  now: Date,
  over: Partial<{ maxAttempts: number; windowMs: number; maxFailures: number }> = {},
) => ({ presentedHash, now, maxAttempts: 5, windowMs: DAY, maxFailures: 50, ...over });

export function runSignInStoreContract(
  name: string,
  make: () => Promise<{ store: Store; makeSubject: (email: string) => Promise<string> }>,
  reset?: () => Promise<void>,
): void {
  describe(`Sign-in store contract — ${name}`, () => {
    let store: Store;
    let makeSubject: (email: string) => Promise<string>;

    beforeEach(async () => {
      if (reset) await reset();
      ({ store, makeSubject } = await make());
    });

    /** A subject with code A saved at T0, expiring ten minutes on. */
    const subjectWithCode = async (email = "ada@example.com"): Promise<string> => {
      const subjectId = await makeSubject(email);
      await store.saveSignInCode({ subjectId, codeHash: HASH_A, createdAt: T0, expiresAt: at(10 * MINUTE) });
      return subjectId;
    };

    const read = async (subjectId: string) => {
      const code = await store.getSignInCode(subjectId);
      if (!code) throw new Error(`no code stored for ${subjectId}`);
      return code;
    };

    describe("saveSignInCode and getSignInCode", () => {
      it("AC16 (issue 9): getSignInCode returns every field as saved, with attempts 0, consumedAt null, failedSince null and failedInWindow 0", async () => {
        const subjectId = await subjectWithCode();
        expect(await store.getSignInCode(subjectId)).toEqual({
          subjectId,
          codeHash: HASH_A,
          createdAt: T0,
          expiresAt: at(10 * MINUTE),
          attempts: 0,
          consumedAt: null,
          failedSince: null,
          failedInWindow: 0,
          ...NO_LINK,
        });
      });

      it("AC16 (issue 9): a second save replaces codeHash, createdAt and expiresAt, resets attempts and consumedAt, and keeps failedSince and failedInWindow", async () => {
        const subjectId = await subjectWithCode();
        await store.claimSignInAttempt(subjectId, claim(WRONG, at(1 * MINUTE)));
        await store.claimSignInAttempt(subjectId, claim(WRONG, at(2 * MINUTE)));
        await store.consumeSignInCode(subjectId, at(3 * MINUTE));
        const before = await read(subjectId);
        expect(before).toMatchObject({ attempts: 2, failedSince: at(1 * MINUTE), failedInWindow: 2 });
        expect(before.consumedAt).not.toBeNull();

        await store.saveSignInCode({ subjectId, codeHash: HASH_B, createdAt: at(5 * MINUTE), expiresAt: at(15 * MINUTE) });
        expect(await store.getSignInCode(subjectId)).toEqual({
          subjectId,
          codeHash: HASH_B,
          createdAt: at(5 * MINUTE),
          expiresAt: at(15 * MINUTE),
          attempts: 0,
          consumedAt: null,
          failedSince: at(1 * MINUTE),
          failedInWindow: 2,
          ...NO_LINK,
        });
      });

      it("AC16 (issue 9): getSignInCode for a subject with no code returns null", async () => {
        const subjectId = await makeSubject("ada@example.com");
        expect(await store.getSignInCode(subjectId)).toBeNull();
      });

      it("AC16 (issue 9): codes are per subject — saving one subject's code leaves another's alone", async () => {
        const ada = await subjectWithCode("ada@example.com");
        const grace = await makeSubject("grace@example.com");
        await store.saveSignInCode({ subjectId: grace, codeHash: HASH_B, createdAt: at(1 * MINUTE), expiresAt: at(11 * MINUTE) });
        expect((await read(ada)).codeHash).toBe(HASH_A);
        expect((await read(grace)).codeHash).toBe(HASH_B);
      });
    });

    describe("consumeSignInCode", () => {
      it("AC17 (issue 9): returns true once and false every time after", async () => {
        const subjectId = await subjectWithCode();
        expect(await store.consumeSignInCode(subjectId, at(1 * MINUTE))).toBe(true);
        expect(await store.consumeSignInCode(subjectId, at(2 * MINUTE))).toBe(false);
        expect(await store.consumeSignInCode(subjectId, at(3 * MINUTE))).toBe(false);
        expect((await read(subjectId)).consumedAt).not.toBeNull();
      });

      it("AC17 (issue 9): returns false when the subject has no code", async () => {
        const subjectId = await makeSubject("ada@example.com");
        expect(await store.consumeSignInCode(subjectId, at(1 * MINUTE))).toBe(false);
      });
    });

    describe("claimSignInAttempt", () => {
      it("AC18 (issue 9): rule 1 — a null subject id returns null and changes no subject's row", async () => {
        const subjectId = await subjectWithCode();
        const before = await read(subjectId);
        expect(await store.claimSignInAttempt(null, claim(WRONG, at(1 * MINUTE)))).toBeNull();
        expect(await store.claimSignInAttempt(null, claim(HASH_A, at(1 * MINUTE)))).toBeNull();
        expect(await store.getSignInCode(subjectId)).toEqual(before);
      });

      it("AC18 (issue 9): rule 1 — no code for the subject returns null", async () => {
        const subjectId = await makeSubject("ada@example.com");
        expect(await store.claimSignInAttempt(subjectId, claim(HASH_A, at(1 * MINUTE)))).toBeNull();
        expect(await store.getSignInCode(subjectId)).toBeNull();
      });

      it("AC18 (issue 9): rule 1 — a consumed code returns null and nothing changes", async () => {
        const subjectId = await subjectWithCode();
        await store.consumeSignInCode(subjectId, at(1 * MINUTE));
        const before = await read(subjectId);
        expect(await store.claimSignInAttempt(subjectId, claim(HASH_A, at(2 * MINUTE)))).toBeNull();
        expect(await store.claimSignInAttempt(subjectId, claim(WRONG, at(2 * MINUTE)))).toBeNull();
        expect(await store.getSignInCode(subjectId)).toEqual(before);
      });

      it("AC18 (issue 9): rule 1 — attempts at maxAttempts returns null, even for the right hash, and nothing changes", async () => {
        const subjectId = await subjectWithCode();
        expect(await store.claimSignInAttempt(subjectId, claim(WRONG, at(1 * MINUTE), { maxAttempts: 2 }))).not.toBeNull();
        expect(await store.claimSignInAttempt(subjectId, claim(WRONG, at(2 * MINUTE), { maxAttempts: 2 }))).not.toBeNull();
        const before = await read(subjectId);
        expect(before.attempts).toBe(2);
        expect(await store.claimSignInAttempt(subjectId, claim(HASH_A, at(3 * MINUTE), { maxAttempts: 2 }))).toBeNull();
        expect(await store.claimSignInAttempt(subjectId, claim(WRONG, at(3 * MINUTE), { maxAttempts: 2 }))).toBeNull();
        expect(await store.getSignInCode(subjectId)).toEqual(before);
      });

      it("AC18 (issue 9): rule 2 — a wrong hash in a live window at maxFailures returns null and nothing changes", async () => {
        const subjectId = await subjectWithCode();
        await store.claimSignInAttempt(subjectId, claim(WRONG, at(1 * MINUTE), { maxFailures: 2 }));
        await store.claimSignInAttempt(subjectId, claim(WRONG, at(2 * MINUTE), { maxFailures: 2 }));
        const before = await read(subjectId);
        expect(before).toMatchObject({ attempts: 2, failedSince: at(1 * MINUTE), failedInWindow: 2 });
        expect(await store.claimSignInAttempt(subjectId, claim(WRONG, at(3 * MINUTE), { maxFailures: 2 }))).toBeNull();
        expect(await store.getSignInCode(subjectId)).toEqual(before);
      });

      // Inverted from issue 9's "rule 2 does not stop the right hash".
      it("AC2: rule 2 stops the right hash too — in a live window at maxFailures the right hash returns null and nothing changes", async () => {
        const subjectId = await subjectWithCode();
        await store.claimSignInAttempt(subjectId, claim(WRONG, at(1 * MINUTE), { maxFailures: 2 }));
        await store.claimSignInAttempt(subjectId, claim(WRONG, at(2 * MINUTE), { maxFailures: 2 }));
        const before = await read(subjectId);
        expect(before).toMatchObject({ attempts: 2, failedSince: at(1 * MINUTE), failedInWindow: 2 });
        expect(await store.claimSignInAttempt(subjectId, claim(HASH_A, at(3 * MINUTE), { maxFailures: 2 }))).toBeNull();
        expect(await store.getSignInCode(subjectId)).toEqual(before);
      });

      it("AC2: rule 2 stops the right hash of a fresh code saved at the cap, attempts untouched", async () => {
        const subjectId = await subjectWithCode();
        await store.claimSignInAttempt(subjectId, claim(WRONG, at(1 * MINUTE), { maxFailures: 2 }));
        await store.claimSignInAttempt(subjectId, claim(WRONG, at(2 * MINUTE), { maxFailures: 2 }));
        await store.saveSignInCode({ subjectId, codeHash: HASH_B, createdAt: at(3 * MINUTE), expiresAt: at(13 * MINUTE) });
        const before = await read(subjectId);
        expect(before).toMatchObject({ attempts: 0, failedInWindow: 2 });
        expect(await store.claimSignInAttempt(subjectId, claim(HASH_B, at(4 * MINUTE), { maxFailures: 2 }))).toBeNull();
        expect(await store.getSignInCode(subjectId)).toEqual(before);
      });

      it("AC2: below maxFailures in a live window, the right hash still claims and leaves the window alone", async () => {
        const subjectId = await subjectWithCode();
        await store.claimSignInAttempt(subjectId, claim(WRONG, at(1 * MINUTE), { maxFailures: 2 }));
        const result = await store.claimSignInAttempt(subjectId, claim(HASH_A, at(2 * MINUTE), { maxFailures: 2 }));
        expect(result).toMatchObject({ codeHash: HASH_A, expiresAt: at(10 * MINUTE) });
        expect(await read(subjectId)).toMatchObject({ attempts: 2, failedSince: at(1 * MINUTE), failedInWindow: 1 });
      });

      it("AC2: a window at maxFailures that is no longer live does not stop the right hash", async () => {
        const subjectId = await subjectWithCode();
        await store.claimSignInAttempt(subjectId, claim(WRONG, at(1 * MINUTE), { windowMs: HOUR, maxFailures: 2 }));
        await store.claimSignInAttempt(subjectId, claim(WRONG, at(2 * MINUTE), { windowMs: HOUR, maxFailures: 2 }));
        const result = await store.claimSignInAttempt(subjectId, claim(HASH_A, at(1 * MINUTE + HOUR), { windowMs: HOUR, maxFailures: 2 }));
        expect(result).toMatchObject({ codeHash: HASH_A, expiresAt: at(10 * MINUTE) });
      });

      describe("AC3 — the claim returns failedInWindow as it stands after the claim", () => {
        it("AC3: the right hash with no window returns 0", async () => {
          const subjectId = await subjectWithCode();
          expect(await store.claimSignInAttempt(subjectId, claim(HASH_A, at(1 * MINUTE)))).toEqual({
            codeHash: HASH_A,
            expiresAt: at(10 * MINUTE),
            failedInWindow: 0,
          });
        });

        it("AC3: a wrong hash with no window returns 1, and the next wrong hash in the window 2", async () => {
          const subjectId = await subjectWithCode();
          expect(await store.claimSignInAttempt(subjectId, claim(WRONG, at(1 * MINUTE)))).toEqual({
            codeHash: HASH_A,
            expiresAt: at(10 * MINUTE),
            failedInWindow: 1,
          });
          expect(await store.claimSignInAttempt(subjectId, claim(WRONG, at(2 * MINUTE)))).toEqual({
            codeHash: HASH_A,
            expiresAt: at(10 * MINUTE),
            failedInWindow: 2,
          });
        });

        it("AC3: the right hash in a live window returns the count unchanged", async () => {
          const subjectId = await subjectWithCode();
          await store.claimSignInAttempt(subjectId, claim(WRONG, at(1 * MINUTE)));
          expect(await store.claimSignInAttempt(subjectId, claim(HASH_A, at(2 * MINUTE)))).toEqual({
            codeHash: HASH_A,
            expiresAt: at(10 * MINUTE),
            failedInWindow: 1,
          });
        });

        it("AC3: a wrong hash once the window is no longer live returns 1, the new window's first", async () => {
          const subjectId = await subjectWithCode();
          await store.claimSignInAttempt(subjectId, claim(WRONG, at(1 * MINUTE), { windowMs: HOUR }));
          await store.claimSignInAttempt(subjectId, claim(WRONG, at(2 * MINUTE), { windowMs: HOUR }));
          expect(await store.claimSignInAttempt(subjectId, claim(WRONG, at(1 * MINUTE + HOUR), { windowMs: HOUR }))).toEqual({
            codeHash: HASH_A,
            expiresAt: at(10 * MINUTE),
            failedInWindow: 1,
          });
        });

        it("AC3: the right hash in a window no longer live, its count still at maxFailures, returns that count", async () => {
          const subjectId = await subjectWithCode();
          await store.claimSignInAttempt(subjectId, claim(WRONG, at(1 * MINUTE), { windowMs: HOUR, maxFailures: 2 }));
          await store.claimSignInAttempt(subjectId, claim(WRONG, at(2 * MINUTE), { windowMs: HOUR, maxFailures: 2 }));
          expect(
            await store.claimSignInAttempt(subjectId, claim(HASH_A, at(1 * MINUTE + HOUR), { windowMs: HOUR, maxFailures: 2 })),
          ).toEqual({ codeHash: HASH_A, expiresAt: at(10 * MINUTE), failedInWindow: 2 });
        });
      });

      it("AC18 (issue 9): rule 3 — the right hash adds an attempt, returns { codeHash, expiresAt } and starts no window", async () => {
        const subjectId = await subjectWithCode();
        const result = await store.claimSignInAttempt(subjectId, claim(HASH_A, at(1 * MINUTE)));
        expect(result).toMatchObject({ codeHash: HASH_A, expiresAt: at(10 * MINUTE) });
        expect(await read(subjectId)).toMatchObject({ attempts: 1, consumedAt: null, failedSince: null, failedInWindow: 0 });
      });

      it("AC18 (issue 9): rule 3 — a wrong hash with no window adds an attempt, returns the stored codeHash and expiresAt, and opens a window at now with 1", async () => {
        const subjectId = await subjectWithCode();
        const result = await store.claimSignInAttempt(subjectId, claim(WRONG, at(1 * MINUTE)));
        expect(result).toMatchObject({ codeHash: HASH_A, expiresAt: at(10 * MINUTE) });
        expect(await read(subjectId)).toMatchObject({ attempts: 1, failedSince: at(1 * MINUTE), failedInWindow: 1 });
      });

      it("AC18 (issue 9): rule 3 — a wrong hash in a live window adds 1 to failedInWindow and keeps failedSince", async () => {
        const subjectId = await subjectWithCode();
        await store.claimSignInAttempt(subjectId, claim(WRONG, at(1 * MINUTE)));
        await store.claimSignInAttempt(subjectId, claim(WRONG, at(2 * MINUTE)));
        expect(await read(subjectId)).toMatchObject({ attempts: 2, failedSince: at(1 * MINUTE), failedInWindow: 2 });
      });

      it("AC18 (issue 9): rule 3 — a wrong hash one millisecond before the window ends still counts in it", async () => {
        const subjectId = await subjectWithCode();
        await store.claimSignInAttempt(subjectId, claim(WRONG, at(1 * MINUTE), { windowMs: HOUR }));
        await store.claimSignInAttempt(subjectId, claim(WRONG, at(1 * MINUTE + HOUR - 1), { windowMs: HOUR }));
        expect(await read(subjectId)).toMatchObject({ failedSince: at(1 * MINUTE), failedInWindow: 2 });
      });

      it("AC18 (issue 9): rule 3 — a wrong hash at failedSince + windowMs, the window no longer live, opens a new one at now with 1", async () => {
        const subjectId = await subjectWithCode();
        await store.claimSignInAttempt(subjectId, claim(WRONG, at(1 * MINUTE), { windowMs: HOUR }));
        await store.claimSignInAttempt(subjectId, claim(WRONG, at(2 * MINUTE), { windowMs: HOUR }));
        await store.claimSignInAttempt(subjectId, claim(WRONG, at(1 * MINUTE + HOUR), { windowMs: HOUR }));
        expect(await read(subjectId)).toMatchObject({
          attempts: 3,
          failedSince: at(1 * MINUTE + HOUR),
          failedInWindow: 1,
        });
      });

      it("AC18 (issue 9): rule 3 over rule 2 — a window at maxFailures that is no longer live does not refuse: the wrong hash claims and restarts the window", async () => {
        const subjectId = await subjectWithCode();
        await store.claimSignInAttempt(subjectId, claim(WRONG, at(1 * MINUTE), { windowMs: HOUR, maxFailures: 2 }));
        await store.claimSignInAttempt(subjectId, claim(WRONG, at(2 * MINUTE), { windowMs: HOUR, maxFailures: 2 }));
        const result = await store.claimSignInAttempt(
          subjectId,
          claim(WRONG, at(1 * MINUTE + HOUR), { windowMs: HOUR, maxFailures: 2 }),
        );
        expect(result).toMatchObject({ codeHash: HASH_A, expiresAt: at(10 * MINUTE) });
        expect(await read(subjectId)).toMatchObject({
          attempts: 3,
          failedSince: at(1 * MINUTE + HOUR),
          failedInWindow: 1,
        });
      });

      it("AC18 (issue 9): rule 4 — expiry is not checked: a claim after expiresAt still returns the code and adds an attempt", async () => {
        const subjectId = await subjectWithCode();
        const result = await store.claimSignInAttempt(subjectId, claim(HASH_A, at(30 * MINUTE)));
        expect(result).toMatchObject({ codeHash: HASH_A, expiresAt: at(10 * MINUTE) });
        expect((await read(subjectId)).attempts).toBe(1);
      });

      it("AC18 (issue 9): claims are per subject — one subject's claims leave another's row alone", async () => {
        const ada = await subjectWithCode("ada@example.com");
        const grace = await subjectWithCode("grace@example.com");
        const before = await read(grace);
        await store.claimSignInAttempt(ada, claim(WRONG, at(1 * MINUTE)));
        expect(await store.getSignInCode(grace)).toEqual(before);
      });
    });

    /** A link saved for the subject with no hold: `hash`, created at `createdAt`, expiring ten minutes on. */
    const saveLink = (subjectId: string, hash: string, createdAt: Date) =>
      store.saveSignInLink({ subjectId, linkHash: hash, createdAt, expiresAt: new Date(createdAt.getTime() + 10 * MINUTE) });

    const hold = (now: Date) => ({ now, waitMs: 10 * MINUTE });
    const codeAt = (subjectId: string, hash: string, createdAt: Date) => ({
      subjectId,
      codeHash: hash,
      createdAt,
      expiresAt: new Date(createdAt.getTime() + 10 * MINUTE),
    });

    describe("AC14 — saveSignInCode returns whether it saved, holds when given a hold, and keeps the link", () => {
      it("AC14: without a hold it saves and returns true, the first time and when replacing", async () => {
        const subjectId = await makeSubject("ada@example.com");
        expect(await store.saveSignInCode(codeAt(subjectId, HASH_A, T0))).toBe(true);
        expect(await store.saveSignInCode(codeAt(subjectId, HASH_B, at(1 * MINUTE)))).toBe(true);
        expect((await read(subjectId)).codeHash).toBe(HASH_B);
      });

      it("AC14: with a hold and no row yet it saves and returns true", async () => {
        const subjectId = await makeSubject("ada@example.com");
        expect(await store.saveSignInCode(codeAt(subjectId, HASH_A, T0), hold(T0))).toBe(true);
        expect((await read(subjectId)).codeHash).toBe(HASH_A);
      });

      it("AC14: with a hold, an unused code created less than waitMs before now holds it — false, and nothing changes", async () => {
        const subjectId = await subjectWithCode();
        const before = await read(subjectId);
        const now = at(10 * MINUTE - 1);
        expect(await store.saveSignInCode(codeAt(subjectId, HASH_B, now), hold(now))).toBe(false);
        expect(await store.getSignInCode(subjectId)).toEqual(before);
      });

      it("AC14: with a hold, at exactly waitMs after the code it saves", async () => {
        const subjectId = await subjectWithCode();
        const now = at(10 * MINUTE);
        expect(await store.saveSignInCode(codeAt(subjectId, HASH_B, now), hold(now))).toBe(true);
        expect((await read(subjectId)).codeHash).toBe(HASH_B);
      });

      it("AC14: with a hold, a consumed code does not hold", async () => {
        const subjectId = await subjectWithCode();
        await store.consumeSignInCode(subjectId, at(1 * MINUTE));
        const now = at(2 * MINUTE);
        expect(await store.saveSignInCode(codeAt(subjectId, HASH_B, now), hold(now))).toBe(true);
        expect((await read(subjectId)).codeHash).toBe(HASH_B);
      });

      it("AC14: with a hold, an unused code holds with every attempt spent", async () => {
        const subjectId = await subjectWithCode();
        for (let g = 1; g <= 2; g++) await store.claimSignInAttempt(subjectId, claim(WRONG, at(g * SECOND), { maxAttempts: 2 }));
        const before = await read(subjectId);
        expect(before).toMatchObject({ attempts: 2, consumedAt: null });
        const now = at(5 * MINUTE);
        expect(await store.saveSignInCode(codeAt(subjectId, HASH_B, now), hold(now))).toBe(false);
        expect(await store.getSignInCode(subjectId)).toEqual(before);
      });

      it("AC14: with a hold, an unused link created less than waitMs before now holds it; at waitMs it saves", async () => {
        const subjectId = await subjectWithCode();
        await saveLink(subjectId, LINK_A, at(20 * MINUTE));
        const before = await read(subjectId);
        const early = at(30 * MINUTE - 1);
        expect(await store.saveSignInCode(codeAt(subjectId, HASH_B, early), hold(early))).toBe(false);
        expect(await store.getSignInCode(subjectId)).toEqual(before);
        const now = at(30 * MINUTE);
        expect(await store.saveSignInCode(codeAt(subjectId, HASH_B, now), hold(now))).toBe(true);
        expect((await read(subjectId)).codeHash).toBe(HASH_B);
      });

      it("AC14: with a hold, a redeemed link does not hold", async () => {
        const subjectId = await subjectWithCode();
        await saveLink(subjectId, LINK_A, at(1 * MINUTE));
        await store.redeemSignInLink(LINK_A, at(2 * MINUTE));
        const now = at(3 * MINUTE);
        expect(await store.saveSignInCode(codeAt(subjectId, HASH_B, now), hold(now))).toBe(true);
        expect((await read(subjectId)).codeHash).toBe(HASH_B);
      });

      it("AC14: one subject's recent code does not hold another's save", async () => {
        await subjectWithCode("ada@example.com");
        const grace = await makeSubject("grace@example.com");
        const now = at(1 * MINUTE);
        expect(await store.saveSignInCode(codeAt(grace, HASH_B, now), hold(now))).toBe(true);
      });

      it("AC14: saveSignInCode keeps the link fields as they are", async () => {
        const subjectId = await subjectWithCode();
        await saveLink(subjectId, LINK_A, at(1 * MINUTE));
        await store.saveSignInCode(codeAt(subjectId, HASH_B, at(2 * MINUTE)));
        expect(await read(subjectId)).toMatchObject({
          codeHash: HASH_B,
          linkHash: LINK_A,
          linkCreatedAt: at(1 * MINUTE),
          linkExpiresAt: at(11 * MINUTE),
        });
      });
    });

    describe("AC14 — saveSignInLink", () => {
      it("AC14: sets the three link fields, returns true, and leaves every other field as it was", async () => {
        const subjectId = await subjectWithCode();
        await store.claimSignInAttempt(subjectId, claim(WRONG, at(1 * MINUTE)));
        const before = await read(subjectId);
        expect(await saveLink(subjectId, LINK_A, at(2 * MINUTE))).toBe(true);
        expect(await store.getSignInCode(subjectId)).toEqual({
          ...before,
          linkHash: LINK_A,
          linkCreatedAt: at(2 * MINUTE),
          linkExpiresAt: at(12 * MINUTE),
        });
      });

      it("AC14: a second link replaces the first", async () => {
        const subjectId = await subjectWithCode();
        await saveLink(subjectId, LINK_A, at(1 * MINUTE));
        expect(await saveLink(subjectId, LINK_B, at(2 * MINUTE))).toBe(true);
        expect(await read(subjectId)).toMatchObject({ linkHash: LINK_B, linkCreatedAt: at(2 * MINUTE), linkExpiresAt: at(12 * MINUTE) });
      });

      it("AC14: returns false for a subject with no sign-in row, and stores nothing", async () => {
        const subjectId = await makeSubject("ada@example.com");
        expect(await saveLink(subjectId, LINK_A, T0)).toBe(false);
        expect(await store.getSignInCode(subjectId)).toBeNull();
      });

      it("AC14: with a hold, an unused code created less than waitMs before now holds it — false, nothing changes; at waitMs it saves", async () => {
        const subjectId = await subjectWithCode();
        const before = await read(subjectId);
        const link = (createdAt: Date) => ({ subjectId, linkHash: LINK_A, createdAt, expiresAt: new Date(createdAt.getTime() + 10 * MINUTE) });
        const early = at(10 * MINUTE - 1);
        expect(await store.saveSignInLink(link(early), hold(early))).toBe(false);
        expect(await store.getSignInCode(subjectId)).toEqual(before);
        const now = at(10 * MINUTE);
        expect(await store.saveSignInLink(link(now), hold(now))).toBe(true);
        expect((await read(subjectId)).linkHash).toBe(LINK_A);
      });

      it("AC14: with a hold, an unused link created less than waitMs before now holds it; at waitMs it saves", async () => {
        const subjectId = await subjectWithCode();
        await saveLink(subjectId, LINK_A, at(20 * MINUTE));
        const before = await read(subjectId);
        const link = (createdAt: Date) => ({ subjectId, linkHash: LINK_B, createdAt, expiresAt: new Date(createdAt.getTime() + 10 * MINUTE) });
        const early = at(30 * MINUTE - 1);
        expect(await store.saveSignInLink(link(early), hold(early))).toBe(false);
        expect(await store.getSignInCode(subjectId)).toEqual(before);
        const now = at(30 * MINUTE);
        expect(await store.saveSignInLink(link(now), hold(now))).toBe(true);
        expect((await read(subjectId)).linkHash).toBe(LINK_B);
      });

      it("AC14: without a hold it saves however recently the code went", async () => {
        const subjectId = await subjectWithCode();
        expect(await saveLink(subjectId, LINK_A, at(1 * SECOND))).toBe(true);
        expect((await read(subjectId)).linkHash).toBe(LINK_A);
      });

      it("AC14: links are per subject — saving one subject's leaves another's alone", async () => {
        const ada = await subjectWithCode("ada@example.com");
        const grace = await subjectWithCode("grace@example.com");
        const before = await read(grace);
        await saveLink(ada, LINK_A, at(1 * MINUTE));
        expect(await store.getSignInCode(grace)).toEqual(before);
      });
    });

    describe("AC14 — redeemSignInLink", () => {
      it("AC14: a matching hash before linkExpiresAt clears the link and the window, consumes the code, and returns the subject id", async () => {
        const subjectId = await subjectWithCode();
        await store.claimSignInAttempt(subjectId, claim(WRONG, at(1 * MINUTE)));
        await saveLink(subjectId, LINK_A, at(2 * MINUTE));
        const before = await read(subjectId);
        expect(await store.redeemSignInLink(LINK_A, at(12 * MINUTE - 1))).toBe(subjectId);
        expect(await store.getSignInCode(subjectId)).toEqual({
          ...before,
          consumedAt: at(12 * MINUTE - 1),
          failedSince: null,
          failedInWindow: 0,
          ...NO_LINK,
        });
      });

      it("AC14: a code already consumed keeps its consumedAt", async () => {
        const subjectId = await subjectWithCode();
        await store.consumeSignInCode(subjectId, at(1 * MINUTE));
        await saveLink(subjectId, LINK_A, at(2 * MINUTE));
        expect(await store.redeemSignInLink(LINK_A, at(3 * MINUTE))).toBe(subjectId);
        expect((await read(subjectId)).consumedAt).toEqual(at(1 * MINUTE));
      });

      it("AC14: a second redeem of the same hash returns null and changes nothing", async () => {
        const subjectId = await subjectWithCode();
        await saveLink(subjectId, LINK_A, at(1 * MINUTE));
        await store.redeemSignInLink(LINK_A, at(2 * MINUTE));
        const after = await read(subjectId);
        expect(await store.redeemSignInLink(LINK_A, at(3 * MINUTE))).toBeNull();
        expect(await store.getSignInCode(subjectId)).toEqual(after);
      });

      it.each([
        ["at linkExpiresAt", LINK_A, 11 * MINUTE],
        ["after linkExpiresAt", LINK_A, 20 * MINUTE],
        ["for a hash no link has", LINK_B, 2 * MINUTE],
      ])("AC14: %s it returns null and changes nothing", async (_when, hash, ms) => {
        const subjectId = await subjectWithCode();
        await store.claimSignInAttempt(subjectId, claim(WRONG, at(30 * SECOND)));
        await saveLink(subjectId, LINK_A, at(1 * MINUTE));
        const before = await read(subjectId);
        expect(await store.redeemSignInLink(hash, at(ms))).toBeNull();
        expect(await store.getSignInCode(subjectId)).toEqual(before);
      });

      it("AC14: redeeming one subject's link leaves another's row alone", async () => {
        const ada = await subjectWithCode("ada@example.com");
        const grace = await subjectWithCode("grace@example.com");
        await saveLink(grace, LINK_B, at(1 * MINUTE));
        await saveLink(ada, LINK_A, at(1 * MINUTE));
        const before = await read(grace);
        expect(await store.redeemSignInLink(LINK_A, at(2 * MINUTE))).toBe(ada);
        expect(await store.getSignInCode(grace)).toEqual(before);
      });
    });

    describe("incrementRateLimit", () => {
      const W0 = T0;
      const W0_END = at(HOUR);
      const W1 = at(HOUR);
      const W1_END = at(2 * HOUR);

      it("AC19 (issue 9): returns 1, 2, 3, … for repeated calls on one (bucket, key, windowStart)", async () => {
        const now = at(5 * MINUTE);
        expect(await store.incrementRateLimit("sign-in-request", "203.0.113.7", W0, W0_END, now)).toBe(1);
        expect(await store.incrementRateLimit("sign-in-request", "203.0.113.7", W0, W0_END, now)).toBe(2);
        expect(await store.incrementRateLimit("sign-in-request", "203.0.113.7", W0, W0_END, now)).toBe(3);
      });

      it("AC19 (issue 9): a different bucket, key or window starts at 1", async () => {
        const now = at(5 * MINUTE);
        await store.incrementRateLimit("sign-in-request", "203.0.113.7", W0, W0_END, now);
        await store.incrementRateLimit("sign-in-request", "203.0.113.7", W0, W0_END, now);
        expect(await store.incrementRateLimit("other-bucket", "203.0.113.7", W0, W0_END, now)).toBe(1);
        expect(await store.incrementRateLimit("sign-in-request", "198.51.100.4", W0, W0_END, now)).toBe(1);
        expect(await store.incrementRateLimit("sign-in-request", "203.0.113.7", W1, W1_END, now)).toBe(1);
        expect(await store.incrementRateLimit("sign-in-request", "203.0.113.7", W0, W0_END, now)).toBe(3);
      });

      it("AC19 (issue 9): a call at its window's expiresAt finds the row deleted and returns 1", async () => {
        await store.incrementRateLimit("sign-in-request", "203.0.113.7", W0, W0_END, at(5 * MINUTE));
        await store.incrementRateLimit("sign-in-request", "203.0.113.7", W0, W0_END, at(6 * MINUTE));
        expect(await store.incrementRateLimit("sign-in-request", "203.0.113.7", W0, W0_END, W0_END)).toBe(1);
      });

      it("AC19 (issue 9): a call after its window's expiresAt finds the row deleted and returns 1", async () => {
        await store.incrementRateLimit("sign-in-request", "203.0.113.7", W0, W0_END, at(5 * MINUTE));
        await store.incrementRateLimit("sign-in-request", "203.0.113.7", W0, W0_END, at(6 * MINUTE));
        expect(await store.incrementRateLimit("sign-in-request", "203.0.113.7", W0, W0_END, at(3 * HOUR))).toBe(1);
      });

      it("AC19 (issue 9): any call deletes every expired row first, not only its own", async () => {
        await store.incrementRateLimit("sign-in-request", "203.0.113.7", W0, W0_END, at(5 * MINUTE));
        await store.incrementRateLimit("sign-in-request", "203.0.113.7", W0, W0_END, at(6 * MINUTE));
        // A call on another key, after W0 has expired, sweeps W0's row …
        await store.incrementRateLimit("sign-in-request", "198.51.100.4", W1, W1_END, at(HOUR + MINUTE));
        // … so W0's counter starts over even when asked before its own expiry is reached again.
        expect(await store.incrementRateLimit("sign-in-request", "203.0.113.7", W0, W0_END, at(7 * MINUTE))).toBe(1);
      });

      it("AC19 (issue 9): a call before expiresAt keeps counting", async () => {
        await store.incrementRateLimit("sign-in-request", "203.0.113.7", W0, W0_END, at(5 * MINUTE));
        expect(
          await store.incrementRateLimit("sign-in-request", "203.0.113.7", W0, W0_END, new Date(W0_END.getTime() - 1)),
        ).toBe(2);
      });
    });
  });
}
