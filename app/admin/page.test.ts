// Issue 10, AC3–AC5, and issue 59's first render, through the page: `await Admin()` with `next/headers`
// faked and the composition root mocked, as app/page-sign-in.test.ts renders the home page. A signed-in
// request is an ocf_session cookie for a member in an InMemoryRepository. Issue 59 replaced the
// placeholder issue 10's AC6 described. What happens after the first render is e2e/admin-members.spec.ts.
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryRepository } from "@core/adapters/in-memory-repository.js";
import type { Role } from "@core/members.js";
import { signSession } from "@core/sign-in/session.js";
import { emptyRequest } from "../next-headers-fake";
import { attributesOf, redirectOf, screenMarkup, textsOf } from "../screen-test-helpers";
import Admin from "./page";
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

const DAY = 24 * 60 * 60_000;
const tokenFor = (subjectId: string, expiresAt: Date, secret = services.secret): string =>
  signSession({ subjectId, expiresAt: expiresAt.toISOString() }, secret);

beforeEach(() => {
  request.current = emptyRequest();
  services.repo = new InMemoryRepository();
});

async function signInAs(role: Role): Promise<void> {
  const member = await services.repo.createMember({ email: "lenny@example.com", role });
  request.current.cookies.ocf_session = tokenFor(member.id, new Date(Date.now() + DAY));
}

describe("AC3 (issue 10) — /admin, signed out", () => {
  it("AC3: with no ocf_session cookie /admin redirects to /sign-in", async () => {
    await expect(redirectOf(Admin())).resolves.toBe("/sign-in");
  });
});

describe("AC4 (issue 10) — /admin, a session that does not hold", () => {
  it.each([
    ["an expired token", (id: string) => tokenFor(id, new Date(Date.now() - 1000))],
    ["a token signed with another secret", (id: string) => tokenFor(id, new Date(Date.now() + DAY), "another-secret-that-is-long-enough-0123456789")],
    ["a token that is not a token", (id: string) => `not-a-token-for-${id}`],
  ])("AC4: for an admin, with %s /admin redirects to /sign-in", async (_what, token) => {
    const admin = await services.repo.createMember({ email: "lenny@example.com", role: "admin" });
    request.current.cookies = { ocf_session: token(admin.id) };
    await expect(redirectOf(Admin())).resolves.toBe("/sign-in");
  });

  it("AC4: with a valid token whose member no longer exists /admin redirects to /sign-in", async () => {
    request.current.cookies = { ocf_session: tokenFor("00000000-0000-4000-8000-000000000000", new Date(Date.now() + DAY)) };
    await expect(redirectOf(Admin())).resolves.toBe("/sign-in");
  });
});

describe("AC5 (issue 10) — /admin, signed in as a member", () => {
  it('AC5: for a member whose role is "member", /admin redirects to /', async () => {
    await signInAs("member");
    await expect(redirectOf(Admin())).resolves.toBe("/");
  });
});

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

/** The cells of each table row, each as its text. */
const tableRows = (html: string): string[][] => {
  const body = /<tbody\b[^>]*>([\s\S]*?)<\/tbody>/.exec(html)?.[1] ?? "";
  return [...body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].map(([, row = ""]) =>
    [...row.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/g)].map(([, cell = ""]) => textsOf(cell).join(" ")),
  );
};

/** Each column header: its word in capitals, whatever does the capitals, its aria-sort, and whether a button sorts it. */
const tableHeaders = (html: string) => {
  const head = /<thead\b[^>]*>([\s\S]*?)<\/thead>/.exec(html)?.[1] ?? "";
  return [...head.matchAll(/<th\b([^>]*)>([\s\S]*?)<\/th>/g)].map(([, attributes = "", cell = ""]) => ({
    word: textsOf(cell)[0]?.toUpperCase(),
    ariaSort: attributesOf(`<th${attributes}>`, "th")[0]?.["aria-sort"],
    sorts: attributesOf(cell, "button").length === 1,
  }));
};

describe("issue 59 — /admin, signed in as an admin", () => {
  const render = async () => renderToStaticMarkup(await Admin());

  const ROSA = { email: "rosa@example.com", firstName: "Rosa", lastName: "Bennett", phone: "(216) 555-0187" };
  const CHIDI = { email: "chidi@example.com", firstName: "Chidi", lastName: "Abara", phone: "(216) 555-0142" };
  const MARCO = { email: "marco@example.com", firstName: "Marco", lastName: "Castillo", phone: "(440) 555-0123" };

  beforeEach(async () => {
    await signInAs("admin");
  });

  describe("AC3 — the rows", () => {
    it('AC3: one row per active subscription: "Last, First", email, phone, the meal, the joined date and an Active badge', async () => {
      const product = addSupperClub(services.repo);
      await activeSubscriber(services.repo, product, ROSA, ["2 people", "Vegan"]);
      await activeSubscriber(services.repo, product, CHIDI, ["3–4 people", "Standard"], new Date("2026-12-11T17:00:00.000Z"));

      expect(tableRows(await render())).toEqual([
        ["Abara, Chidi", "chidi@example.com", "(216) 555-0142", "3–4 people · Standard", "Dec 11", "Active"],
        ["Bennett, Rosa", "rosa@example.com", "(216) 555-0187", "2 people · Vegan", "Dec 1", "Active"],
      ]);
    });

    it("AC3: a pending subscription does not appear", async () => {
      const product = addSupperClub(services.repo);
      await activeSubscriber(services.repo, product, ROSA, ["2 people", "Vegan"]);
      await pendingSignup(services.repo, product, CHIDI, ["2 people", "Vegan"]);

      const html = await render();

      expect(tableRows(html).map((row) => row[1])).toEqual(["rosa@example.com"]);
      expect(html).not.toContain("chidi@example.com");
    });

    it("AC3: a member with no name and no phone has empty cells, not the word null", async () => {
      const product = addSupperClub(services.repo);
      await activeSubscriber(services.repo, product, { email: "ada@example.com" }, ["2 people", "Vegan"]);

      expect(tableRows(await render())).toEqual([["", "ada@example.com", "", "2 people · Vegan", "Dec 1", "Active"]]);
    });

    it("AC3: the columns are NAME, EMAIL, PHONE, MEAL, JOINED and STATUS, in order", async () => {
      const product = addSupperClub(services.repo);
      await activeSubscriber(services.repo, product, ROSA, ["2 people", "Vegan"]);

      expect(tableHeaders(await render()).map((header) => header.word)).toEqual(["NAME", "EMAIL", "PHONE", "MEAL", "JOINED", "STATUS"]);
    });
  });

  describe("AC4 — the count line", () => {
    it("AC4: under the header sit the title, then the count, then Download spreadsheet", async () => {
      addSupperClub(services.repo, { cap: 7 });
      const html = await render();
      const texts = textsOf(html);
      const at = (text: string) => texts.indexOf(text);

      expect(html.indexOf("<header")).toBeGreaterThanOrEqual(0);
      expect(html.indexOf("<header")).toBeLessThan(html.indexOf("<h1"));
      expect(attributesOf(html, "h1")).toHaveLength(1);
      expect(at("Supper Club members")).toBeGreaterThanOrEqual(0);
      expect(at("0 of 7 subscriptions taken")).toBe(at("Supper Club members") + 1);
      expect(at("Download spreadsheet")).toBe(at("Supper Club members") + 2);
    });

    it("AC4: n is the held spots, so it runs above the rows while a signup is mid-payment, and cap is the product's", async () => {
      const product = addSupperClub(services.repo, { cap: 7 });
      await activeSubscriber(services.repo, product, ROSA, ["2 people", "Vegan"]);
      const midPayment = await pendingSignup(services.repo, product, CHIDI, ["2 people", "Vegan"]);
      await services.repo.saveSubscriptionCard(midPayment.subscriptionId, "ccof:card-1");
      await pendingSignup(services.repo, product, MARCO, ["2 people", "Vegan"]);

      const html = await render();

      expect(textsOf(html)).toContain("2 of 7 subscriptions taken");
      expect(tableRows(html)).toHaveLength(1);
    });
  });

  describe("AC5 — the list as it opens", () => {
    it("AC5: it opens sorted by name, ascending, whatever order the rows were made in", async () => {
      const product = addSupperClub(services.repo);
      await activeSubscriber(services.repo, product, MARCO, ["2 people", "Vegan"]);
      await activeSubscriber(services.repo, product, ROSA, ["2 people", "Vegan"]);
      await activeSubscriber(services.repo, product, CHIDI, ["2 people", "Vegan"]);

      expect(tableRows(await render()).map((row) => row[0])).toEqual(["Abara, Chidi", "Bennett, Rosa", "Castillo, Marco"]);
    });

    it('AC5: the search field is empty, labelled Search, with the placeholder "Name, email or phone"', async () => {
      const product = addSupperClub(services.repo);
      await activeSubscriber(services.repo, product, ROSA, ["2 people", "Vegan"]);

      const html = await render();
      const [field] = attributesOf(html, "input").filter((input) => input.placeholder === "Name, email or phone");

      expect(field).toBeDefined();
      expect(field?.value ?? "").toBe("");
      expect(textsOf(html)).toContain("Search");
    });
  });

  describe("AC6 — the headers as the list opens", () => {
    it("AC6: Name carries aria-sort ascending, and Meal, Joined and Status carry none", async () => {
      const product = addSupperClub(services.repo);
      await activeSubscriber(services.repo, product, ROSA, ["2 people", "Vegan"]);

      const headers = tableHeaders(await render());
      const ariaSort = (word: string) => headers.find((header) => header.word === word)?.ariaSort;

      expect(["NAME", "MEAL", "JOINED", "STATUS"].map(ariaSort)).toEqual(["ascending", "none", "none", "none"]);
    });

    it("AC6: Name, Meal, Joined and Status have a sort button, and Email and Phone do not", async () => {
      const product = addSupperClub(services.repo);
      await activeSubscriber(services.repo, product, ROSA, ["2 people", "Vegan"]);

      expect(tableHeaders(await render()).filter((header) => header.sorts).map((header) => header.word)).toEqual(["NAME", "MEAL", "JOINED", "STATUS"]);
    });
  });

  describe("AC7 — no active subscriptions", () => {
    const expectEmpty = (html: string) => {
      expect(textsOf(html)).toEqual(expect.arrayContaining(["No members yet", "The first signup appears here, with search, sorting and the spreadsheet."]));
      expect(screenMarkup(html)).toMatch(/<h2\b[^>]*>No members yet<\/h2>/);
      expect(attributesOf(html, "input")).toEqual([]);
      expect(attributesOf(html, "table")).toEqual([]);
    };

    it('AC7: the card shows the heading "No members yet" and its line, and no search or table', async () => {
      addSupperClub(services.repo);
      expectEmpty(await render());
    });

    it("AC7: a signup mid-payment is not an active subscription: the card is still empty", async () => {
      const product = addSupperClub(services.repo);
      const midPayment = await pendingSignup(services.repo, product, ROSA, ["2 people", "Vegan"]);
      await services.repo.saveSubscriptionCard(midPayment.subscriptionId, "ccof:card-1");
      expectEmpty(await render());
    });

    it("AC7: with active subscriptions the empty wording is not on the page", async () => {
      const product = addSupperClub(services.repo);
      await activeSubscriber(services.repo, product, ROSA, ["2 people", "Vegan"]);

      const html = await render();

      expect(tableRows(html)).toHaveLength(1);
      expect(html).not.toContain("No members yet");
    });
  });

  describe("AC8 — the way to the spreadsheet", () => {
    it('AC8: "Download spreadsheet" is a secondary link to /admin/members.csv', async () => {
      addSupperClub(services.repo);

      const html = await render();
      const links = attributesOf(html, "a").filter((link) => link.href === "/admin/members.csv");

      expect(links).toHaveLength(1);
      expect(links[0]?.class).toContain("btn-secondary");
      expect(screenMarkup(html)).toMatch(/<a\b[^>]*href="\/admin\/members\.csv"[^>]*>[\s\S]*?Download spreadsheet[\s\S]*?<\/a>/);
    });
  });

  describe("AC11 — Joined on the screen", () => {
    it("AC11: a payment at 22:30 on December 1 in Cleveland, already December 2 in UTC, reads Dec 1", async () => {
      const product = addSupperClub(services.repo);
      await activeSubscriber(services.repo, product, ROSA, ["2 people", "Vegan"], new Date("2026-12-02T03:30:00.000Z"));

      expect(tableRows(await render())[0]?.[4]).toBe("Dec 1");
    });
  });
});
