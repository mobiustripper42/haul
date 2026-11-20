// Issue 142: the skips download at the route, with `next/headers` faked and the composition root mocked, as
// app/admin/members.csv/route.test.ts calls its route. The response's headers are `csvResponse`'s
// (app/admin/csv-response.test.ts) and the CSV's rules `skipsCsv`'s (src/week-lists.test.ts): this checks the
// filename and the body, for one offered and one fallen-back week.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryRepository } from "@core/adapters/in-memory-repository.js";
import { parseCsv } from "@core/member-export-test-helpers.js";
import type { ProductWithOptions } from "@core/products.js";
import { emptyRequest } from "../../../next-headers-fake";
import { redirectOf } from "../../../screen-test-helpers";
import { addSupperClub, MENUS, SIZES } from "../../subscribers-fixture";
import { CHIDI, FEB_14, FEB_7, fourMembers, NOW, signInAs, subscribe } from "../lists-fixture";
import { GET } from "./route";

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
    throw new Error("the skips have no reason to send email");
  },
  getSessionSecret: () => services.secret,
}));

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

const get = (query = ""): Promise<Response> => GET(new Request(`http://localhost/admin/lists/skips.csv${query}`));

const filenameOf = (response: Response): string | undefined => /filename="([^"]+)"/.exec(response.headers.get("content-disposition") ?? "")?.[1];

const HEADER = ["Last name", "First name", "Email", "Phone", SIZES.name, MENUS.name];

describe("AC8 — only an admin", () => {
  it("AC8: a signed-out visitor goes to /sign-in", async () => {
    await expect(redirectOf(get(`?week=${FEB_14}`))).resolves.toBe("/sign-in");
  });

  it("AC8: a signed-in member whose role is not admin goes to /", async () => {
    await signInAs(services.repo, request.current, services.secret, "member");
    await expect(redirectOf(get(`?week=${FEB_14}`))).resolves.toBe("/");
  });
});

describe("AC6 — the skips CSV", () => {
  beforeEach(async () => {
    await signInAs(services.repo, request.current, services.secret, "admin");
    const { chidi } = await fourMembers(services.repo, product);
    // Chidi skips the first upcoming week, Lan February 14 (fourMembers): each week has its own skip.
    expect(await services.repo.skipWeek(chidi.subscriptionId, FEB_7)).toBe(true);
  });

  it("AC6: ?week= names the week: its skips, as supper-club-skips-{week}.csv", async () => {
    const response = await get(`?week=${FEB_14}`);
    expect(filenameOf(response)).toBe("supper-club-skips-2027-02-14.csv");
    expect(parseCsv(await response.text())).toEqual([HEADER, ["Nguyen", "Lan", "lan@example.com", "216-555-0101", "2 people", "Standard"]]);
  });

  // Issue 222: the Phone cell is memberCells' (src/member-export.test.ts); one formatted case through the route.
  it("AC5 (issue 222): a skip whose stored phone is 2165551234 has (216) 555-1234 in its Phone cell", async () => {
    const tam = await subscribe(services.repo, product, { email: "tam@example.com", firstName: "Tam", lastName: "Okafor", phone: "2165551234" }, ["2 people", "Standard"]);
    expect(await services.repo.skipWeek(tam.subscriptionId, FEB_14)).toBe(true);
    const rows = parseCsv(await (await get(`?week=${FEB_14}`)).text());
    expect(rows.find((record) => record[2] === "tam@example.com")?.[3]).toBe("(216) 555-1234");
  });

  it("AC8: a week the select does not offer falls back to the first upcoming week's", async () => {
    const response = await get("?week=2027-02-13");
    expect(filenameOf(response)).toBe("supper-club-skips-2027-02-07.csv");
    // The header row is the test above's.
    expect(parseCsv(await response.text()).slice(1)).toEqual([[CHIDI.lastName, CHIDI.firstName, CHIDI.email, CHIDI.phone, "3–4 people", "Standard"]]);
  });
});
