// Issue 141, AC8: the menu emails page's two buttons, through an InMemoryRepository, with `next/navigation` faked so
// that `redirect` and `notFound` throw as the real ones do. Each verifies the m and t the form posts again before it
// writes. The token's edge cases are src/menu-email-link.test.ts's: one accepted and one refused case go through each
// action, and an unknown member.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryRepository } from "@core/adapters/in-memory-repository.js";
import { menuEmailToken } from "@core/menu-email-link.js";
import type { Member } from "@core/members.js";
import { turnMenuEmailsOff, turnMenuEmailsOn } from "./actions";

const services = vi.hoisted(() => ({
  repo: undefined as unknown as import("@core/adapters/in-memory-repository.js").InMemoryRepository,
  secret: "test-session-secret-that-is-long-enough-0123456789",
}));

vi.mock("next/navigation", async () => ({
  redirect: (await import("../screen-test-helpers")).throwingRedirect,
  notFound: () => {
    throw Object.assign(new Error("NEXT_NOT_FOUND"), { notFound: true });
  },
}));
vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("../services", () => ({
  getRepository: () => services.repo,
  getEmail: () => {
    throw new Error("the menu emails buttons have no reason to send email");
  },
  getSessionSecret: () => services.secret,
}));

const UNKNOWN_UUID = "00000000-0000-4000-8000-000000000000";

let ada: Member;

beforeEach(async () => {
  services.repo = new InMemoryRepository();
  ada = await services.repo.saveAccount({ email: "ada@example.com", firstName: "Ada", lastName: "Lovelace", phone: "216-555-0100", language: "en" });
});

const form = (fields: Record<string, string>): FormData => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.append(name, value);
  return data;
};
const valid = (memberId: string = ada.id) => ({ m: memberId, t: menuEmailToken(memberId, services.secret) });

/** Where the action ended: the redirect's path and query, Next's not-found page, or neither. */
const outcomeOf = async (pending: Promise<unknown>): Promise<{ redirect: string } | "not found" | "returned"> => {
  try {
    await pending;
  } catch (e) {
    const url = (e as { redirectTo?: unknown } | null)?.redirectTo;
    if (typeof url === "string") return { redirect: url };
    if ((e as { notFound?: unknown } | null)?.notFound === true) return "not found";
    throw e;
  }
  return "returned";
};

/** The page the email's link lands on, for the member: /menu-emails?m=<id>&t=<token>, as path, m and t. */
const landedOn = (outcome: { redirect: string } | "not found" | "returned") => {
  if (typeof outcome === "string") return outcome;
  const url = new URL(outcome.redirect, "http://haul.test");
  return { path: url.pathname, m: url.searchParams.get("m"), t: url.searchParams.get("t") };
};

const preference = async (): Promise<boolean | undefined> => (await services.repo.findMemberById(ada.id))?.menuEmails;

describe("AC8 — Turn menu emails back on", () => {
  it("AC8: with a valid m and t it turns the member's menu emails on and lands back on the page for them", async () => {
    await services.repo.setMenuEmails(ada.id, false);
    expect(landedOn(await outcomeOf(turnMenuEmailsOn(form(valid()))))).toEqual({ path: "/menu-emails", ...valid() });
    expect(await preference()).toBe(true);
  });

  it("AC8: another member's token is Next's not-found page and writes nothing", async () => {
    await services.repo.setMenuEmails(ada.id, false);
    const grace = await services.repo.createMember({ email: "grace@example.com" });
    expect(await outcomeOf(turnMenuEmailsOn(form({ m: ada.id, t: menuEmailToken(grace.id, services.secret) })))).toBe("not found");
    expect(await preference()).toBe(false);
    expect((await services.repo.findMemberById(grace.id))?.menuEmails).toBe(true);
  });

  it("AC8: a token that matches an id no member has is Next's not-found page", async () => {
    expect(await outcomeOf(turnMenuEmailsOn(form(valid(UNKNOWN_UUID))))).toBe("not found");
  });
});

describe("AC8 — Turn them off", () => {
  it("AC8: with a valid m and t it turns the member's menu emails off and lands back on the page for them", async () => {
    expect(landedOn(await outcomeOf(turnMenuEmailsOff(form(valid()))))).toEqual({ path: "/menu-emails", ...valid() });
    expect(await preference()).toBe(false);
  });

  it("AC8: a tampered token is Next's not-found page and writes nothing", async () => {
    const { t } = valid();
    expect(await outcomeOf(turnMenuEmailsOff(form({ m: ada.id, t: `${t.slice(0, -1)}${t.endsWith("A") ? "B" : "A"}` })))).toBe("not found");
    expect(await preference()).toBe(true);
  });

  it("AC8: a token that matches an id no member has is Next's not-found page", async () => {
    expect(await outcomeOf(turnMenuEmailsOff(form(valid(UNKNOWN_UUID))))).toBe("not found");
  });
});
