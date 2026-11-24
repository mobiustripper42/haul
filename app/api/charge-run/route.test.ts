// Issue 135, AC1 and AC2: the cron route, `GET` with the composition root mocked over the three fakes, as
// app/admin/members.csv/route.test.ts mocks it, and the real charge run underneath: `runCharges` is wrapped, not
// replaced, so what the route hands it can be read. The run's own cases are src/charge-run.test.ts's; here one charge,
// one decline and one no-answer go through it, so the events the route is declared to record (app/audit-entry-points.ts)
// are the ones it records. The clock is pinned with fake Date.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeEmail } from "@core/adapters/fake-email.js";
import { FakePayments } from "@core/adapters/fake-payments.js";
import { InMemoryRepository } from "@core/adapters/in-memory-repository.js";
import { CHARGE_RUN_LEASE, runCharges, type ChargeRunReport } from "@core/charge-run.js";
import type { ProductWithOptions } from "@core/products.js";
import { addSupperClub } from "../../admin/subscribers-fixture";
import { GET } from "./route";

const services = vi.hoisted(() => ({
  repo: undefined as unknown as import("@core/adapters/in-memory-repository.js").InMemoryRepository,
  payments: undefined as unknown as import("@core/adapters/fake-payments.js").FakePayments,
  email: undefined as unknown as import("@core/adapters/fake-email.js").FakeEmail,
}));

vi.mock("../../services", () => ({
  getRepository: () => services.repo,
  getPayments: () => services.payments,
  getEmail: () => services.email,
  getSiteUrl: () => SITE_URL,
}));
vi.mock("@core/charge-run.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("@core/charge-run.js")>();
  return { ...real, runCharges: vi.fn(real.runCharges) };
});

const SECRET = "cron-secret-0123456789abcdefghij";
/** As long as SECRET, and not it. */
const SAME_LENGTH = "cron-secret-0123456789abcdefghiJ";
// With a trailing slash, so the account link shows it was joined with one slash.
const SITE_URL = "https://members.example.test/";
const ACCOUNT_URL = "https://members.example.test/account";
const SIGNED_UP_AT = new Date("2026-12-01T15:00:00.000Z");
/** Tuesday January 5, 07:00 in Cleveland: January 10's cutoff has passed, January 17's has not. */
const RUN_AT = new Date("2027-01-05T12:00:00.000Z");
const WEEK = "2027-01-10";

let product: ProductWithOptions;
let members = 0;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: RUN_AT });
  services.repo = new InMemoryRepository();
  services.payments = new FakePayments();
  services.email = new FakeEmail();
  product = addSupperClub(services.repo);
  vi.mocked(runCharges).mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const fire = (authorization?: string): Promise<Response> =>
  GET(new Request("http://localhost/api/charge-run", authorization === undefined ? {} : { headers: { authorization } }));

/** A member with a Square customer, their Supper Club signup's first week, January 3, paid, and a card on file. */
async function subscriber(): Promise<{ customerId: string; cardId: string; subscriptionId: string }> {
  const n = ++members;
  const address = `member-${n}@example.com`;
  const saved = await services.repo.saveAccount({ email: address, firstName: `Member${n}`, lastName: "Lovelace", phone: "216-555-0100", language: "en" });
  const customerId = services.payments.addCustomer({ email: address, createdAt: SIGNED_UP_AT, updatedAt: SIGNED_UP_AT }).id;
  await services.repo.setMemberSquareCustomer(saved.id, customerId);
  const signup = await services.repo.savePendingSignup({
    memberId: saved.id,
    productId: product.id,
    choices: Object.fromEntries(product.optionTypes.map((type) => [type.id, type.options[0]?.id ?? "no such option"])),
    firstChargeCents: 8000,
    weeklyCents: 8000,
    pickupDate: "2027-01-03",
    consentText: "I agree to a weekly charge until I cancel.",
    consentAt: SIGNED_UP_AT,
  });
  const card = await services.payments.saveCard({ customerId, sourceId: `cnon:card-${n}`, idempotencyKey: `card-${n}` });
  expect(await services.repo.confirmSignupRows(signup.ledgerId, `PAYMENT_SIGNUP_${n}`, 8000, SIGNED_UP_AT, card)).toBe("confirmed");
  return { customerId, cardId: card.id, subscriptionId: signup.subscriptionId };
}

/** Charges to `cardId` get no answer, and Square takes none of them; any other charge goes to the fake. */
function noAnswerFor(cardId: string): void {
  const real = services.payments.charge.bind(services.payments);
  vi.spyOn(services.payments, "charge").mockImplementation(async (input) =>
    input.sourceId === cardId ? Promise.reject(new DOMException("The operation timed out.", "TimeoutError")) : real(input),
  );
}

/** What the route's call resolved to, or what it threw: a returned 404 and Next's thrown notFound() differ here. */
const outcomeOf = (pending: Promise<Response>) =>
  pending.then(
    (response) => ({ returned: response instanceof Response, status: response.status }),
    (error: unknown) => ({ thrown: String(error) }),
  );

describe("AC1 — the secret fires the run", () => {
  it("AC1: with CRON_SECRET set and Authorization: Bearer <it>, the run settles the week on the app's payments and repository, and the response is 200 with its ChargeRunReport as JSON", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    const paid = await subscriber();
    const declined = await subscriber();
    const silent = await subscriber();
    services.payments.declineCard(declined.cardId, "GENERIC_DECLINE");
    noAnswerFor(silent.cardId);

    const response = await fire(`Bearer ${SECRET}`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type") ?? "no content-type").toMatch(/^application\/json\b/);
    const expected: ChargeRunReport = { weekOf: WEEK, enrolled: 3, paid: 1, declined: 1, unknown: 1, dropped: 0, skipped: false, locked: 0 };
    expect(await response.json()).toEqual(expected);
    expect(Object.fromEntries(services.payments.charges.map((charge) => [charge.customerId, charge.result.outcome]))).toEqual({
      [paid.customerId]: "paid",
      [declined.customerId]: "declined",
    });
    expect(services.repo.events().map((event) => event.kind).sort()).toEqual(["card_declined", "charge_outcome_unknown"]);
  });

  // Issue 254: the third event the route's run records. What the run does with it is src/charge-run.test.ts's.
  it("AC19 (issue 254): a card update's payment the run finds, whose card cannot be saved, is recorded as card_not_saved", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    const { customerId, subscriptionId } = await subscriber();
    const ledgerId = await services.repo.addLedgerRow(subscriptionId, WEEK, "declined", 8000);
    await services.repo.claimCardUpdate(subscriptionId, "cnon:card-update");
    await services.payments.charge({ customerId, sourceId: "cnon:card-update", amountCents: 8000, idempotencyKey: `${ledgerId}:2`, referenceId: ledgerId, customerInitiated: true });
    vi.spyOn(services.payments, "saveCard").mockRejectedValueOnce(new DOMException("The operation timed out.", "TimeoutError"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await fire(`Bearer ${SECRET}`);

    expect(await response.json()).toMatchObject({ paid: 1 });
    expect(services.repo.events().map((event) => event.kind)).toEqual(["card_not_saved"]);
  });

  it("AC1: the run is given the app's repository, payments and email, the site URL, the account link under it, now at the request, and a clock that reads the real time", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);

    await fire(`Bearer ${SECRET}`);

    expect(runCharges).toHaveBeenCalledTimes(1);
    const deps = vi.mocked(runCharges).mock.calls[0]?.[0];
    expect(deps?.repo).toBe(services.repo);
    expect(deps?.payments).toBe(services.payments);
    expect(deps?.email).toBe(services.email);
    expect(deps?.siteUrl).toBe(SITE_URL);
    expect(deps?.accountUrl).toBe(ACCOUNT_URL);
    expect(deps?.now).toEqual(RUN_AT);
    const later = new Date("2027-01-05T12:03:00.000Z");
    vi.setSystemTime(later);
    expect(deps?.clock()).toEqual(later);
  });

  it("AC1: CRON_SECRET is read at each request: changed after a first request, the old secret is 404 and the new one fires the run", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    expect((await fire(`Bearer ${SECRET}`)).status).toBe(200);

    vi.stubEnv("CRON_SECRET", SAME_LENGTH);
    expect((await fire(`Bearer ${SECRET}`)).status).toBe(404);
    expect((await fire(`Bearer ${SAME_LENGTH}`)).status).toBe(200);
    expect(runCharges).toHaveBeenCalledTimes(2);
  });
});

describe("AC2 — anything but the secret is 404, and the run never fires", () => {
  it.each([
    ["no Authorization header", undefined],
    ["a wrong secret of the same length", `Bearer ${SAME_LENGTH}`],
    ["a wrong secret longer than it, starting with it", `Bearer ${SECRET}x`],
    ["a wrong secret shorter than it", `Bearer ${SECRET.slice(0, -1)}`],
    ["the scheme in lowercase", `bearer ${SECRET}`],
    ["two spaces after the scheme", `Bearer  ${SECRET}`],
    ["another scheme", `Basic ${SECRET}`],
    ["the secret alone, with no scheme", SECRET],
  ])("AC2: with CRON_SECRET set, %s is 404 and the run never fires", async (_what, authorization) => {
    vi.stubEnv("CRON_SECRET", SECRET);
    await subscriber();

    const response = await fire(authorization);

    expect(response.status).toBe(404);
    expect(runCharges).not.toHaveBeenCalled();
    expect(services.payments.charges).toEqual([]);
  });

  it("AC2: with CRON_SECRET unset, Bearer undefined is 404 and the run never fires", async () => {
    vi.stubEnv("CRON_SECRET", undefined);

    expect((await fire("Bearer undefined")).status).toBe(404);
    expect(runCharges).not.toHaveBeenCalled();
  });

  it("AC2: an empty CRON_SECRET counts as unset: Bearer with nothing after it is 404 and the run never fires", async () => {
    vi.stubEnv("CRON_SECRET", "");

    expect((await fire("Bearer ")).status).toBe(404);
    expect(runCharges).not.toHaveBeenCalled();
  });

  it("AC2: the 404 is a Response the route returns, never Next's notFound() thrown", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);

    expect(await outcomeOf(fire(`Bearer ${SAME_LENGTH}`))).toEqual({ returned: true, status: 404 });
  });
});

// Issue 145, AC9: the decline email's link is Update your card. What the run does with the link it is given is
// src/charge-run.test.ts's; here, the link the route gives it.
describe("issue 145 — AC9: the decline email's link", () => {
  it("AC9: the run is given cardUrl, /account/card under the site URL, joined with one slash", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);

    await fire(`Bearer ${SECRET}`);

    expect(vi.mocked(runCharges).mock.calls[0]?.[0].cardUrl).toBe("https://members.example.test/account/card");
  });
});

// Issue 174, AC9: a firing that finds the lease held is still a success to the scheduler, so it never retries one with
// nothing to do. What a skipped firing leaves alone is src/charge-run.test.ts's.
describe("issue 174 — AC9: a skipped firing", () => {
  it("AC9: with the lease held by another firing, the route answers 200 with the skipped report as its body", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    await subscriber();
    await services.repo.claimRunLease(CHARGE_RUN_LEASE, RUN_AT, new Date(RUN_AT.getTime() + 30 * 60_000));

    const response = await fire(`Bearer ${SECRET}`);

    expect(response.status).toBe(200);
    const expected: ChargeRunReport = { weekOf: null, enrolled: 0, paid: 0, declined: 0, unknown: 0, dropped: 0, skipped: true, locked: 0 };
    expect(await response.json()).toEqual(expected);
  });
});
