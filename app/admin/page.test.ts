// Issue 10, AC3–AC5, and issue 59's first render, through the page: `await Admin()` with `next/headers`
// faked and the composition root mocked, as app/page-sign-in.test.ts renders the home page. A signed-in
// request is an ocf_session cookie for a member in an InMemoryRepository. Issue 59 replaced the
// placeholder issue 10's AC6 described. What happens after the first render is e2e/admin-members.spec.ts.
// Read as the tree the page returns: what it gives `MembersList`, `Heading`, `Hint` and `Button`. The list's
// own markup is app/admin/members-list.test.ts's, the header's is app/site-header.test.ts's (faked here, so
// what is read is the call the page makes), and who counts as an admin is app/session.test.ts's.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryRepository } from "@core/adapters/in-memory-repository.js";
import { createTranslator } from "@core/i18n.js";
import { subscriberName } from "@core/member-list.js";
import { en } from "@core/messages/en.js";
import type { Role } from "@core/members.js";
import type { Subscriber } from "@core/ports/repository.js";
import { signSession } from "@core/sign-in/session.js";
import { Button } from "../../components/ui/button";
import { Heading } from "../../components/ui/heading";
import { Hint } from "../../components/ui/hint";
import { emptyRequest } from "../next-headers-fake";
import { findAll, inOrder, redirectOf, textsOf } from "../screen-test-helpers";
import { SiteHeader } from "../site-header";
import Admin from "./page";
import { MembersList } from "./members-list";
import { activeSubscriber, addSupperClub, pendingSignup } from "./subscribers-fixture";

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
vi.mock("next/navigation", async () => ({ redirect: (await import("../screen-test-helpers")).throwingRedirect }));
vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("../services", () => ({
  getRepository: () => services.repo,
  getEmail: () => {
    throw new Error("/admin has no reason to send email");
  },
  getSessionSecret: () => services.secret,
}));
vi.mock("../site-header", () => ({ SiteHeader: vi.fn(async () => createElement("header", null, "the header")) }));

const t = createTranslator("en");
const DAY = 24 * 60 * 60_000;

beforeEach(() => {
  request.current = emptyRequest();
  services.repo = new InMemoryRepository();
  vi.mocked(SiteHeader).mockClear();
});

async function signInAs(role: Role): Promise<void> {
  const member = await services.repo.createMember({ email: "lenny@example.com", role });
  const expiresAt = new Date(Date.now() + DAY).toISOString();
  request.current.cookies.ocf_session = signSession({ subjectId: member.id, expiresAt }, services.secret);
}

describe("AC1 (issue 59) — /admin keeps everyone else out", () => {
  it("AC1: a signed-out visitor goes to /sign-in, with the Supper Club in the database", async () => {
    addSupperClub(services.repo);
    await expect(redirectOf(Admin())).resolves.toBe("/sign-in");
  });

  it("AC1: a signed-in member whose role is not admin goes to /, with the Supper Club in the database", async () => {
    addSupperClub(services.repo);
    await signInAs("member");
    await expect(redirectOf(Admin())).resolves.toBe("/");
  });
});

describe("issue 59 — /admin, signed in as an admin", () => {
  const ROSA = { email: "rosa@example.com", firstName: "Rosa", lastName: "Bennett", phone: "(216) 555-0187" };
  const CHIDI = { email: "chidi@example.com", firstName: "Chidi", lastName: "Abara", phone: "(216) 555-0142" };
  const MARCO = { email: "marco@example.com", firstName: "Marco", lastName: "Castillo", phone: "(440) 555-0123" };
  const PICKS = ["2 people", "Vegan"];

  beforeEach(async () => {
    await signInAs("admin");
  });

  /** The page as a tree, and what it gives the list. */
  const page = async () => {
    const element = await Admin();
    const [list] = findAll(element, MembersList);
    return { element, list, rows: (list?.props.rows ?? []) as Subscriber[] };
  };

  describe("AC3 — the rows", () => {
    it("AC3: the list gets one row per active subscription, and a pending subscription is left out", async () => {
      const product = addSupperClub(services.repo);
      await activeSubscriber(services.repo, product, ROSA, PICKS);
      await pendingSignup(services.repo, product, CHIDI, PICKS);

      const { rows } = await page();

      expect(rows.map((row) => row.email)).toEqual(["rosa@example.com"]);
    });

    it("AC3: the list gets the words from the catalog", async () => {
      const product = addSupperClub(services.repo);
      await activeSubscriber(services.repo, product, ROSA, PICKS);

      const { list } = await page();

      expect(list?.props.text).toEqual({
        search: en["admin.members.search"],
        searchPlaceholder: en["admin.members.searchPlaceholder"],
        noMatch: en["admin.members.noMatch"],
        columns: {
          name: en["admin.members.name"],
          email: en["admin.members.email"],
          phone: en["admin.members.phone"],
          meal: en["admin.members.meal"],
          joined: en["admin.members.joined"],
          status: en["admin.members.status"],
        },
        active: en["admin.members.active"],
        sortBy: en["admin.members.sortBy"],
        sortLabels: {
          name: en["admin.members.name"],
          joined: en["admin.members.sortJoined"],
          meal: en["admin.members.meal"],
          status: en["admin.members.status"],
        },
        joinedLine: en["admin.members.joinedLine"],
      });
    });
  });

  describe("AC4 — the count line", () => {
    it("AC4: under the header sit the title, then the count, then Download spreadsheet", async () => {
      addSupperClub(services.repo, { cap: 7 });
      const wanted = ["the header", en["admin.members.title"], t("admin.members.taken", { n: 0, cap: 7 }), en["admin.members.download"]];

      expect(inOrder(renderToStaticMarkup(await Admin()), wanted)).toEqual(wanted);
    });

    it('AC4: the title is the page\'s one level-1 heading', async () => {
      addSupperClub(services.repo);
      const headings = findAll(await Admin(), Heading).filter((heading) => heading.props.level === undefined || heading.props.level === 1);
      expect(headings.map((heading) => heading.props.children)).toEqual([en["admin.members.title"]]);
    });

    it("AC4: n is the held spots, so it runs above the rows while a signup is mid-payment, and cap is the product's", async () => {
      const product = addSupperClub(services.repo, { cap: 7 });
      await activeSubscriber(services.repo, product, ROSA, PICKS);
      const midPayment = await pendingSignup(services.repo, product, CHIDI, PICKS);
      await services.repo.saveSubscriptionCard(midPayment.subscriptionId, "ccof:card-1");
      await pendingSignup(services.repo, product, MARCO, PICKS);

      const { element, rows } = await page();

      expect(findAll(element, Hint).map((hint) => hint.props.children)).toEqual([t("admin.members.taken", { n: 2, cap: 7 })]);
      expect(rows).toHaveLength(1);
    });
  });

  describe("AC5 — the list as it opens", () => {
    it("AC5: the list gets its rows sorted by name, ascending, whatever order the rows were made in", async () => {
      const product = addSupperClub(services.repo);
      await activeSubscriber(services.repo, product, MARCO, PICKS);
      await activeSubscriber(services.repo, product, ROSA, PICKS);
      await activeSubscriber(services.repo, product, CHIDI, PICKS);

      const { rows } = await page();

      expect(rows.map(subscriberName)).toEqual(["Abara, Chidi", "Bennett, Rosa", "Castillo, Marco"]);
    });
  });

  describe("AC7 — no active subscriptions", () => {
    const expectEmpty = (element: Awaited<ReturnType<typeof Admin>>) => {
      const level2 = findAll(element, Heading).filter((heading) => heading.props.level === 2);
      expect(level2.map((heading) => heading.props.children)).toEqual([en["admin.members.emptyTitle"]]);
      expect(textsOf(renderToStaticMarkup(element))).toContain(en["admin.members.emptyBody"]);
      expect(findAll(element, MembersList)).toEqual([]);
    };

    it("AC7: the card shows the empty-state heading and its line, and no list", async () => {
      addSupperClub(services.repo);
      expectEmpty(await Admin());
    });

    it("AC7: a signup mid-payment is not an active subscription: the card is still empty", async () => {
      const product = addSupperClub(services.repo);
      const midPayment = await pendingSignup(services.repo, product, ROSA, PICKS);
      await services.repo.saveSubscriptionCard(midPayment.subscriptionId, "ccof:card-1");
      expectEmpty(await Admin());
    });

    it("AC7: with active subscriptions the empty wording is not on the page", async () => {
      const product = addSupperClub(services.repo);
      await activeSubscriber(services.repo, product, ROSA, PICKS);

      const element = await Admin();

      expect(findAll(element, MembersList)).toHaveLength(1);
      expect(textsOf(renderToStaticMarkup(element))).not.toContain(en["admin.members.emptyTitle"]);
    });
  });

  describe("AC8 — the way to the spreadsheet", () => {
    it('AC8: "Download spreadsheet" is a secondary link to /admin/members.csv', async () => {
      addSupperClub(services.repo);

      const links = findAll(await Admin(), Button).filter((button) => button.props.href === "/admin/members.csv");

      expect(links).toHaveLength(1);
      expect(links[0]?.props).toMatchObject({ kind: "secondary", children: en["admin.members.download"] });
    });
  });

  // Issue 97: the header reads the session; on /admin the admin's Admin button is the page showing.
  describe("AC5 (issue 97) — the header on /admin", () => {
    it('AC5: the page asks for the header with account "none" and current "admin"', async () => {
      addSupperClub(services.repo);
      await Admin();
      expect(SiteHeader).toHaveBeenCalledWith({ account: "none", current: "admin" });
    });
  });

  describe("AC11 — Joined on the screen", () => {
    it("AC11: a payment at 22:30 on December 1 in Cleveland, already December 2 in UTC, reads Dec 1", async () => {
      const product = addSupperClub(services.repo);
      await activeSubscriber(services.repo, product, ROSA, PICKS, new Date("2026-12-02T03:30:00.000Z"));

      const html = renderToStaticMarkup(await Admin());
      const body = /<tbody\b[^>]*>([\s\S]*?)<\/tbody>/.exec(html)?.[1] ?? "";
      const cells = [...body.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map(([, cell = ""]) => textsOf(cell).join(" "));

      expect(cells[4]).toBe("Dec 1");
    });
  });
});
