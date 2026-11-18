// Issue 142: the printable pickup list, rendered through react-dom/server with `next/headers` faked and the
// composition root mocked, as ../page.test.ts renders Weekly lists. Name order and "Last, First" are `pickupRows`'
// and `weekSummary`'s (src/week-lists.test.ts): the page is checked only to render them. The fallback's cases are
// `loadWeekLists`'s (../week.test.ts): one offered and one fallen-back week here. The meta line's plural is
// `pluralKey`'s (src/i18n.test.ts). Lines the page picks by state are checked by their catalog line.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryRepository } from "@core/adapters/in-memory-repository.js";
import { createTranslator, pluralKey } from "@core/i18n.js";
import type { ProductWithOptions } from "@core/products.js";
import { PrintSheet } from "../../../../components/ui/print-sheet";
import { emptyRequest } from "../../../next-headers-fake";
import { findAll, redirectOf, screenMarkup, textsOf } from "../../../screen-test-helpers";
import { SiteHeader } from "../../../site-header";
import { addSupperClub } from "../../subscribers-fixture";
import { FEB_14, FEB_7, fourMembers, linksLabelled, NOW, oneOfEach, signInAs, subscribe, tableRows, TAM, TODAY } from "../lists-fixture";
import AdminPickupPrint from "./page";

const request = vi.hoisted(() => ({ current: { cookies: {}, headers: {}, sets: [] } as import("../../../next-headers-fake").RequestState }));
const services = vi.hoisted(() => ({
  repo: undefined as unknown as import("@core/adapters/in-memory-repository.js").InMemoryRepository,
  secret: "test-session-secret-that-is-long-enough-0123456789",
}));

vi.mock("next/headers", async () => {
  const { fakeNextHeaders } = await import("../../../next-headers-fake");
  return {
    cookies: () => fakeNextHeaders(request.current).cookies(),
    headers: () => fakeNextHeaders(request.current).headers(),
  };
});
vi.mock("next/navigation", async () => ({ redirect: (await import("../../../screen-test-helpers")).throwingRedirect }));
vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("../../../services", () => ({
  getRepository: () => services.repo,
  getEmail: () => {
    throw new Error("/admin/lists/print has no reason to send email");
  },
  getSessionSecret: () => services.secret,
}));
vi.mock("../../../site-header", () => ({ SiteHeader: vi.fn(async () => createElement("header", null, "the header")) }));

let product: ProductWithOptions;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  request.current = emptyRequest();
  services.repo = new InMemoryRepository();
  vi.mocked(SiteHeader).mockClear();
  product = addSupperClub(services.repo);
});

afterEach(() => {
  vi.useRealTimers();
});

const render = async (query: Record<string, string> = {}): Promise<string> =>
  screenMarkup(renderToStaticMarkup(await AdminPickupPrint({ searchParams: Promise.resolve(query) })));

/** The page's text as one line: tags dropped, spaces collapsed. */
const lineText = (markup: string): string => markup.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");

const t = createTranslator("en");

/** The meta line for `n` meals printed today: the value the not-final line wraps. */
const metaFor = (n: number): string => t(pluralKey("en", "admin.print.meta", n), { n, date: TODAY });

/** The closing line the page gives the sheet. */
const closingOf = async (query: Record<string, string>): Promise<unknown> =>
  findAll(await AdminPickupPrint({ searchParams: Promise.resolve(query) }), PrintSheet)[0]?.props.closing;

/** The table's member rows, the check box's cell dropped: Name, Meal, Notes. */
const memberRows = (markup: string): string[][] =>
  tableRows(markup)
    .slice(1)
    .map((row) => row.slice(-3));

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

  describe("AC7 — the sheet", () => {
    it("AC7: the page has no site header and no admin nav, and its heading names the week", async () => {
      const markup = await render({ week: FEB_14 });
      expect(SiteHeader).not.toHaveBeenCalled();
      expect(markup).not.toMatch(/<a\b[^>]*\bhref="\/admin\/menus/);
      expect(textsOf(markup).join(" ")).toContain("February 14 and 15");
    });

    it("AC7: before the cutoff the meta line counts the meals, dates the printing and is marked not final", async () => {
      await fourMembers(services.repo, product);
      expect(lineText(await render({ week: FEB_14 }))).toContain(t("admin.print.notFinal", { meta: metaFor(3) }));
    });

    it("AC7: after the cutoff the meta line counts the meals and dates the printing, not marked not final", async () => {
      await oneOfEach(services.repo, product);
      const text = lineText(await render({ week: FEB_7 }));
      expect(text).toContain(metaFor(1));
      expect(text).not.toContain(t("admin.print.notFinal", { meta: metaFor(1) }));
    });

    it('AC7: a row per meal in pickupRows\' order, "Last, First", the meal\'s options joined by " · ", Notes the declined line or empty', async () => {
      const { marco } = await fourMembers(services.repo, product);
      // Issue 196: a declined row in an earlier week would lock February 14; the declined week itself is still a meal.
      await services.repo.addLedgerRow(marco.subscriptionId, FEB_14, "declined", 5000);
      expect(memberRows(await render({ week: FEB_14 }))).toEqual([
        ["Abara, Chidi", "3–4 people · Standard", ""],
        ["Bennett, Rosa", "3–4 people · Standard", ""],
        ["Castillo, Marco", "2 people · Vegan", t("admin.members.cardDeclined")],
      ]);
    });

    it('AC7: the back link returns to the week on Weekly lists', async () => {
      expect(linksLabelled(await render({ week: FEB_14 }), "Back to weekly lists")).toEqual([{ path: "/admin/lists", query: { week: FEB_14 } }]);
    });

    it("AC8: a week the select does not offer falls back to the first upcoming week", async () => {
      expect(textsOf(await render({ week: "2027-02-13" })).join(" ")).toContain("February 7 and 8");
    });
  });

  describe("AC7 — the closing line", () => {
    it("AC7: both sentences when there are skips and week credits", async () => {
      await oneOfEach(services.repo, product);
      expect(lineText(await render({ week: FEB_7 }))).toContain(
        `${t("admin.print.skipped", { names: "Nguyen, Lan" })} ${t("admin.print.weekCredit", { names: "Bennett, Rosa" })}`,
      );
    });

    it('AC7: with skips alone only the first, its names joined by " · "', async () => {
      const { rosa } = await fourMembers(services.repo, product);
      expect(await services.repo.skipWeek(rosa.subscriptionId, FEB_14)).toBe(true);
      await expect(closingOf({ week: FEB_14 })).resolves.toBe(t("admin.print.skipped", { names: "Bennett, Rosa · Nguyen, Lan" }));
    });

    it("AC7: with neither there is no closing line", async () => {
      await subscribe(services.repo, product, TAM, ["2 people", "Vegan"]);
      expect(lineText(await render({ week: FEB_7 }))).toContain("Okafor, Tam");
      await expect(closingOf({ week: FEB_7 })).resolves.toBeUndefined();
    });
  });
});
