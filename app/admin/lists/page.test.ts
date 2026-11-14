// Issue 142: Weekly lists, rendered through react-dom/server with `next/headers` faked and the composition root
// mocked, as app/admin/weeks/page.test.ts renders the weeks screen. Read as the markup and its text. Which weeks the
// select offers is `listableWeeks`'s (src/pickup-week.test.ts) and the fallback's cases `loadWeekLists`'s
// (./week.test.ts): one offered and one fallen-back week here. The counts are `pickList`'s and `weekSummary`'s
// (src/week-lists.test.ts), the meals the repository's (src/adapters/week-lists-contract.ts). The wording is new copy,
// typed here once (src/messages/en.ts gains it with this task).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryRepository } from "@core/adapters/in-memory-repository.js";
import { createTranslator } from "@core/i18n.js";
import { listableWeeks, listedWeekTitle } from "@core/pickup-week.js";
import type { ProductWithOptions } from "@core/products.js";
import { LANGUAGE_COOKIE } from "../../language";
import { emptyRequest } from "../../next-headers-fake";
import { attributesOf, redirectOf, screenMarkup, textsOf } from "../../screen-test-helpers";
import { addSupperClub, MENUS, SIZES } from "../subscribers-fixture";
import { FEB_14, FEB_7, fourMembers, linksLabelled, NOW, oneOfEach, signInAs, subscribe, tableRows, TAM } from "./lists-fixture";
import AdminLists from "./page";

const request = vi.hoisted(() => ({ current: { cookies: {}, headers: {}, sets: [] } as import("../../next-headers-fake").RequestState }));
const services = vi.hoisted(() => ({
  repo: undefined as unknown as import("@core/adapters/in-memory-repository.js").InMemoryRepository,
  secret: "test-session-secret-that-is-long-enough-0123456789",
}));

vi.mock("next/headers", async () => {
  const { fakeNextHeaders } = await import("../../next-headers-fake");
  return {
    cookies: () => fakeNextHeaders(request.current).cookies(),
    headers: () => fakeNextHeaders(request.current).headers(),
  };
});
vi.mock("next/navigation", async () => ({ redirect: (await import("../../screen-test-helpers")).throwingRedirect }));
vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("../../services", () => ({
  getRepository: () => services.repo,
  getEmail: () => {
    throw new Error("/admin/lists has no reason to send email");
  },
  getSessionSecret: () => services.secret,
}));
vi.mock("../../site-header", () => ({ SiteHeader: vi.fn(async () => createElement("header", null, "the header")) }));

const t = createTranslator("en");
let product: ProductWithOptions;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  request.current = emptyRequest();
  services.repo = new InMemoryRepository();
  product = addSupperClub(services.repo);
});

afterEach(() => {
  vi.useRealTimers();
});

const render = async (query: Record<string, string> = {}): Promise<string> =>
  screenMarkup(renderToStaticMarkup(await AdminLists({ searchParams: Promise.resolve(query) })));

/** The page's text as one line: tags dropped, spaces collapsed, so a sentence split by inline markup reads whole. */
const lineText = (markup: string): string => markup.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");

/** The Week select's options, value and label, and the one selected. */
const weekOptions = (markup: string) => {
  const select = /<select\b[^>]*\bname="week"[^>]*>([\s\S]*?)<\/select>/.exec(markup)?.[1] ?? "";
  const options = [...select.matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/g)].map(([, attrs = "", label = ""]) => ({
    value: /\bvalue="([^"]*)"/.exec(attrs)?.[1] ?? "",
    label: label.trim(),
    selected: /\bselected\b/.test(attrs),
  }));
  return { options, selected: options.filter((option) => option.selected).map((option) => option.value) };
};

describe("AC8 — only an admin", () => {
  it("AC8: a signed-out visitor goes to /sign-in", async () => {
    await expect(redirectOf(render())).resolves.toBe("/sign-in");
  });

  it("AC8: a signed-in member whose role is not admin goes to /", async () => {
    await signInAs(services.repo, request.current, services.secret, "member");
    await expect(redirectOf(render())).resolves.toBe("/");
  });
});

describe("signed in as an admin", () => {
  beforeEach(async () => {
    await signInAs(services.repo, request.current, services.secret, "admin");
  });

  describe("AC3 — the Week select", () => {
    it('AC3: it offers the listable weeks in order, each titled as the calendar titles it with " · cutoff passed" appended when so', async () => {
      const weeks = listableWeeks(product, NOW, []);
      expect(weeks.length).toBeGreaterThan(0);
      expect(weekOptions(await render()).options.map(({ value, label }) => ({ value, label }))).toEqual(
        weeks.map((week) => ({ value: week.weekOf, label: `${listedWeekTitle(t, week, "en")}${week.cutoffPassed ? " · cutoff passed" : ""}` })),
      );
    });

    it("AC3: with no week named, the first upcoming week is selected and shown", async () => {
      const markup = await render();
      expect(weekOptions(markup).selected).toEqual([FEB_7]);
      expect(textsOf(markup)).toContain("Pick list · February 7 and 8");
    });

    it("AC3: ?week= names another week, which is selected and shown", async () => {
      const markup = await render({ week: FEB_14 });
      expect(weekOptions(markup).selected).toEqual([FEB_14]);
      expect(textsOf(markup)).toContain("Pick list · February 14 and 15");
    });

    it("AC3 [Lead]: the select sends its week as week= through a GET form", async () => {
      const markup = await render();
      const form = [...markup.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/g)].find(([, , inner = ""]) => /<select\b[^>]*\bname="week"/.test(inner));
      expect(form?.[1] ?? "no form holds the week select").toMatch(/\bmethod="get"/i);
    });

    it("AC8: a week the select does not offer falls back to the first upcoming week", async () => {
      const markup = await render({ week: "2099-01-04" });
      expect(weekOptions(markup).selected).toEqual([FEB_7]);
      expect(textsOf(markup)).toContain("Pick list · February 7 and 8");
    });
  });

  describe("AC4 — the pick list", () => {
    it('AC4: a Final badge only once the week\'s cutoff has passed', async () => {
      expect(textsOf(await render({ week: FEB_7 }))).toContain("Final");
      expect(textsOf(await render({ week: FEB_14 }))).not.toContain("Final");
    });

    it('AC4: a column per option type named as the farm wrote it, then "Meals"; a row per combination; "Meals to make" and the total', async () => {
      await fourMembers(services.repo, product);
      expect(tableRows(await render({ week: FEB_14 }))).toEqual([
        [SIZES.name, MENUS.name, "Meals"],
        ["3–4 people", "Standard", "2"],
        ["3–4 people", "Vegan", "0"],
        ["2 people", "Standard", "0"],
        ["2 people", "Vegan", "1"],
        ["Meals to make", "", "3"],
      ]);
    });

    it("AC4: the three actions carry the week shown", async () => {
      const markup = await render({ week: FEB_14 });
      expect(linksLabelled(markup, "Download pick list")).toEqual([{ path: "/admin/lists/pick-list.csv", query: { week: FEB_14 } }]);
      expect(linksLabelled(markup, "Download skips")).toEqual([{ path: "/admin/lists/skips.csv", query: { week: FEB_14 } }]);
      expect(linksLabelled(markup, "Print pickup list")).toEqual([{ path: "/admin/lists/print", query: { week: FEB_14 } }]);
    });
  });

  // Issue 183: the line's member count is `weekSummary`'s `members` (src/week-lists.test.ts), and who is in the week
  // `listWeekBoxes`'s (src/adapters/week-lists-contract.ts); one fixture case per criterion here, to show the line reads
  // that list. The members part is this issue's copy, typed once; the skipped and week-credit parts are read from the
  // catalog in the form each case needs.
  describe("issue 183 — the line counts the week's members", () => {
    const es = createTranslator("es");

    it("AC1: the line's member count is the week's meals plus its skips, members first", async () => {
      await fourMembers(services.repo, product);
      const markup = await render({ week: FEB_14 });
      expect(tableRows(markup).at(-1)).toEqual(["Meals to make", "", "3"]);
      expect(lineText(markup)).toContain(`4 members this week · ${t("admin.lists.skipped.one", { n: 1 })} · ${t("admin.lists.credits.other", { n: 0 })}.`);
    });

    it("AC2: an active subscription whose first week is later than the week shown is not in its count", async () => {
      await fourMembers(services.repo, product);
      await subscribe(services.repo, product, TAM, ["2 people", "Vegan"], FEB_14);
      expect(lineText(await render({ week: FEB_7 }))).toContain(`4 members this week · ${t("admin.lists.skipped.other", { n: 0 })} · ${t("admin.lists.credits.other", { n: 0 })}.`);
      expect(lineText(await render({ week: FEB_14 }))).toContain(`5 members this week · ${t("admin.lists.skipped.one", { n: 1 })} · ${t("admin.lists.credits.other", { n: 0 })}.`);
    });

    it("AC3: a past week counts its own members: one cancelled since, holding a skip for it, is counted", async () => {
      await oneOfEach(services.repo, product);
      const markup = await render({ week: FEB_7 });
      expect(tableRows(markup).at(-1)).toEqual(["Meals to make", "", "1"]);
      expect(lineText(markup)).toContain(`2 members this week · ${t("admin.lists.skipped.one", { n: 1 })} · ${t("admin.lists.credits.one", { n: 1 })}.`);
    });

    it("AC4: a cancelled subscription with no row for the week shown and not due it is left out", async () => {
      await fourMembers(services.repo, product);
      const tam = await subscribe(services.repo, product, TAM, ["2 people", "Vegan"]);
      await services.repo.cancelSubscription(tam.subscriptionId, NOW);
      expect(lineText(await render({ week: FEB_14 }))).toContain(`4 members this week · ${t("admin.lists.skipped.one", { n: 1 })} · ${t("admin.lists.credits.other", { n: 0 })}.`);
    });

    it('AC5: a one-member week reads "1 member this week"', async () => {
      await oneOfEach(services.repo, product);
      expect(lineText(await render({ week: FEB_14 }))).toContain(`1 member this week · ${t("admin.lists.skipped.other", { n: 0 })} · ${t("admin.lists.credits.other", { n: 0 })}.`);
    });

    it('AC5: in Spanish, a one-member week reads "1 miembro esta semana"', async () => {
      await oneOfEach(services.repo, product);
      request.current.cookies[LANGUAGE_COOKIE] = "es";
      expect(lineText(await render({ week: FEB_14 }))).toContain(`1 miembro esta semana · ${es("admin.lists.skipped.other", { n: 0 })} · ${es("admin.lists.credits.other", { n: 0 })}.`);
    });

    it('AC5: in Spanish, a two-member week reads "2 miembros esta semana"', async () => {
      await oneOfEach(services.repo, product);
      request.current.cookies[LANGUAGE_COOKIE] = "es";
      expect(lineText(await render({ week: FEB_7 }))).toContain(`2 miembros esta semana · ${es("admin.lists.skipped.one", { n: 1 })} · ${es("admin.lists.credits.one", { n: 1 })}.`);
    });
  });

  describe("AC9 — the admin nav", () => {
    it('AC9: "Weekly lists" is its fourth button, after Members, Menus and Weeks, linking here and marked as the page showing', async () => {
      const markup = await render();
      const nav = /<nav\b[^>]*>([\s\S]*?)<\/nav>/.exec(markup)?.[1] ?? "";
      const links = attributesOf(nav, "a").map((attrs, at) => ({ href: attrs.href, current: attrs["aria-current"] === "page", text: textsOf(`<a${nav.split(/<a\b/)[at + 1] ?? ""}`)[0] }));
      expect(links).toEqual([
        { href: "/admin", current: false, text: "Members" },
        { href: "/admin/menus", current: false, text: "Menus" },
        { href: "/admin/weeks", current: false, text: "Weeks" },
        { href: "/admin/lists", current: true, text: "Weekly lists" },
      ]);
    });
  });
});
