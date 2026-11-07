// Issue 86: what `npm run test:square` does about the customers it makes. recordingCustomers notes
// them and deleteSandboxCustomers deletes them, here over FakePayments and a stubbed fetch. Nothing
// reaches the network: AC6, and the wiring in square-payments.sandbox.ts, are the real run.
import { readFileSync } from "node:fs";
import { inspect } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { FakePayments } from "./fake-payments.js";
import { rejectionOf, runPaymentsContract } from "./payments-contract.js";
import type { FetchLike } from "./resend-email.js";
import { deleteSandboxCustomers, recordingCustomers } from "./square-sandbox-cleanup.js";
import { SQUARE_BASE_URLS, SQUARE_TIMEOUT_MS, SQUARE_VERSION } from "./square-payments.js";
import { squareSandboxSettings } from "./square-sandbox-settings.js";

type Call = { url: string; init: Parameters<FetchLike>[1] };
type Reply = { ok: boolean; status: number; text(): Promise<string> };

/** A fetch that records each call and answers with `answers` in turn, repeating the last. An Error is a rejected request. */
function stubFetch(...answers: Array<Reply | Error>): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const answer = answers[Math.min(calls.length - 1, answers.length - 1)];
    if (!answer) throw new Error("stubFetch was given no answer");
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return { fetch, calls };
}

const reply = (status: number, body = "{}"): Reply => ({ ok: status >= 200 && status < 300, status, text: async () => body });

const TOKEN = "EAAAl-sandbox-token-SECRET-86ab";
const SETTINGS = squareSandboxSettings({ SQUARE_SANDBOX_ACCESS_TOKEN: TOKEN, SQUARE_SANDBOX_LOCATION_ID: "LSANDBOX123" });

const deleteUrl = (id: string): string => `${SQUARE_BASE_URLS.sandbox}/customers/${id}`;
const urlsOf = (calls: Call[]): string[] => calls.map((call) => call.url);

/** The message of the error cleanup rejected with. */
async function failureOf(ids: string[], fetch: FetchLike): Promise<string> {
  return ((await rejectionOf(deleteSandboxCustomers(SETTINGS, ids, { fetch }))) as Error).message;
}

const createInput = (name: string) => ({ email: `${name}@example.com`, idempotencyKey: `key-${name}` });

describe("AC1 — recordingCustomers notes what a run creates", () => {
  it("AC1: adds the id createCustomer resolves to", async () => {
    const created = new Set<string>();
    const customer = await recordingCustomers(new FakePayments(), created).createCustomer(createInput("ada"));
    expect([...created]).toEqual([customer.id]);
  });

  it("AC1: a repeated create with the same key counts once", async () => {
    const created = new Set<string>();
    const port = recordingCustomers(new FakePayments(), created);
    const first = await port.createCustomer(createInput("ada"));
    const second = await port.createCustomer(createInput("ada"));
    expect(second.id).toBe(first.id);
    expect([...created]).toEqual([first.id]);
  });

  it("AC1: a create that rejects rejects with the wrapped port's error and notes nothing", async () => {
    const fake = new FakePayments();
    const created = new Set<string>();
    const failure = new Error("Square is down");
    fake.failNext(failure);
    expect(await rejectionOf(recordingCustomers(fake, created).createCustomer(createInput("ada")))).toBe(failure);
    expect([...created]).toEqual([]);
  });

  it("AC1: another method that rejects rejects with the wrapped port's error", async () => {
    const fake = new FakePayments();
    const failure = new Error("Square is down");
    fake.failNext(failure);
    expect(await rejectionOf(recordingCustomers(fake, new Set()).findCustomersByEmail("ada@example.com"))).toBe(failure);
  });
});

// Every method, on a class that needs its `this`: the same suite `npm run test:square` runs through the wrapper.
runPaymentsContract("AC1 (issue 86): recordingCustomers over the fake", () => recordingCustomers(new FakePayments(), new Set()));

describe("AC1 — deleteSandboxCustomers deletes what it is given", () => {
  it("AC1: everything recordingCustomers noted is deleted, and a repeated create is deleted once", async () => {
    const created = new Set<string>();
    const port = recordingCustomers(new FakePayments(), created);
    const ada = await port.createCustomer(createInput("ada"));
    await port.createCustomer(createInput("ada"));
    const grace = await port.createCustomer(createInput("grace"));
    const { fetch, calls } = stubFetch(reply(200));
    await deleteSandboxCustomers(SETTINGS, [...created], { fetch });
    expect(urlsOf(calls)).toEqual([deleteUrl(ada.id), deleteUrl(grace.id)]);
  });

  it("AC1: each delete is a bodyless DELETE on the sandbox with the token and Square's version, and no version of the customer", async () => {
    const { fetch, calls } = stubFetch(reply(200));
    await deleteSandboxCustomers(SETTINGS, ["CUS_A"], { fetch });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(deleteUrl("CUS_A"));
    expect(calls[0]?.init.method).toBe("DELETE");
    expect(calls[0]?.init.headers).toMatchObject({ Authorization: `Bearer ${TOKEN}`, "Square-Version": SQUARE_VERSION });
    expect(calls[0]?.init.body).toBeUndefined();
  });

  it("AC1: the next delete starts after the previous one settles", async () => {
    const urls: string[] = [];
    let open = 0;
    let most = 0;
    const fetch: FetchLike = async (url) => {
      urls.push(url);
      open += 1;
      most = Math.max(most, open);
      await new Promise((resolve) => setTimeout(resolve, 1));
      open -= 1;
      return reply(200);
    };
    await deleteSandboxCustomers(SETTINGS, ["CUS_A", "CUS_B", "CUS_C"], { fetch });
    expect(urls).toHaveLength(3);
    expect(most).toBe(1);
  });

  it("AC1: with no fetch given it calls globalThis.fetch", async () => {
    const { fetch, calls } = stubFetch(reply(200));
    vi.stubGlobal("fetch", fetch);
    try {
      await deleteSandboxCustomers(SETTINGS, ["CUS_A"]);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(urlsOf(calls)).toEqual([deleteUrl("CUS_A")]);
  });

  describe("the timeout", () => {
    let timeout: MockInstance<typeof AbortSignal.timeout>;
    beforeEach(() => {
      timeout = vi.spyOn(AbortSignal, "timeout");
    });
    afterEach(() => {
      timeout.mockRestore();
    });

    it("AC1: every delete has its own AbortSignal.timeout(SQUARE_TIMEOUT_MS)", async () => {
      const { fetch, calls } = stubFetch(reply(200));
      await deleteSandboxCustomers(SETTINGS, ["CUS_A", "CUS_B"], { fetch });
      expect(timeout.mock.calls).toEqual([[SQUARE_TIMEOUT_MS], [SQUARE_TIMEOUT_MS]]);
      expect(calls[0]?.init.signal).toBe(timeout.mock.results[0]?.value);
      expect(calls[1]?.init.signal).toBe(timeout.mock.results[1]?.value);
    });
  });
});

describe("AC2 — only what the run created", () => {
  it("AC2: a customer already there, found and used through the port, is not deleted", async () => {
    const fake = new FakePayments();
    const seeded = fake.addCustomer({ email: "linked@example.com", createdAt: new Date(0), updatedAt: new Date(0) });
    const created = new Set<string>();
    const port = recordingCustomers(fake, created);
    await port.findCustomersByEmail("linked@example.com");
    await port.setCustomerReference({ customerId: seeded.id, referenceId: "member-1" });
    const ada = await port.createCustomer(createInput("ada"));
    const { fetch, calls } = stubFetch(reply(200));
    await deleteSandboxCustomers(SETTINGS, [...created], { fetch });
    expect(urlsOf(calls)).toEqual([deleteUrl(ada.id)]);
  });

  it("AC2: the only requests are the deletes of the ids given", async () => {
    const { fetch, calls } = stubFetch(reply(200));
    await deleteSandboxCustomers(SETTINGS, ["CUS_A", "CUS_B"], { fetch });
    expect(calls.map((call) => `${call.init.method} ${call.url}`)).toEqual([
      `DELETE ${deleteUrl("CUS_A")}`,
      `DELETE ${deleteUrl("CUS_B")}`,
    ]);
  });

  it("AC2: no ids means no requests", async () => {
    const { fetch, calls } = stubFetch(reply(200));
    await deleteSandboxCustomers(SETTINGS, [], { fetch });
    expect(calls).toEqual([]);
  });
});

describe("AC3 — a customer already gone", () => {
  const SQUARE_404 = JSON.stringify({ errors: [{ category: "INVALID_REQUEST_ERROR", code: "NOT_FOUND", detail: "Customer not found." }] });

  it("AC3: a 404, whatever its body, counts as deleted and the run carries on", async () => {
    const { fetch, calls } = stubFetch(reply(404, SQUARE_404), reply(404, ""), reply(200));
    await deleteSandboxCustomers(SETTINGS, ["CUS_A", "CUS_B", "CUS_C"], { fetch });
    expect(urlsOf(calls)).toEqual([deleteUrl("CUS_A"), deleteUrl("CUS_B"), deleteUrl("CUS_C")]);
  });

  it("AC3: a 404 beside a failed delete is not in the count of those left", async () => {
    const { fetch } = stubFetch(reply(404, SQUARE_404), reply(500), reply(200));
    expect(await failureOf(["CUS_A", "CUS_B", "CUS_C"], fetch)).toMatch(/\b1\b/);
  });
});

describe("AC4 — a delete that fails", () => {
  it.each([400, 401, 403, 429, 500, 503])("AC4: a %i is a failed delete, and the error names 1 left", async (status) => {
    const { fetch } = stubFetch(reply(status));
    expect(await failureOf(["CUS_A"], fetch)).toMatch(/\b1\b/);
  });

  it("AC4: cleanup tries the rest, then rejects naming how many are left", async () => {
    const { fetch, calls } = stubFetch(reply(500), reply(503), reply(200));
    const message = await failureOf(["CUS_A", "CUS_B", "CUS_C"], fetch);
    expect(urlsOf(calls)).toEqual([deleteUrl("CUS_A"), deleteUrl("CUS_B"), deleteUrl("CUS_C")]);
    expect(message).toMatch(/\b2\b/);
  });

  it("AC4: a rejected request is a failed delete, and cleanup carries on", async () => {
    const { fetch, calls } = stubFetch(new TypeError("fetch failed"), reply(200));
    const message = await failureOf(["CUS_A", "CUS_B"], fetch);
    expect(calls).toHaveLength(2);
    expect(message).toMatch(/\b1\b/);
  });

  it("AC4: a timeout is a failed delete, and cleanup carries on", async () => {
    const { fetch, calls } = stubFetch(new DOMException("The operation was aborted due to timeout", "TimeoutError"), reply(200));
    const message = await failureOf(["CUS_A", "CUS_B"], fetch);
    expect(calls).toHaveLength(2);
    expect(message).toMatch(/\b1\b/);
  });

  it("AC4: every delete failing still counts them all", async () => {
    const { fetch, calls } = stubFetch(new TypeError("fetch failed"));
    const message = await failureOf(["CUS_A", "CUS_B", "CUS_C"], fetch);
    expect(calls).toHaveLength(3);
    expect(message).toMatch(/\b3\b/);
  });

  it("AC4: the error gives the count only: no reply from Square, no id, no token", async () => {
    const detail = "Square-says-SECRET-detail";
    const rejected = new Error("Square-says-SECRET-rejection");
    const { fetch } = stubFetch(reply(500, JSON.stringify({ errors: [{ category: "API_ERROR", code: "INTERNAL", detail }] })), rejected);
    const error = await rejectionOf(deleteSandboxCustomers(SETTINGS, ["CUS_A", "CUS_B"], { fetch }));
    expect((error as Error).message).toMatch(/\b2\b/);
    // inspect() prints a `cause` too, so a reply cannot ride along on one.
    const shown = inspect(error, { depth: 5 });
    for (const secret of [detail, rejected.message, "API_ERROR", "CUS_A", "CUS_B", TOKEN]) expect(shown).not.toContain(secret);
  });
});

describe("AC5 — the port", () => {
  const source = readFileSync(new URL("../ports/payments.ts", import.meta.url), "utf8");
  const members = [...(source.split("export interface PaymentsPort {")[1]?.split("\n}")[0] ?? "").matchAll(/^ {2}(\w+)/gm)].map(
    (match) => match[1],
  );

  it("AC5: PaymentsPort has no member that deletes", () => {
    expect(members).toContain("createCustomer");
    expect(members.filter((name) => /delete|remove|destroy|purge|erase/i.test(name ?? ""))).toEqual([]);
  });
});
