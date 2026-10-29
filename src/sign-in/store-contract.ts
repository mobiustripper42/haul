/**
 * The sign-in store contract (issue 9, AC16–AC19). One behavioural suite, run against
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
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const at = (ms: number): Date => new Date(T0.getTime() + ms);

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const WRONG = "f".repeat(64);

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

      it("AC18 (issue 9): rule 2 does not stop the right hash — at the window cap it claims, adds an attempt and leaves the window alone", async () => {
        const subjectId = await subjectWithCode();
        await store.claimSignInAttempt(subjectId, claim(WRONG, at(1 * MINUTE), { maxFailures: 2 }));
        await store.claimSignInAttempt(subjectId, claim(WRONG, at(2 * MINUTE), { maxFailures: 2 }));
        const result = await store.claimSignInAttempt(subjectId, claim(HASH_A, at(3 * MINUTE), { maxFailures: 2 }));
        expect(result).toMatchObject({ codeHash: HASH_A, expiresAt: at(10 * MINUTE) });
        expect(await read(subjectId)).toMatchObject({ attempts: 3, failedSince: at(1 * MINUTE), failedInWindow: 2 });
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
