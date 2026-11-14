// Issue 141, AC8: the menu email's off link, the member id and a token signed with the session secret (no column, no
// expiry). The token's edge cases live here; the route handler, the page and the two actions each take one accepted
// and one refused case through it.
import { describe, expect, it } from "vitest";
import { menuEmailOffLink, menuEmailToken, menuEmailTokenMatches } from "./menu-email-link.js";

const SECRET = "s".repeat(32) + "-test-secret";
const OTHER_SECRET = "o".repeat(32) + "-other-secret";
const ADA = "6f1c2a52-8f7e-4c3b-9d0a-1b2c3d4e5f60";
const GRACE = "0b9e7d1c-3a5f-4e2d-8c1b-9a8f7e6d5c4b";
const BASE64URL = /^[A-Za-z0-9_-]+$/;

/** The link as a URL; one that does not parse reads as a link to nowhere, so a test fails on what it asserts. */
const urlOf = (link: string): URL => (URL.canParse(link) ? new URL(link) : new URL("http://not.a.link/"));

/** The token with its last character swapped for another base64url character. */
const tampered = (token: string): string => `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;

describe("AC8 — menuEmailToken and menuEmailTokenMatches", () => {
  it("AC8: a member's token is a non-empty base64url string, and it matches that member under that secret", () => {
    const token = menuEmailToken(ADA, SECRET);
    expect(token).toMatch(BASE64URL);
    expect(menuEmailTokenMatches(ADA, token, SECRET)).toBe(true);
  });

  it("AC8: it is the same token every time: it carries no time, so it never expires", () => {
    expect(menuEmailToken(ADA, SECRET)).toBe(menuEmailToken(ADA, SECRET));
  });

  it("AC8: two members get two tokens, and one secret's token is not another's", () => {
    expect(menuEmailToken(ADA, SECRET)).not.toBe(menuEmailToken(GRACE, SECRET));
    expect(menuEmailToken(ADA, SECRET)).not.toBe(menuEmailToken(ADA, OTHER_SECRET));
  });

  it.each([
    ["another member's token", () => menuEmailToken(GRACE, SECRET)],
    ["the token signed with another secret", () => menuEmailToken(ADA, OTHER_SECRET)],
    ["the token with one character changed", () => tampered(menuEmailToken(ADA, SECRET))],
    ["the token one character short", () => menuEmailToken(ADA, SECRET).slice(0, -1)],
    ["the token one character long", () => `${menuEmailToken(ADA, SECRET)}A`],
    ["an empty token", () => ""],
  ])("AC8: for Ada, %s does not match, and nothing throws", (_what, token) => {
    expect(menuEmailTokenMatches(ADA, token(), SECRET)).toBe(false);
  });
});

describe("AC8 — menuEmailOffLink", () => {
  it.each(["https://members.example.test", "https://members.example.test/"])(
    "AC8: from %s it is /menu-emails/off under the site, with one slash, naming the member as m and carrying the token as t",
    (siteUrl) => {
      const link = urlOf(menuEmailOffLink(siteUrl, ADA, SECRET));
      expect(`${link.origin}${link.pathname}`).toBe("https://members.example.test/menu-emails/off");
      expect([...link.searchParams.keys()].sort()).toEqual(["m", "t"]);
      expect(link.searchParams.get("m")).toBe(ADA);
      expect(link.searchParams.get("t")).toBe(menuEmailToken(ADA, SECRET));
    },
  );

  it("AC8: the link's token matches its member under the secret it was made with, and no other", () => {
    const link = urlOf(menuEmailOffLink("https://members.example.test", ADA, SECRET));
    const token = link.searchParams.get("t") ?? "no token";
    expect(menuEmailTokenMatches(ADA, token, SECRET)).toBe(true);
    expect(menuEmailTokenMatches(ADA, token, OTHER_SECRET)).toBe(false);
  });
});
