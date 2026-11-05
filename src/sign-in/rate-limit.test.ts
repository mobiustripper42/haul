// Issue 9, AC20, AC21 and AC23: takeRateLimit over MemorySignInStore, and limitKeyFor.
import { describe, expect, it } from "vitest";
import { MemorySignInStore } from "./memory-store.js";
import { limitKeyFor, refusalFrom, takeRateLimit, type RateLimitPolicy } from "./rate-limit.js";
import type { RateLimitStore } from "./store.js";

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

const POLICY: RateLimitPolicy = { bucket: "test-bucket", limit: 20, windowMs: HOUR, failOpen: true };
// 14:25:30 UTC: the hour ends at 15:00:00, 34 min 30 s on.
const T0 = new Date("2026-10-28T14:25:30.000Z");
const HOUR_START = new Date("2026-10-28T14:00:00.000Z");
const HOUR_END = new Date("2026-10-28T15:00:00.000Z");

/** A store that records each incrementRateLimit call and passes it on, or throws when told to. */
function recording(fail?: Error) {
  const inner = new MemorySignInStore();
  const calls: Array<{ bucket: string; key: string; windowStart: Date }> = [];
  const store: RateLimitStore = {
    incrementRateLimit: async (bucket, key, windowStart, expiresAt, now) => {
      calls.push({ bucket, key, windowStart });
      if (fail) throw fail;
      return inner.incrementRateLimit(bucket, key, windowStart, expiresAt, now);
    },
  };
  return { store, calls };
}

describe("AC20 (issue 9) — takeRateLimit", () => {
  it("AC20: the first 20 calls for a key in a clock hour are allowed and the 21st is refused with retryAfterMs = the end of the hour minus now", async () => {
    const store = new MemorySignInStore();
    for (let i = 0; i < 20; i++) {
      const now = new Date(T0.getTime() + i * SECOND);
      expect(await takeRateLimit({ store, now }, POLICY, "203.0.113.7")).toEqual({ allowed: true });
    }
    const now = new Date(T0.getTime() + 20 * SECOND);
    expect(await takeRateLimit({ store, now }, POLICY, "203.0.113.7")).toEqual({
      allowed: false,
      retryAfterMs: HOUR_END.getTime() - now.getTime(),
      first: true,
      windowStart: HOUR_START,
    });
  });

  it("AC20: windows are aligned as floor(now / windowMs) * windowMs, whatever minute the first call lands on", async () => {
    const { store, calls } = recording();
    await takeRateLimit({ store, now: T0 }, POLICY, "203.0.113.7");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.bucket).toBe("test-bucket");
    expect(calls[0]?.key).toBe("203.0.113.7");
    expect(calls[0]?.windowStart.getTime()).toBe(HOUR_START.getTime());
  });

  it("AC20: retryAfterMs follows the aligned window for a window that isn't an hour", async () => {
    const store = new MemorySignInStore();
    const policy: RateLimitPolicy = { bucket: "seven", limit: 1, windowMs: 7 * MINUTE, failOpen: true };
    const now = new Date(T0.getTime());
    const windowEnd = (Math.floor(now.getTime() / policy.windowMs) + 1) * policy.windowMs;
    await takeRateLimit({ store, now }, policy, "203.0.113.7");
    expect(await takeRateLimit({ store, now }, policy, "203.0.113.7")).toEqual({
      allowed: false,
      retryAfterMs: windowEnd - now.getTime(),
      first: true,
      windowStart: new Date(windowEnd - policy.windowMs),
    });
  });

  it("AC20: the next hour allows again", async () => {
    const store = new MemorySignInStore();
    for (let i = 0; i < 21; i++) await takeRateLimit({ store, now: T0 }, POLICY, "203.0.113.7");
    expect(await takeRateLimit({ store, now: new Date(HOUR_END.getTime() - 1) }, POLICY, "203.0.113.7")).toMatchObject({
      allowed: false,
    });
    expect(await takeRateLimit({ store, now: HOUR_END }, POLICY, "203.0.113.7")).toEqual({ allowed: true });
  });

  it("AC20: keys are independent", async () => {
    const store = new MemorySignInStore();
    for (let i = 0; i < 21; i++) await takeRateLimit({ store, now: T0 }, POLICY, "203.0.113.7");
    expect(await takeRateLimit({ store, now: T0 }, POLICY, "203.0.113.7")).toMatchObject({ allowed: false });
    expect(await takeRateLimit({ store, now: T0 }, POLICY, "198.51.100.4")).toEqual({ allowed: true });
  });

  it("AC20: a null key is always allowed and touches no repository", async () => {
    const { store, calls } = recording(new Error("must not be called"));
    const strict: RateLimitPolicy = { ...POLICY, limit: 1, failOpen: false };
    for (let i = 0; i < 5; i++) {
      expect(await takeRateLimit({ store, now: T0 }, strict, null)).toEqual({ allowed: true });
    }
    expect(calls).toEqual([]);
  });
});

describe("AC21 (issue 9) — takeRateLimit when the counter throws", () => {
  it("AC21: a failOpen policy allows, and onFailure is told, naming the bucket", async () => {
    const { store } = recording(new Error("connection refused"));
    const failures: string[] = [];
    const decision = await takeRateLimit(
      { store, now: T0, onFailure: (message) => failures.push(message) },
      { bucket: "open-bucket", limit: 20, windowMs: HOUR, failOpen: true },
      "203.0.113.7",
    );
    expect(decision).toEqual({ allowed: true });
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("open-bucket");
  });

  it("AC21: a policy that does not fail open refuses with retryAfterMs = windowMs, and onFailure is told, naming the bucket", async () => {
    const { store } = recording(new Error("connection refused"));
    const failures: string[] = [];
    const decision = await takeRateLimit(
      { store, now: T0, onFailure: (message) => failures.push(message) },
      { bucket: "closed-bucket", limit: 20, windowMs: 15 * MINUTE, failOpen: false },
      "203.0.113.7",
    );
    // 14:25:30 falls in the 15-minute window that starts at 14:15:00.
    expect(decision).toEqual({
      allowed: false,
      retryAfterMs: 15 * MINUTE,
      first: false,
      windowStart: new Date("2026-10-28T14:15:00.000Z"),
    });
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("closed-bucket");
  });

  it.each([true, false])("AC21: without onFailure it still decides, and does not throw (failOpen %s)", async (failOpen) => {
    const { store } = recording(new Error("connection refused"));
    const decision = await takeRateLimit({ store, now: T0 }, { ...POLICY, failOpen }, "203.0.113.7");
    expect(decision.allowed).toBe(failOpen);
  });
});

// Issue 34, AC4: a refusal says whether it is the window's first, and which window it fell in.
describe("AC4 — a refusal names the window's first, and the window", () => {
  it("AC4: only the call that takes the count to limit + 1 is first; the 22nd and 23rd are refused with first false and the same aligned windowStart", async () => {
    const store = new MemorySignInStore();
    for (let i = 0; i < 20; i++) await takeRateLimit({ store, now: T0 }, POLICY, "203.0.113.7");
    const refusals = [];
    for (let i = 0; i < 3; i++) {
      const now = new Date(T0.getTime() + i * MINUTE);
      refusals.push(await takeRateLimit({ store, now }, POLICY, "203.0.113.7"));
    }
    expect(refusals.map((r) => (r.allowed ? "allowed" : { first: r.first, windowStart: r.windowStart }))).toEqual([
      { first: true, windowStart: HOUR_START },
      { first: false, windowStart: HOUR_START },
      { first: false, windowStart: HOUR_START },
    ]);
  });

  it("AC4: the first refusal in the next window is first again, with that window's start", async () => {
    const store = new MemorySignInStore();
    for (let i = 0; i < 22; i++) await takeRateLimit({ store, now: T0 }, POLICY, "203.0.113.7");
    const next = new Date(HOUR_END.getTime() + 5 * MINUTE);
    for (let i = 0; i < 20; i++) await takeRateLimit({ store, now: next }, POLICY, "203.0.113.7");
    expect(await takeRateLimit({ store, now: next }, POLICY, "203.0.113.7")).toEqual({
      allowed: false,
      retryAfterMs: 55 * MINUTE,
      first: true,
      windowStart: HOUR_END,
    });
  });
});

// Issue 55: the refusal shape requestSignInCode and requestAccountCode share.
describe("AC12 (issue 55) — refusalFrom", () => {
  const refused = (first: boolean) => ({ allowed: false, retryAfterMs: 1000, first, windowStart: HOUR_START }) as const;

  it("AC12: a window's first refusal, with a key, names the bucket, the key and the window's start", () => {
    expect(refusalFrom(refused(true), "sign-in-request", "203.0.113.7")).toEqual({
      bucket: "sign-in-request",
      key: "203.0.113.7",
      windowStart: HOUR_START,
    });
  });

  it("AC12: a later refusal in the window is null", () => {
    expect(refusalFrom(refused(false), "sign-in-request", "203.0.113.7")).toBeNull();
  });

  it("AC12: a refusal with no key is null", () => {
    expect(refusalFrom(refused(true), "sign-in-request", null)).toBeNull();
  });

  it("AC12: an allowed decision is null", () => {
    expect(refusalFrom({ allowed: true }, "sign-in-request", "203.0.113.7")).toBeNull();
  });
});

describe("AC23 (issue 9) — limitKeyFor", () => {
  it.each([
    ["IPv4 as is", "203.0.113.7", "203.0.113.7"],
    ["IPv4-mapped IPv6, unwrapped", "::ffff:203.0.113.7", "203.0.113.7"],
    ["IPv6 on its /64, lowercased, without leading zeros", "2001:0DB8:0000:0002:aaaa:bbbb:cccc:dddd", "2001:db8:0:2::/64"],
    ["IPv6 with :: expanded into its first four groups", "2001:db8::1", "2001:db8:0:0::/64"],
  ])("AC23: %s — %j → %j", (_what, raw, key) => {
    expect(limitKeyFor(raw)).toBe(key);
  });

  it("AC23: two IPv6 addresses in one /64 share a key", () => {
    expect(limitKeyFor("2001:db8:0:2::1")).toBe(limitKeyFor("2001:db8:0:2:ffff:ffff:ffff:ffff"));
  });

  it.each([null, undefined, "", "not-an-ip"])("AC23: %j → null", (raw) => {
    expect(limitKeyFor(raw)).toBeNull();
  });
});
