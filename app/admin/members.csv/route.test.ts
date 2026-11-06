// Issue 59, AC1 and AC8–AC11 at the route: `GET` with `next/headers` faked and the composition root
// mocked, as app/admin/page.test.ts renders the page. The columns' and cells' own rules are proved on
// `subscribersCsv` in src/member-export.test.ts; these prove the route gives it what the product and
// the repository hold.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryRepository } from "@core/adapters/in-memory-repository.js";
import { parseCsv } from "@core/member-export-test-helpers.js";
import type { Role } from "@core/members.js";
import { signSession } from "@core/sign-in/session.js";
import { emptyRequest } from "../../next-headers-fake";
import { redirectOf } from "../../screen-test-helpers";
import { activeSubscriber, addSupperClub, MENUS, pendingSignup, SIZES } from "../subscribers-fixture";
import { GET } from "./route";

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
    throw new Error("the spreadsheet has no reason to send email");
  },
  getSessionSecret: () => services.secret,
}));

const get = (query = ""): Promise<Response> => (GET as (request: Request) => Promise<Response>)(new Request(`http://localhost/admin/members.csv${query}`));

async function signInAs(role: Role): Promise<void> {
  const member = await services.repo.createMember({ email: "lenny@example.com", role });
  const expiresAt = new Date(Date.now() + 24 * 60 * 60_000).toISOString();
  request.current.cookies.ocf_session = signSession({ subjectId: member.id, expiresAt }, services.secret);
}

const HEADER = ["Last name", "First name", "Email", "Phone", "How many people?", "Which menu?", "Joined"];

beforeEach(() => {
  request.current = emptyRequest();
  services.repo = new InMemoryRepository();
});

describe("AC1 — the spreadsheet is the admin's", () => {
  it("AC1: signed out, it redirects to /sign-in", async () => {
    await expect(redirectOf(get())).resolves.toBe("/sign-in");
  });

  it("AC1: a signed-in member whose role is not admin goes to /", async () => {
    await signInAs("member");
    await expect(redirectOf(get())).resolves.toBe("/");
  });

  it("AC1: a member's request is turned away before a row is read", async () => {
    await signInAs("member");
    const list = vi.spyOn(services.repo, "listSubscribers");
    await redirectOf(get());
    expect(list).not.toHaveBeenCalled();
  });
});

describe("AC8 — Download spreadsheet", () => {
  beforeEach(async () => {
    await signInAs("admin");
  });

  it("AC8: the response is text/csv with an attachment filename", async () => {
    addSupperClub(services.repo);
    const response = await get();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/^text\/csv\b/);
    expect(response.headers.get("content-disposition")).toMatch(/^attachment;\s*filename=.+\.csv/);
  });

  it("AC8: it holds every active subscription in last-name order then first-name, and no pending one", async () => {
    const product = addSupperClub(services.repo);
    await activeSubscriber(services.repo, product, { email: "ada@example.com", firstName: "Ada", lastName: "Okafor" }, ["2 people", "Vegan"]);
    await activeSubscriber(services.repo, product, { email: "tam@example.com", firstName: "Tam", lastName: "Nguyen" }, ["2 people", "Vegan"]);
    await activeSubscriber(services.repo, product, { email: "lan@example.com", firstName: "Lan", lastName: "Nguyen" }, ["2 people", "Vegan"]);
    await pendingSignup(services.repo, product, { email: "wait@example.com", firstName: "Wait", lastName: "Abara" }, ["2 people", "Vegan"]);

    const [, ...rows] = parseCsv(await (await get()).text());

    expect(rows.map((row) => row[2])).toEqual(["lan@example.com", "tam@example.com", "ada@example.com"]);
  });

  it("AC8: what the screen is searching or sorting by changes nothing, even if it reaches the URL", async () => {
    const product = addSupperClub(services.repo);
    await activeSubscriber(services.repo, product, { email: "ada@example.com", firstName: "Ada", lastName: "Okafor" }, ["2 people", "Vegan"]);
    await activeSubscriber(services.repo, product, { email: "tam@example.com", firstName: "Tam", lastName: "Nguyen" }, ["2 people", "Vegan"]);

    const [, ...rows] = parseCsv(await (await get("?q=okafor&sort=joined&direction=desc")).text());

    expect(rows.map((row) => row[2])).toEqual(["tam@example.com", "ada@example.com"]);
  });
});

describe("AC9 — the columns come from the product", () => {
  beforeEach(async () => {
    await signInAs("admin");
  });

  it("AC9: one row reads Last name, First name, Email, Phone, each option in its type's column, Joined", async () => {
    const product = addSupperClub(services.repo);
    await activeSubscriber(services.repo, product, { email: "rosa@example.com", firstName: "Rosa", lastName: "Bennett", phone: "216-555-0187" }, ["2 people", "Vegan"]);

    expect(parseCsv(await (await get()).text())).toEqual([HEADER, ["Bennett", "Rosa", "rosa@example.com", "216-555-0187", "2 people", "Vegan", "2026-12-01"]]);
  });

  it("AC9: with no active subscription the file is the header row alone", async () => {
    addSupperClub(services.repo);
    expect(parseCsv(await (await get()).text())).toEqual([HEADER]);
  });

  it("AC9: a third option type on the product adds a column with no code change", async () => {
    const product = addSupperClub(services.repo, {
      optionTypes: [SIZES, MENUS, { name: "Which pickup?", position: 3, options: [{ name: "Sunday", priceCents: 0, position: 1 }] }],
    });
    await activeSubscriber(services.repo, product, { email: "rosa@example.com", firstName: "Rosa", lastName: "Bennett", phone: "216-555-0187" }, ["2 people", "Vegan", "Sunday"]);

    expect(parseCsv(await (await get()).text())).toEqual([
      ["Last name", "First name", "Email", "Phone", "How many people?", "Which menu?", "Which pickup?", "Joined"],
      ["Bennett", "Rosa", "rosa@example.com", "216-555-0187", "2 people", "Vegan", "Sunday", "2026-12-01"],
    ]);
  });

  it("AC9: the columns follow the option types' positions, not their names", async () => {
    addSupperClub(services.repo, { optionTypes: [{ ...MENUS, position: 1 }, { ...SIZES, position: 2 }] });
    expect(parseCsv(await (await get()).text())[0]).toEqual(["Last name", "First name", "Email", "Phone", "Which menu?", "How many people?", "Joined"]);
  });
});

describe("AC11 — Joined in the spreadsheet", () => {
  it("AC11: a payment at 22:30 on December 1 in Cleveland, already December 2 in UTC, is joined 2026-12-01", async () => {
    await signInAs("admin");
    const product = addSupperClub(services.repo);
    await activeSubscriber(services.repo, product, { email: "rosa@example.com", firstName: "Rosa", lastName: "Bennett" }, ["2 people", "Vegan"], new Date("2026-12-02T03:30:00.000Z"));

    const [, row] = parseCsv(await (await get()).text());

    expect(row?.at(-1)).toBe("2026-12-01");
  });
});
