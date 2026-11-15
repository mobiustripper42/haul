/**
 * The run lease repository contract (issue 174), run against both adapters like `runEmailChangeContract` (DEC-010):
 * `src/adapters/in-memory-repository.test.ts` and `src/adapters/postgres-repository.test.ts` call it.
 *
 * It owns the lease's rules: a lease is free when none is held or the held one's `until` is at or before the claim's
 * `at`; a release frees it only with the token that holds it; and of two claims at the same moment exactly one wins.
 * `make` gives two repositories on one store, each its own connection in Postgres; in memory they are one instance.
 * How long the charge run holds its lease, and when it claims and releases, are `src/charge-run.test.ts`'s.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { Repository } from "../ports/repository.js";

export function runRunLeaseContract(
  name: string,
  make: () => Promise<{ repo: Repository; other: Repository }>,
  reset?: () => Promise<void>,
): void {
  describe(`Run lease repository contract — ${name}`, () => {
    const RUN = "charge-run";
    const T0 = new Date("2027-01-05T12:00:00.000Z");
    const MINUTE = 60_000;
    const at = (minutes: number, ms = 0): Date => new Date(T0.getTime() + minutes * MINUTE + ms);

    let repo: Repository;
    let other: Repository;

    beforeEach(async () => {
      if (reset) await reset();
      ({ repo, other } = await make());
    });

    it("AC1: a claim with no lease held returns a token; released with it, the lease is free again, and the next claim gets a different token", async () => {
      const first = await repo.claimRunLease(RUN, T0, at(30));
      expect(typeof first).toBe("string");
      expect(first).not.toBe("");
      await repo.releaseRunLease(RUN, first ?? "no token");
      const second = await repo.claimRunLease(RUN, T0, at(30));
      expect(typeof second).toBe("string");
      expect(second).not.toBe(first);
    });

    it("AC2: while a lease is held and unexpired, a claim returns null: at the instant it was claimed, and a millisecond before its until", async () => {
      expect(await repo.claimRunLease(RUN, T0, at(30))).not.toBeNull();
      expect(await repo.claimRunLease(RUN, T0, at(30))).toBeNull();
      expect(await repo.claimRunLease(RUN, at(30, -1), at(60, -1))).toBeNull();
    });

    it("AC3: a lease never released is free from its until on: a claim at exactly its until returns a new token", async () => {
      const stale = await repo.claimRunLease(RUN, T0, at(30));
      expect(stale).not.toBeNull();
      const taken = await repo.claimRunLease(RUN, at(30), at(60));
      expect(typeof taken).toBe("string");
      expect(taken).not.toBe(stale);
    });

    it("AC6: a late release by the firing whose lease expired leaves the new holder's lease in place; a claim during it is null until the holder releases", async () => {
      const a = await repo.claimRunLease(RUN, T0, at(30));
      const b = await repo.claimRunLease(RUN, at(31), at(61));
      expect(a).not.toBeNull();
      expect(b).not.toBeNull();
      await repo.releaseRunLease(RUN, a ?? "no token");
      expect(await repo.claimRunLease(RUN, at(40), at(70))).toBeNull();
      await repo.releaseRunLease(RUN, b ?? "no token");
      expect(await repo.claimRunLease(RUN, at(40), at(70))).not.toBeNull();
    });

    it("AC6: a release with a token that never held the lease, a UUID or a string that is not one, frees nothing and does not throw", async () => {
      expect(await repo.claimRunLease(RUN, T0, at(30))).not.toBeNull();
      await repo.releaseRunLease(RUN, "6f1c2b9e-3d4a-4e5f-8a7b-0c1d2e3f4a5b");
      await repo.releaseRunLease(RUN, "not a token");
      expect(await repo.claimRunLease(RUN, at(1), at(31))).toBeNull();
    });

    it("AC5: two connections claiming at the same moment, over no lease held, give exactly one token, round after round", async () => {
      for (let round = 0; round < 10; round++) {
        const run = `${RUN}-${round}`;
        const claims = await Promise.all([repo.claimRunLease(run, T0, at(30)), other.claimRunLease(run, T0, at(30))]);
        expect(claims.filter((token) => token !== null), `round ${round}`).toHaveLength(1);
      }
    });

    it("AC5: two connections claiming at the same moment, over an expired lease, give exactly one token, round after round", async () => {
      for (let round = 0; round < 10; round++) {
        const run = `${RUN}-${round}`;
        expect(await repo.claimRunLease(run, T0, at(30)), `round ${round}: the stale lease`).not.toBeNull();
        const claims = await Promise.all([repo.claimRunLease(run, at(31), at(61)), other.claimRunLease(run, at(31), at(61))]);
        expect(claims.filter((token) => token !== null), `round ${round}`).toHaveLength(1);
      }
    });

    it("AC7: a claim and a release are each seen from the other connection as soon as they return", async () => {
      const token = await repo.claimRunLease(RUN, T0, at(30));
      expect(token).not.toBeNull();
      expect(await other.claimRunLease(RUN, at(1), at(31))).toBeNull();
      await repo.releaseRunLease(RUN, token ?? "no token");
      expect(await other.claimRunLease(RUN, at(1), at(31))).not.toBeNull();
    });
  });
}
