// Issue 141, AC8: the email's off link, `GET /menu-emails/off?m=<id>&t=<token>`, a route handler that writes the
// preference off and sends the member to the page, which only reads. `next/navigation` is faked so that `redirect` and
// `notFound` throw as the real ones do; a redirect is read whether the handler throws it or returns it. The token's edge
// cases are src/menu-email-link.test.ts's: one accepted and one refused case go through here, and an unknown member.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryRepository } from "@core/adapters/in-memory-repository.js";
import { menuEmailToken } from "@core/menu-email-link.js";
import type { Member } from "@core/members.js";
import { GET } from "./route";

const services = vi.hoisted(() => ({
  repo: undefined as unknown as import("@core/adapters/in-memory-repository.js").InMemoryRepository,
  secret: "test-session-secret-that-is-long-enough-0123456789",
}));

vi.mock("next/navigation", async () => ({
  redirect: (await import("../../screen-test-helpers")).throwingRedirect,
  notFound: () => {
    throw Object.assign(new Error("NEXT_NOT_FOUND"), { notFound: true });
  },
}));
vi.mock("../../services", () => ({
  getRepository: () => services.repo,
  getEmail: () => {
    throw new Error("the off link has no reason to send email");
  },
  getSessionSecret: () => services.secret,
  getSiteUrl: () => "https://members.example.test",
}));

const UNKNOWN_UUID = "00000000-0000-4000-8000-000000000000";

let ada: Member;

beforeEach(async () => {
  services.repo = new InMemoryRepository();
  ada = await services.repo.saveAccount({ email: "ada@example.com", firstName: "Ada", lastName: "Lovelace", phone: "216-555-0100", language: "en" });
});

const valid = (memberId: string = ada.id) => ({ m: memberId, t: menuEmailToken(memberId, services.secret) });
const open = (query: Record<string, string>) => GET(new Request(`https://members.example.test/menu-emails/off?${new URLSearchParams(query)}`));

/** Where the request ended: a redirect, thrown or returned, as path, m and t; Next's not-found page; or another response. */
const outcomeOf = async (pending: Promise<Response>) => {
  let location: string | null;
  try {
    const response = await pending;
    location = response.status >= 300 && response.status < 400 ? response.headers.get("location") : null;
    if (location === null) return { status: response.status };
  } catch (e) {
    if ((e as { notFound?: unknown } | null)?.notFound === true) return "not found";
    const url = (e as { redirectTo?: unknown } | null)?.redirectTo;
    if (typeof url !== "string") throw e;
    location = url;
  }
  const url = new URL(location, "https://members.example.test");
  return { path: url.pathname, m: url.searchParams.get("m"), t: url.searchParams.get("t") };
};

const preference = async (member: Member = ada): Promise<boolean | undefined> => (await services.repo.findMemberById(member.id))?.menuEmails;

describe("AC8 — the off link", () => {
  it("AC8: a valid link turns the member's menu emails off and lands on /menu-emails with the same m and t", async () => {
    expect(await outcomeOf(open(valid()))).toEqual({ path: "/menu-emails", ...valid() });
    expect(await preference()).toBe(false);
  });

  it("AC8: opened twice it stays off and lands on the same page", async () => {
    await outcomeOf(open(valid()));
    expect(await outcomeOf(open(valid()))).toEqual({ path: "/menu-emails", ...valid() });
    expect(await preference()).toBe(false);
  });

  it("AC8: another member's token is Next's not-found page and writes nothing, to either member", async () => {
    const grace = await services.repo.createMember({ email: "grace@example.com" });
    expect(await outcomeOf(open({ m: ada.id, t: menuEmailToken(grace.id, services.secret) }))).toBe("not found");
    expect([await preference(), await preference(grace)]).toEqual([true, true]);
  });

  it("AC8: a token that matches an id no member has is Next's not-found page", async () => {
    expect(await outcomeOf(open(valid(UNKNOWN_UUID)))).toBe("not found");
  });

  it("AC8: a link with no token is Next's not-found page and writes nothing", async () => {
    expect(await outcomeOf(open({ m: ada.id }))).toBe("not found");
    expect(await preference()).toBe(true);
  });
});
