// Issue 9, AC22: clientIpFrom — believe cf-connecting-ip only behind a Cloudflare hop (DEC-002),
// and the shipped range list is all CIDRs.
import { isIP } from "node:net";
import { describe, expect, it } from "vitest";
import { clientIpFrom } from "./client-ip.js";
import { CLOUDFLARE_RANGES } from "./cloudflare-ips.js";

const RANGES = ["173.245.48.0/20", "2400:cb00::/32"];
const CF_HOP = "173.245.48.5";
const CF_HOP_V6 = "2400:cb00:2049::1";
const headers = (h: Record<string, string>) => new Headers(h);

describe("AC22 (issue 9) — clientIpFrom", () => {
  it("AC22: an x-forwarded-for outside the ranges is the client", () => {
    expect(clientIpFrom(headers({ "x-forwarded-for": "203.0.113.9" }), RANGES)).toBe("203.0.113.9");
  });

  it("AC22: an x-forwarded-for outside the ranges wins over cf-connecting-ip, which a client can write", () => {
    expect(
      clientIpFrom(headers({ "x-forwarded-for": "203.0.113.9", "cf-connecting-ip": "198.51.100.7" }), RANGES),
    ).toBe("203.0.113.9");
  });

  it.each([
    ["a list", "203.0.113.9, 10.0.0.1", "203.0.113.9"],
    ["a list with spaces around the first entry", "  203.0.113.9  ,10.0.0.1", "203.0.113.9"],
    ["an IPv6 first entry", "2001:db8::7, 10.0.0.1", "2001:db8::7"],
  ])("AC22: the first comma-separated entry of %s, trimmed", (_what, xff, ip) => {
    expect(clientIpFrom(headers({ "x-forwarded-for": xff }), RANGES)).toBe(ip);
  });

  it("AC22: a Cloudflare hop gives cf-connecting-ip", () => {
    expect(
      clientIpFrom(headers({ "x-forwarded-for": CF_HOP, "cf-connecting-ip": "198.51.100.7" }), RANGES),
    ).toBe("198.51.100.7");
  });

  it("AC22: a Cloudflare IPv6 hop gives an IPv6 cf-connecting-ip", () => {
    expect(
      clientIpFrom(headers({ "x-forwarded-for": CF_HOP_V6, "cf-connecting-ip": "2001:db8::5" }), RANGES),
    ).toBe("2001:db8::5");
  });

  it("AC22: a Cloudflare hop first in a list gives cf-connecting-ip", () => {
    expect(
      clientIpFrom(headers({ "x-forwarded-for": `${CF_HOP}, 10.0.0.1`, "cf-connecting-ip": "198.51.100.7" }), RANGES),
    ).toBe("198.51.100.7");
  });

  it.each([
    ["no x-forwarded-for", {}],
    ["no x-forwarded-for, even with a cf-connecting-ip", { "cf-connecting-ip": "198.51.100.7" }],
    ["an x-forwarded-for whose first entry is not an IP", { "x-forwarded-for": "unknown, 203.0.113.9" }],
    ["an empty x-forwarded-for", { "x-forwarded-for": "" }],
    ["a Cloudflare hop with no cf-connecting-ip", { "x-forwarded-for": CF_HOP }],
    ["a Cloudflare hop with a cf-connecting-ip that is not an IP", { "x-forwarded-for": CF_HOP, "cf-connecting-ip": "junk" }],
  ])("AC22: null for %s", (_what, h: Record<string, string>) => {
    expect(clientIpFrom(headers(h), RANGES)).toBeNull();
  });

  it("AC22: ranges default to CLOUDFLARE_RANGES", () => {
    // 173.245.48.0/20 is the first of Cloudflare's published IPv4 ranges.
    expect(
      clientIpFrom(headers({ "x-forwarded-for": CF_HOP, "cf-connecting-ip": "198.51.100.7" })),
    ).toBe("198.51.100.7");
    expect(clientIpFrom(headers({ "x-forwarded-for": "203.0.113.9", "cf-connecting-ip": "198.51.100.7" }))).toBe(
      "203.0.113.9",
    );
  });
});

/** `<address>/<prefix>`, the address an IP and the prefix an integer its family allows. */
function isCidr(range: string): boolean {
  const match = /^([^/]+)\/(\d{1,3})$/.exec(range);
  if (!match) return false;
  const family = isIP(match[1] ?? "");
  const prefix = Number(match[2]);
  return (family === 4 && prefix <= 32) || (family === 6 && prefix <= 128);
}

describe("AC22 (issue 9) — the shipped Cloudflare range list", () => {
  it("AC22: is not empty", () => {
    expect(CLOUDFLARE_RANGES.length).toBeGreaterThan(0);
  });

  it.each([...CLOUDFLARE_RANGES])("AC22: %s parses as a CIDR", (range) => {
    expect(isCidr(range)).toBe(true);
  });
});
