// Issue 142: Weekly lists, rendered through react-dom/server with `next/headers` faked and the composition root
// mocked, as app/admin/weeks/page.test.ts renders the weeks screen. Read as the markup and its text. Which weeks the
// select offers is `listableWeeks`'s (src/pickup-week.test.ts) and the fallback's cases `loadWeekLists`'s
// (./week.test.ts): one offered and one fallen-back week here. The counts are `pickList`'s and `weekSummary`'s
// (src/week-lists.test.ts), the meals the repository's (src/adapters/week-lists-contract.ts); the counts line's plurals
// are `pluralKey`'s (src/i18n.test.ts). Lines the page shows in some states and not others are checked by their
// catalog line.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryRepository } from "@core/adapters/in-memory-repository.js";
import { createTranslator } from "@core/i18n.js";
import { listableWeeks, listedWeekTitle } from "@core/pickup-week.js";
import type { ProductWithOptions } from "@core/products.js";
import { Hint } from "../../../components/ui/hint";
import { emptyRequest } from "../../next-headers-fake";
import { findAll, redirectOf, screenMarkup, textsOf } from "../../screen-test-helpers";
import { SiteHeader } from "../../site-header";
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


/** The counts line, the page's last Hint, as its numbers in order: members, skipped, week credits. */
const countsOf = async (query: Record<string, string>): Promise<number[]> => {
  const line = findAll(await AdminLists({ searchParams: Promise.resolve(query) }), Hint).at(-1)?.props.children;
  return [...String(line).matchAll(/\d+/g)].map(([n]) => Number(n));
};

/** The level-2 headings' text: the week shown is named in the only one. */
const h2sOf = (markup: string): string[] => [...markup.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/g)].map(([, inner = ""]) => inner.replace(/<[^>]*>/g, "").trim());

/** The pick list's total: the last cell of its last row. */
const totalOf = (markup: string): string | undefined => tableRows(markup).at(-1)?.at(-1);

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
    it("AC3: it offers the listable weeks in order, each titled as the calendar titles it, marked when its cutoff has passed", async () => {
      const weeks = listableWeeks(product, NOW, []);
      expect(weeks.length).toBeGreaterThan(0);
      expect(weeks.some((week) => week.cutoffPassed)).toBe(true);
      expect(weekOptions(await render()).options.map(({ value, label }) => ({ value, label }))).toEqual(
        weeks.map((week) => {
          const title = listedWeekTitle(t, week, "en");
          return { value: week.weekOf, label: week.cutoffPassed ? t("admin.lists.weekPassed", { title }) : title };
        }),
      );
    });

    it("AC3: with no week named, the first upcoming week is selected and shown", async () => {
      const markup = await render();
      expect(weekOptions(markup).selected).toEqual([FEB_7]);
      expect(h2sOf(markup)).toEqual([expect.stringContaining("February 7 and 8")]);
    });

    it("AC3: ?week= names another week, which is selected and shown", async () => {
      const markup = await render({ week: FEB_14 });
      expect(weekOptions(markup).selected).toEqual([FEB_14]);
      expect(h2sOf(markup)).toEqual([expect.stringContaining("February 14 and 15")]);
    });

    it("AC3 [Lead]: the select sends its week as week= through a GET form", async () => {
      const markup = await render();
      const form = [...markup.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/g)].find(([, , inner = ""]) => /<select\b[^>]*\bname="week"/.test(inner));
      expect(form?.[1] ?? "no form holds the week select").toMatch(/\bmethod="get"/i);
    });

    it("AC8: a week the select does not offer falls back to the first upcoming week", async () => {
      const markup = await render({ week: "2099-01-04" });
      expect(weekOptions(markup).selected).toEqual([FEB_7]);
      expect(h2sOf(markup)).toEqual([expect.stringContaining("February 7 and 8")]);
    });
  });

  describe("AC4 — the pick list", () => {
    it("AC4: a Final badge only once the week's cutoff has passed", async () => {
      expect(textsOf(await render({ week: FEB_7 }))).toContain(t("admin.lists.final"));
      expect(textsOf(await render({ week: FEB_14 }))).not.toContain(t("admin.lists.final"));
    });

    it("AC4: a column per option type named as the farm wrote it, then the meals; a row per combination; then the total", async () => {
      await fourMembers(services.repo, product);
      const rows = tableRows(await render({ week: FEB_14 }));
      expect(rows[0]?.slice(0, 2)).toEqual([SIZES.name, MENUS.name]);
      expect(rows.slice(1, -1)).toEqual([
        ["3–4 people", "Standard", "2"],
        ["3–4 people", "Vegan", "0"],
        ["2 people", "Standard", "0"],
        ["2 people", "Vegan", "1"],
      ]);
      expect(rows.at(-1)?.at(-1)).toBe("3");
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
  // that list. The line is checked by its counts, in order: members, skipped, week credits.
  describe("issue 183 — the line counts the week's members", () => {
    it("AC1: the line's member count is the week's meals plus its skips, members first", async () => {
      await fourMembers(services.repo, product);
      expect(totalOf(await render({ week: FEB_14 }))).toBe("3");
      await expect(countsOf({ week: FEB_14 })).resolves.toEqual([4, 1, 0]);
    });

    it("AC2: an active subscription whose first week is later than the week shown is not in its count", async () => {
      await fourMembers(services.repo, product);
      await subscribe(services.repo, product, TAM, ["2 people", "Vegan"], FEB_14);
      await expect(countsOf({ week: FEB_7 })).resolves.toEqual([4, 0, 0]);
      await expect(countsOf({ week: FEB_14 })).resolves.toEqual([5, 1, 0]);
    });

    it("AC3: a past week counts its own members: one cancelled since, holding a skip for it, is counted", async () => {
      await oneOfEach(services.repo, product);
      expect(totalOf(await render({ week: FEB_7 }))).toBe("1");
      await expect(countsOf({ week: FEB_7 })).resolves.toEqual([2, 1, 1]);
    });

    it("AC4: a cancelled subscription with no row for the week shown and not due it is left out", async () => {
      await fourMembers(services.repo, product);
      const tam = await subscribe(services.repo, product, TAM, ["2 people", "Vegan"]);
      await services.repo.cancelSubscription(tam.subscriptionId, NOW);
      await expect(countsOf({ week: FEB_14 })).resolves.toEqual([4, 1, 0]);
    });

    // Eric's review of pull request #184: the page carries no pointer to the member spreadsheet.
    it("the page has no pointer to the member spreadsheet", async () => {
      expect(await render({ week: FEB_7 })).not.toMatch(/<a\b[^>]*\bhref="\/admin\/members\.csv"/);
    });
  });

  // Issue 159: the admin links moved into the header (faked here); the page names itself to it and draws no nav of its own.
  describe("AC5 (issue 159) — the header names Weekly lists", () => {
    beforeEach(() => {
      vi.mocked(SiteHeader).mockClear();
    });

    it('AC5: the page asks for the header with current "admin-lists", and no link on it is marked as the page showing', async () => {
      const markup = await render();
      expect(SiteHeader).toHaveBeenCalledWith(expect.objectContaining({ current: "admin-lists" }));
      expect(markup).not.toMatch(/\baria-current="page"/);
    });
  });
});
