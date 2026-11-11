import { describe, expect, it } from "vitest";
import { runSignInStoreContract } from "../sign-in/store-contract.js";
import { InMemoryRepository } from "./in-memory-repository.js";
import { runRepositoryContract } from "./repository-contract.js";
import { runWeekCreditContract } from "./week-credit-contract.js";

// Issue 71, AC5: the fake reads its event actors from events().
let contractRepo: InMemoryRepository;
runRepositoryContract(
  "in-memory",
  async () => (contractRepo = new InMemoryRepository()),
  async () => contractRepo.events().map((event) => event.actor),
);

// Issue 149: closing and reopening weeks, and the week credits, through the fake's test seams; issue 155 adds the
// spending of a week credit.
let weekRepo: InMemoryRepository;
runWeekCreditContract(
  "in-memory",
  async () => (weekRepo = new InMemoryRepository()),
  async (input) => weekRepo.addProduct(input),
  (subscriptionId, pickupDate, status, amountCents) => weekRepo.addLedgerRow(subscriptionId, pickupDate, status, amountCents),
  (subscriptionId, optionIds) => weekRepo.setSubscriptionOptions(subscriptionId, optionIds),
  (weekCreditId, ledgerId) => weekRepo.spendWeekCredit(weekCreditId, ledgerId),
);

// Issue 9, AC16–AC19: the repository is a sign-in store too, and a subject is a member.
runSignInStoreContract("in-memory repository", async () => {
  const repo = new InMemoryRepository();
  return { store: repo, makeSubject: async (email) => (await repo.createMember({ email })).id };
});

// Issue 34: the fake's record of events, which the sign-in actions' tests read.
describe("issue 34 — InMemoryRepository.events()", () => {
  const WINDOW_START = new Date("2026-10-28T14:00:00.000Z");

  // Issue 71: each event carries its actor, null when recorded outside withActor.
  it("AC4: events() returns what recordEvent was given, in order, as copies — changing what it returns, the refusal's windowStart included, changes nothing it holds", async () => {
    const repo = new InMemoryRepository();
    const ada = await repo.createMember({ email: "ada@example.com" });
    await repo.recordEvent({ kind: "lock", memberId: ada.id });
    await repo.recordEvent({ kind: "rate_limit_refusal", bucket: "sign-in-request", key: "203.0.113.7", windowStart: WINDOW_START });
    await repo.recordEvent({ kind: "sign_in_by_link", memberId: ada.id });
    const expected = [
      { kind: "lock", memberId: ada.id, actor: null },
      { kind: "rate_limit_refusal", bucket: "sign-in-request", key: "203.0.113.7", windowStart: new Date("2026-10-28T14:00:00.000Z"), actor: null },
      { kind: "sign_in_by_link", memberId: ada.id, actor: null },
    ];

    const first = repo.events();
    expect(first).toEqual(expected);

    const refusal = first[1];
    if (refusal?.kind !== "rate_limit_refusal") throw new Error("no refusal at index 1");
    refusal.windowStart.setTime(0);
    refusal.key = "198.51.100.4";
    first.push({ kind: "sign_in_by_code", memberId: ada.id, actor: null });
    expect(repo.events()).toEqual(expected);
  });
});
