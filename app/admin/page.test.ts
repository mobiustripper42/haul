// Issue 10, AC3–AC5, and issue 59's first render, through the page: `await Admin()` with `next/headers`
// faked and the composition root mocked, as app/page-sign-in.test.ts renders the home page. A signed-in
// request is an ocf_session cookie for a member in an InMemoryRepository. Issue 59 replaced the
// placeholder issue 10's AC6 described. What happens after the first render is e2e/admin-members.spec.ts.
// Read as the tree the page returns: what it gives `MembersList`, `Heading`, `Hint` and `Button`. The list's
// own markup is app/admin/members-list.test.ts's, the header's is app/site-header.test.ts's (faked here, so
// what is read is the call the page makes), and who counts as an admin is app/session.test.ts's.
import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryRepository } from "@core/adapters/in-memory-repository.js";
import { subscriberName, type MemberRow } from "@core/member-list.js";
import type { Role } from "@core/members.js";
import type { Subscriber } from "@core/ports/repository.js";
import { signSession } from "@core/sign-in/session.js";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { Heading } from "../../components/ui/heading";
import { Hint } from "../../components/ui/hint";
import { emptyRequest } from "../next-headers-fake";
import { findAll, redirectOf, textsOf } from "../screen-test-helpers";
import { SiteHeader } from "../site-header";
import Admin from "./page";
import { MembersList } from "./members-list";
import { NeverSubscribedList } from "./never-subscribed-list";
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

const DAY = 24 * 60 * 60_000;

/** Every element in the tree a page returns, in document order. */
const elementsOf = (node: ReactNode): ReactElement<Record<string, unknown>>[] => {
  if (Array.isArray(node)) return node.flatMap((child) => elementsOf(child as ReactNode));
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elementsOf(node.props.children as ReactNode)];
};

/** The numbers in a line, in order: the values it carries. */
const numbersIn = (line: unknown): number[] => [...String(line).matchAll(/\d+/g)].map(([n]) => Number(n));

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

  /** The page as a tree, and what it gives the list: each person's current subscription (issue 263). */
  const page = async () => {
    const element = await Admin();
    const [list] = findAll(element, MembersList);
    return { element, list, rows: ((list?.props.rows ?? []) as MemberRow[]).map((person) => person.current) as Subscriber[] };
  };

  describe("AC3 — the rows", () => {
    it("AC3: the list gets one row per active subscription, and a pending subscription is left out", async () => {
      const product = addSupperClub(services.repo);
      await activeSubscriber(services.repo, product, ROSA, PICKS);
      await pendingSignup(services.repo, product, CHIDI, PICKS);

      const { rows } = await page();

      expect(rows.map((row) => row.email)).toEqual(["rosa@example.com"]);
    });
  });

  describe("AC4 — the count line", () => {
    it("AC4: under the header sit the title, then the count, then Download spreadsheet", async () => {
      addSupperClub(services.repo, { cap: 7 });
      const element = await Admin();

      expect(
        elementsOf(element)
          .map((node) =>
            // The header is the faked SiteHeader's <header>, which the page awaits in place.
            node.type === "header"
              ? "header"
              : node.type === Heading && (node.props.level ?? 1) === 1
                ? "title"
                : node.type === Hint
                  ? "count"
                  : node.type === Button && node.props.href === "/admin/members.csv"
                    ? "download"
                    : null,
          )
          .filter((name) => name !== null),
      ).toEqual(["header", "title", "count", "download"]);
      expect(numbersIn(findAll(element, Hint)[0]?.props.children)).toEqual([0, 7]);
    });

    it("AC4: the title is the page's one level-1 heading", async () => {
      addSupperClub(services.repo);
      const headings = findAll(await Admin(), Heading).filter((heading) => heading.props.level === undefined || heading.props.level === 1);
      expect(headings).toHaveLength(1);
    });

    it("AC4: n is the held spots, so it runs above the rows while a signup is mid-payment, and cap is the product's", async () => {
      const product = addSupperClub(services.repo, { cap: 7 });
      await activeSubscriber(services.repo, product, ROSA, PICKS);
      const midPayment = await pendingSignup(services.repo, product, CHIDI, PICKS);
      await services.repo.startSignupCharge(midPayment.subscriptionId, new Date());
      await pendingSignup(services.repo, product, MARCO, PICKS);

      const { element, rows } = await page();

      const hints = findAll(element, Hint);
      expect(hints).toHaveLength(1);
      expect(numbersIn(hints[0]?.props.children)).toEqual([2, 7]);
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
    const level2Of = (element: Awaited<ReturnType<typeof Admin>>) => findAll(element, Heading).filter((heading) => heading.props.level === 2);
    const expectEmpty = (element: Awaited<ReturnType<typeof Admin>>) => {
      expect(level2Of(element)).toHaveLength(1);
      expect(findAll(element, MembersList)).toEqual([]);
    };

    it("AC7: the card shows the empty-state heading and its line, and no list", async () => {
      addSupperClub(services.repo);
      expectEmpty(await Admin());
    });

    it("AC7: a signup mid-payment is not an active subscription: the card is still empty", async () => {
      const product = addSupperClub(services.repo);
      const midPayment = await pendingSignup(services.repo, product, ROSA, PICKS);
      await services.repo.startSignupCharge(midPayment.subscriptionId, new Date());
      expectEmpty(await Admin());
    });

    it("AC7: with active subscriptions the page shows the list and not the empty card", async () => {
      const product = addSupperClub(services.repo);
      await activeSubscriber(services.repo, product, ROSA, PICKS);

      const element = await Admin();

      expect(findAll(element, MembersList)).toHaveLength(1);
      expect(level2Of(element)).toEqual([]);
    });
  });

  describe("AC8 — the way to the spreadsheet", () => {
    it('AC8: "Download spreadsheet" is a secondary link to /admin/members.csv', async () => {
      addSupperClub(services.repo);

      const links = findAll(await Admin(), Button).filter((button) => button.props.href === "/admin/members.csv");

      expect(links).toHaveLength(1);
      expect(links[0]?.props).toMatchObject({ kind: "secondary" });
    });
  });

  // Issue 97: the header reads the session; on /admin the admin's Admin button is the page showing.
  describe("AC5 (issue 97) — the header on /admin", () => {
    it('AC5: the page asks for the header with account "none" and current "admin-members"', async () => {
      addSupperClub(services.repo);
      await Admin();
      expect(SiteHeader).toHaveBeenCalledWith({ account: "none", current: "admin-members" });
    });
  });

  // Issue 159: the admin links moved into the header (faked here), so the page draws no nav of its own.
  describe("AC5 (issue 159) — no admin nav under the header", () => {
    it("AC5: /admin draws no admin nav of its own: no link on it is marked as the page showing", async () => {
      addSupperClub(services.repo);
      expect(renderToStaticMarkup(await Admin())).not.toMatch(/\baria-current="page"/);
    });
  });

  // Issue 139: the list reads active and cancelled subscriptions, each with its own status (listSubscribers', in
  // src/adapters/signup-contract.ts); the list's own markup is app/admin/members-list.test.ts's. One case here.
  describe("AC9 (issue 139) — cancelled subscriptions on the list", () => {
    it("AC9: the list gets a cancelled subscription beside an active one, each with its status", async () => {
      const product = addSupperClub(services.repo);
      const rosa = await pendingSignup(services.repo, product, ROSA, PICKS);
      await services.repo.confirmSignupRows(rosa.ledgerId, `PAYMENT_${rosa.ledgerId}`, rosa.amountCents, new Date("2026-12-01T17:00:00.000Z"));
      await activeSubscriber(services.repo, product, CHIDI, PICKS);
      await services.repo.cancelSubscription(rosa.subscriptionId, new Date("2027-02-03T17:00:00.000Z"));

      const { rows } = await page();

      expect(Object.fromEntries(rows.map((row) => [row.email, row.status]))).toEqual({ "rosa@example.com": "cancelled", "chidi@example.com": "active" });
    });
  });

  // Issue 135: which rows carry the flag is listSubscribers' (src/adapters/charge-run-contract.ts), and the list's markup
  // is app/admin/members-list.test.ts's. Here the page hands the list each row's flag.
  describe("AC4 (issue 135) — Card declined on the list", () => {
    it("AC4: the list gets an active subscription holding a declined week with cardDeclined true, another without it false", async () => {
      const product = addSupperClub(services.repo);
      const rosa = await pendingSignup(services.repo, product, ROSA, PICKS);
      await services.repo.confirmSignupRows(rosa.ledgerId, `PAYMENT_${rosa.ledgerId}`, rosa.amountCents, new Date("2026-12-01T17:00:00.000Z"));
      await services.repo.addLedgerRow(rosa.subscriptionId, "2027-01-10", "declined", 5000);
      await activeSubscriber(services.repo, product, CHIDI, PICKS);

      const { rows } = await page();

      expect(Object.fromEntries(rows.map((row) => [row.email, row.cardDeclined]))).toEqual({ "rosa@example.com": true, "chidi@example.com": false });
    });
  });

  describe("AC11 — Joined on the screen", () => {
    it("AC11: a payment at 22:30 on December 1 in Cleveland, already December 2 in UTC, reads Dec 1", async () => {
      const product = addSupperClub(services.repo);
      await activeSubscriber(services.repo, product, ROSA, PICKS, new Date("2026-12-02T03:30:00.000Z"));

      const html = renderToStaticMarkup(await Admin());
      const body = /<tbody\b[^>]*>([\s\S]*?)<\/tbody>/.exec(html)?.[1] ?? "";
      const cells = [...body.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map(([, cell = ""]) => textsOf(cell).join(" "));

      expect(cells[4]).toBe("Dec\u00a01");
    });
  });

  // Issue 263: the list takes people, grouped by groupByMember (src/member-list.test.ts owns which subscription is current);
  // the never-subscribed card takes listUnsubscribedMembers' rows (src/adapters/signup-contract.ts owns who is in them). One
  // case each through the page, and where the card sits.
  describe("issue 263 — people on the list, and the never-subscribed card", () => {
    it("AC1, AC2: a member who cancelled and joined again is one person on the list: the active subscription current, the cancelled one earlier", async () => {
      const product = addSupperClub(services.repo);
      const first = await pendingSignup(services.repo, product, ROSA, PICKS);
      await services.repo.confirmSignupRows(first.ledgerId, `PAYMENT_${first.ledgerId}`, first.amountCents, new Date("2026-11-02T17:00:00.000Z"));
      await services.repo.cancelSubscription(first.subscriptionId, new Date("2026-11-10T17:00:00.000Z"));
      const again = await pendingSignup(services.repo, product, ROSA, PICKS);
      await services.repo.confirmSignupRows(again.ledgerId, `PAYMENT_${again.ledgerId}`, again.amountCents, new Date("2026-11-20T17:00:00.000Z"));

      const { list } = await page();
      const people = (list?.props.rows ?? []) as MemberRow[];

      expect(people.map((person) => ({ current: person.current.subscriptionId, earlier: person.earlier.map((row) => row.subscriptionId) }))).toEqual([
        { current: again.subscriptionId, earlier: [first.subscriptionId] },
      ]);
    });

    it("AC7: the never-subscribed card gets the members with no paid subscription: one who never signed up, and not the subscriber", async () => {
      const product = addSupperClub(services.repo);
      await activeSubscriber(services.repo, product, ROSA, PICKS);
      await services.repo.createMember({ email: "never@example.com" });

      const [card] = findAll(await Admin(), NeverSubscribedList);

      expect(((card?.props.rows ?? []) as { email: string }[]).map((row) => row.email)).toEqual(["never@example.com"]);
    });

    it.each([
      ["with a subscriber and nobody in the card", true, false],
      ["with no subscriber and a member who never signed up", false, true],
    ])("AC7, AC8: the never-subscribed card is on the page once, after the members card and outside it, %s", async (_what, subscribed, neverSigned) => {
      const product = addSupperClub(services.repo);
      if (subscribed) await activeSubscriber(services.repo, product, ROSA, PICKS);
      if (neverSigned) await services.repo.createMember({ email: "never@example.com" });

      const element = await Admin();
      const order = elementsOf(element);
      const [members] = findAll(element, Card);
      const cards = findAll(element, NeverSubscribedList);

      expect(cards).toHaveLength(1);
      expect(members).toBeDefined();
      expect(findAll(members, NeverSubscribedList)).toEqual([]);
      expect(order.indexOf(cards[0] as ReactElement<Record<string, unknown>>)).toBeGreaterThan(order.indexOf(members as ReactElement<Record<string, unknown>>));
    });
  });
});
