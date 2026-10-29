import { CLOUDFLARE_RANGES } from "./cloudflare-ips.js";
import { ipInRange, parseCidr, parseIp, type ParsedCidr } from "./ip.js";

/**
 * The client address behind a request — the only place that reads one. The trusted-proxy rule
 * (DEC-002), as muster's `app/lib/client-ip.ts` applies it:
 *
 *  1. `x-forwarded-for` is the address that connected to Vercel, which overwrites it, so a visitor
 *     cannot choose it. Its first entry is the hop.
 *  2. Production sits behind Cloudflare, so that hop is a Cloudflare server and the visitor is
 *     `cf-connecting-ip`.
 *  3. A hop outside Cloudflare's ranges reached Vercel directly and already IS the visitor. A
 *     `cf-connecting-ip` on such a request is ignored: anyone can write it, and believing it would
 *     let them pick their own limit key.
 *
 * No usable address is null, never a stand-in: a null key is limited by nothing, while a
 * Cloudflare address used as a key would put every visitor behind that edge in one bucket.
 */
export function clientIpFrom(
  headers: { get(name: string): string | null },
  ranges: readonly string[] = CLOUDFLARE_RANGES,
): string | null {
  const hop = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const hopIp = parseIp(hop);
  if (!hop || !hopIp) return null;
  if (!parsedRanges(ranges).some((range) => ipInRange(hopIp, range))) return hop;

  const visitor = headers.get("cf-connecting-ip")?.trim();
  return visitor && parseIp(visitor) ? visitor : null;
}

const cache = new WeakMap<readonly string[], ParsedCidr[]>();

/** Parses a range list once per list. An unparseable entry is dropped; `client-ip.test.ts` checks the shipped list. */
function parsedRanges(ranges: readonly string[]): ParsedCidr[] {
  let parsed = cache.get(ranges);
  if (!parsed) {
    parsed = ranges.map(parseCidr).filter((range): range is ParsedCidr => range !== null);
    cache.set(ranges, parsed);
  }
  return parsed;
}
