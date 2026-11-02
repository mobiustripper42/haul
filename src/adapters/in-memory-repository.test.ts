import { describe, expect, it } from "vitest";
import { runSignInStoreContract } from "../sign-in/store-contract.js";
import { InMemoryRepository } from "./in-memory-repository.js";
import { runRepositoryContract } from "./repository-contract.js";

runRepositoryContract("in-memory", async () => new InMemoryRepository());

// Issue 9, AC16–AC19: the repository is a sign-in store too, and a subject is a member.
runSignInStoreContract("in-memory repository", async () => {
  const repo = new InMemoryRepository();
  return { store: repo, makeSubject: async (email) => (await repo.createMember({ email })).id };
});

// Issue 34: the fake's record of events, which the sign-in actions' tests read.
describe("issue 34 — InMemoryRepository.events()", () => {
  const WINDOW_START = new Date("2026-10-28T14:00:00.000Z");

  it("AC4: events() returns what recordEvent was given, in order, as copies — changing what it returns, the refusal's windowStart included, changes nothing it holds", async () => {
    const repo = new InMemoryRepository();
    const ada = await repo.createMember({ email: "ada@example.com" });
    await repo.recordEvent({ kind: "lock", memberId: ada.id });
    await repo.recordEvent({ kind: "rate_limit_refusal", bucket: "sign-in-request", key: "203.0.113.7", windowStart: WINDOW_START });
    await repo.recordEvent({ kind: "sign_in_by_link", memberId: ada.id });
    const expected = [
      { kind: "lock", memberId: ada.id },
      { kind: "rate_limit_refusal", bucket: "sign-in-request", key: "203.0.113.7", windowStart: new Date("2026-10-28T14:00:00.000Z") },
      { kind: "sign_in_by_link", memberId: ada.id },
    ];

    const first = repo.events();
    expect(first).toEqual(expected);

    const refusal = first[1];
    if (refusal?.kind !== "rate_limit_refusal") throw new Error("no refusal at index 1");
    refusal.windowStart.setTime(0);
    refusal.key = "198.51.100.4";
    first.push({ kind: "sign_in_by_code", memberId: ada.id });
    expect(repo.events()).toEqual(expected);
  });
});
