import { formatIp, parseIp, unwrapMappedV4 } from "./ip.js";
import type { RateLimitStore } from "./store.js";

export interface RateLimitPolicy {
  bucket: string;
  limit: number;
  windowMs: number;
  /** When the counter itself fails: true lets the request through, false refuses it. */
  failOpen: boolean;
}

export type RateLimitDecision = { allowed: true } | { allowed: false; retryAfterMs: number };

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

  let hits: number;
  try {
    hits = await deps.store.incrementRateLimit(policy.bucket, key, new Date(startMs), new Date(endMs), deps.now);
  } catch (e) {
    deps.onFailure?.(
      `rate limit "${policy.bucket}" could not count — ${policy.failOpen ? "allowed" : "refused"}: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
    return policy.failOpen ? { allowed: true } : { allowed: false, retryAfterMs: policy.windowMs };
  }
  return hits <= policy.limit ? { allowed: true } : { allowed: false, retryAfterMs: endMs - nowMs };
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
