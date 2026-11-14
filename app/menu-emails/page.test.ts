// Issue 141, AC8: the menu emails page, `await MenuEmails({ searchParams })` with `next/headers` faked and the
// composition root mocked, as app/admin/members/[subscription]/page.test.ts renders its page. The page only reads: the
// off link's write is ./off/route.ts's (./off/route.test.ts) and the buttons' are ./actions.ts's (./actions.test.ts). The
// token's edge cases are src/menu-email-link.test.ts's: one accepted and one refused case go through here, and an
// unknown member. The page's words are new copy, typed once here.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryRepository } from "@core/adapters/in-memory-repository.js";
import { menuEmailToken } from "@core/menu-email-link.js";
import type { Member } from "@core/members.js";
import { emptyRequest } from "../next-headers-fake";
import { attributesOf, sentencesOf, textsOf } from "../screen-test-helpers";
import { SiteHeader } from "../site-header";
import MenuEmails from "./page";

const request = vi.hoisted(() => ({ current: { cookies: {}, headers: {}, sets: [] } as import("../next-headers-fake").RequestState }));
const services = vi.hoisted(() => ({
  repo: undefined as unknown as import("@core/adapters/in-memory-repository.js").InMemoryRepository,
  secret: "test-session-secret-that-is-long-enough-0123456789",
}));

vi.mock("next/headers", async () => {
  const { fakeNextHeaders } = await import("../next-headers-fake");
  return {
    cookies: () => fakeNextHeaders(request.current).cookies(),
    headers: () => fakeNextHeaders(request.current).headers(),
  };
});
// `notFound` throws as the real one does, so a test can tell it from a redirect and from a page.
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
    throw new Error("the menu emails page has no reason to send email");
  },
  getSessionSecret: () => services.secret,
}));
vi.mock("../site-header", () => ({ SiteHeader: vi.fn(async () => createElement("header", null, "the header")) }));
// The buttons' actions, standing in for server references: React writes what `$$FORM_ACTION` gives as the form's
// `action`, so the markup names the action each button posts to.
vi.mock("./actions", () => ({
  turnMenuEmailsOn: Object.assign(async () => {}, { $$FORM_ACTION: () => ({ name: "$ACTION_ID_turnMenuEmailsOn", action: "turnMenuEmailsOn" }) }),
  turnMenuEmailsOff: Object.assign(async () => {}, { $$FORM_ACTION: () => ({ name: "$ACTION_ID_turnMenuEmailsOff", action: "turnMenuEmailsOff" }) }),
}));

const ADA = "ada@example.com";
const UNKNOWN_UUID = "00000000-0000-4000-8000-000000000000";

// This task's words.
const OFF_HEADING = "Menu emails are off";
const OFF_BODY = `You won't get the weekly menu at ${ADA}. Your box and your charges don't change, and the menu is always on this site.`;
const ON_HEADING = "Menu emails are on";
const ON_BODY = `You'll get the menu each week at ${ADA}.`;
const SEE_MENU = "See this week's menu";

let ada: Member;

beforeEach(async () => {
  request.current = emptyRequest();
  services.repo = new InMemoryRepository();
  vi.mocked(SiteHeader).mockClear();
  ada = await services.repo.saveAccount({ email: ADA, firstName: "Ada", lastName: "Lovelace", phone: "216-555-0100", language: "en" });
});

afterEach(() => {
  vi.restoreAllMocks();
});

const pageOf = (query: { m?: string; t?: string }) => MenuEmails({ searchParams: Promise.resolve(query) });
const valid = (memberId: string = ada.id) => ({ m: memberId, t: menuEmailToken(memberId, services.secret) });

/** The page, rendered; or "not found" when it was Next's not-found page. */
const outcomeOf = async (query: { m?: string; t?: string }): Promise<{ html: string } | "not found"> => {
  try {
    return { html: renderToStaticMarkup(await pageOf(query)) };
  } catch (e) {
    if ((e as { notFound?: unknown } | null)?.notFound === true) return "not found";
    throw e;
  }
};

const render = async (query: { m?: string; t?: string }): Promise<string> => {
  const outcome = await outcomeOf(query);
  return outcome === "not found" ? "" : outcome.html;
};

/** Each form: the action it posts to, its hidden fields and its submit buttons' words. */
const formsOf = (html: string) =>
  [...html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/g)].map(([, attrs = "", inner = ""]) => {
    const buttons = attributesOf(inner, "button");
    return {
      action: buttons.find((button) => button.formaction !== undefined)?.formaction ?? attributesOf(`<form${attrs}>`, "form")[0]?.action ?? "",
      hidden: Object.fromEntries(
        attributesOf(inner, "input")
          .filter((input) => input.type === "hidden" && !(input.name ?? "").startsWith("$ACTION"))
          .map((input) => [input.name, input.value]),
      ),
      submits: [...inner.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map(([, , text = ""]) => textsOf(text).join(" ")),
    };
  });

/** Each link on the page: where it goes and its text. */
const linksOf = (html: string): { href: string; text: string }[] =>
  [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map(([, attrs = "", inner = ""]) => ({
    href: attributesOf(`<a${attrs}>`, "a")[0]?.href ?? "",
    text: textsOf(inner).join(" "),
  }));

describe("AC8 — menu emails off", () => {
  it("AC8: a valid link for a member with menu emails off shows the off card: its heading and sentence naming their email, Turn menu emails back on posting m and t to turnMenuEmailsOn, and See this week's menu", async () => {
    await services.repo.setMenuEmails(ada.id, false);
    const html = await render(valid());
    const sentences = sentencesOf(html, ["span"]);
    expect(sentences).toEqual(expect.arrayContaining([OFF_HEADING, OFF_BODY]));
    expect(sentences).not.toContain(ON_HEADING);
    expect(formsOf(html)).toEqual([{ action: "turnMenuEmailsOn", hidden: valid(), submits: ["Turn menu emails back on"] }]);
    expect(linksOf(html)).toContainEqual({ href: "/menu", text: SEE_MENU });
  });

  it("AC8: the page is public, with the signed-out header's Sign in", async () => {
    await services.repo.setMenuEmails(ada.id, false);
    await render(valid());
    expect(SiteHeader).toHaveBeenCalledWith(expect.objectContaining({ account: "sign-in" }));
  });
});

describe("AC8 — menu emails on", () => {
  it("AC8: for a member with menu emails on it shows the on card: its heading and sentence, Turn them off posting m and t to turnMenuEmailsOff, and the same link", async () => {
    const html = await render(valid());
    const sentences = sentencesOf(html, ["span"]);
    expect(sentences).toEqual(expect.arrayContaining([ON_HEADING, ON_BODY]));
    expect(sentences).not.toContain(OFF_HEADING);
    expect(formsOf(html)).toEqual([{ action: "turnMenuEmailsOff", hidden: valid(), submits: ["Turn them off"] }]);
    expect(linksOf(html)).toContainEqual({ href: "/menu", text: SEE_MENU });
  });
});

describe("AC8 — a link that does not verify", () => {
  it("AC8: another member's token is Next's not-found page", async () => {
    const grace = await services.repo.createMember({ email: "grace@example.com" });
    expect(await outcomeOf({ m: ada.id, t: menuEmailToken(grace.id, services.secret) })).toBe("not found");
  });

  it("AC8: a token that matches an id no member has is Next's not-found page", async () => {
    expect(await outcomeOf(valid(UNKNOWN_UUID))).toBe("not found");
  });

  it("AC8: no m or t at all is Next's not-found page", async () => {
    expect(await outcomeOf({})).toBe("not found");
  });
});
