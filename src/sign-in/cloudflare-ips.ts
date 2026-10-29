/**
 * Cloudflare's published address ranges — the list `client-ip.ts` checks the hop against before it
 * believes `cf-connecting-ip` (DEC-002).
 *
 * Copied by hand from https://www.cloudflare.com/ips (IPv4 and IPv6), which Cloudflare says to
 * re-check regularly: this is muster's copy, `muster/app/lib/cloudflare-ips.ts`, with its date. When
 * the list goes stale a new Cloudflare edge address is not recognized, and every visitor behind it
 * shares that one address's limit. Re-copy the list and the date together.
 */

/** The day the list below was copied from cloudflare.com/ips. */
export const CLOUDFLARE_RANGES_COPIED = "2026-09-30";

export const CLOUDFLARE_RANGES: readonly string[] = [
  // IPv4 — cloudflare.com/ips-v4
  "173.245.48.0/20",
  "103.21.244.0/22",
  "103.22.200.0/22",
  "103.31.4.0/22",
  "141.101.64.0/18",
  "108.162.192.0/18",
  "190.93.240.0/20",
  "188.114.96.0/20",
  "197.234.240.0/22",
  "198.41.128.0/17",
  "162.158.0.0/15",
  "104.16.0.0/13",
  "104.24.0.0/14",
  "172.64.0.0/13",
  "131.0.72.0/22",
  // IPv6 — cloudflare.com/ips-v6
  "2400:cb00::/32",
  "2606:4700::/32",
  "2803:f800::/32",
  "2405:b500::/32",
  "2405:8100::/32",
  "2a06:98c0::/29",
  "2c0f:f248::/32",
];
