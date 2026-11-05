import { formatIp, parseIp, unwrapMappedV4 } from "./ip.js";
import type { RateLimitStore } from "./store.js";

export interface RateLimitPolicy {
  bucket: string;
  limit: number;
  windowMs: number;
  /** When the counter itself fails: true lets the request through, false refuses it. */
  failOpen: boolean;
}

/**
 * A refusal says which window it fell in and whether it is that window's first (the call that takes
 * the count to `limit + 1`), so a caller can record one event per window, not one per refused call.
 */
export type RateLimitDecision =
  | { allowed: true }
  | { allowed: false; retryAfterMs: number; first: boolean; windowStart: Date };

/** A refusal: the bucket, the client's limiter key and the start of the window it was refused in. */
export type RateLimitRefusal = { bucket: string; key: string; windowStart: Date };

/**
 * Counts this call against `key` in the clock window it falls in (windows aligned to
 * `floor(now / windowMs) * windowMs`) and says whether it may proceed.
 *
 * A null key — no trustworthy client address — limits nothing and writes nothing. It is never
 * counted under a shared key: one bucket for everyone would let one abuser lock out every visitor.
 */
export async function takeRateLimit(
  deps: { store: RateLimitStore; now: Date; onFailure?: (message: string) => void },
  policy: RateLimitPolicy,
  key: string | null,
): Promise<RateLimitDecision> {
  if (key === null) return { allowed: true };

  const nowMs = deps.now.getTime();
  const startMs = Math.floor(nowMs / policy.windowMs) * policy.windowMs;
  const endMs = startMs + policy.windowMs;
  const windowStart = new Date(startMs);

  let hits: number;
  try {
    hits = await deps.store.incrementRateLimit(policy.bucket, key, windowStart, new Date(endMs), deps.now);
  } catch (e) {
    deps.onFailure?.(
      `rate limit "${policy.bucket}" could not count — ${policy.failOpen ? "allowed" : "refused"}: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
    return policy.failOpen
      ? { allowed: true }
      : { allowed: false, retryAfterMs: policy.windowMs, first: false, windowStart };
  }
  return hits <= policy.limit
    ? { allowed: true }
    : { allowed: false, retryAfterMs: endMs - nowMs, first: hits === policy.limit + 1, windowStart };
}

/**
 * The refusal to report for a decision: only a window's first refusal, and only a counted request,
 * which has a key. Null for an allowed decision, a later refusal and a request with no key.
 */
export function refusalFrom(decision: RateLimitDecision, bucket: string, key: string | null): RateLimitRefusal | null {
  return !decision.allowed && decision.first && key !== null ? { bucket, key, windowStart: decision.windowStart } : null;
}

/**
 * A client address as a limiter key, or null when it is not an address.
 *
 * IPv4 is kept whole; an IPv4 address written in IPv6 form is unwrapped to it first. IPv6 is keyed
 * on its /64: one home, office or phone network is handed a whole /64, so a single client can walk
 * the low 64 bits and look like billions of addresses.
 */
export function limitKeyFor(raw: string | null | undefined): string | null {
  const parsed = parseIp(raw);
  if (!parsed) return null;
  const ip = unwrapMappedV4(parsed);
  if (ip.version === 4) return formatIp(ip);
  const network = formatIp({ version: 6, value: (ip.value >> 64n) << 64n });
  return `${network.split(":").slice(0, 4).join(":")}::/64`;
}
