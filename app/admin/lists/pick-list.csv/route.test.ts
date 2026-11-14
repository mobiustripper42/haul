// Issue 142: the pick-list download at the route, with `next/headers` faked and the composition root mocked, as
// app/admin/members.csv/route.test.ts calls its route. The response's headers are `csvResponse`'s
// (app/admin/csv-response.test.ts) and the CSV's rules `pickListCsv`'s (src/week-lists.test.ts): this checks the
// filename and the body, for one offered and one fallen-back week.
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { InMemoryRepository } from "@core/adapters/in-memory-repository.js";
import { parseCsv } from "@core/member-export-test-helpers.js";
import type { ProductWithOptions } from "@core/products.js";
import { emptyRequest } from "../../../next-headers-fake";
import { redirectOf } from "../../../screen-test-helpers";
import { addSupperClub, MENUS, SIZES } from "../../subscribers-fixture";
import { FEB_14, fourMembers, NOW, signInAs } from "../lists-fixture";
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
    throw new Error("the pick list has no reason to send email");
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

const get = (query = ""): Promise<Response> => GET(new Request(`http://localhost/admin/lists/pick-list.csv${query}`));

const filenameOf = (response: Response): string | undefined => /filename="([^"]+)"/.exec(response.headers.get("content-disposition") ?? "")?.[1];

const HEADER = [SIZES.name, MENUS.name, "Meals"];

describe("AC8 — only an admin", () => {
  it("AC8: a signed-out visitor goes to /sign-in", async () => {
    await expect(redirectOf(get(`?week=${FEB_14}`))).resolves.toBe("/sign-in");
  });

  it("AC8: a signed-in member whose role is not admin goes to /", async () => {
    await signInAs(services.repo, request.current, services.secret, "member");
    await expect(redirectOf(get(`?week=${FEB_14}`))).resolves.toBe("/");
  });
});

describe("AC5 — the pick-list CSV", () => {
  beforeEach(async () => {
    await signInAs(services.repo, request.current, services.secret, "admin");
    await fourMembers(services.repo, product);
  });

  it("AC5: ?week= names the week: its pick list, as supper-club-pick-list-{week}.csv", async () => {
    const response = await get(`?week=${FEB_14}`);
    expect(filenameOf(response)).toBe("supper-club-pick-list-2027-02-14.csv");
    expect(parseCsv(await response.text())).toEqual([
      HEADER,
      ["3–4 people", "Standard", "2"],
      ["3–4 people", "Vegan", "0"],
      ["2 people", "Standard", "0"],
      ["2 people", "Vegan", "1"],
      ["Meals to make", "", "3"],
    ]);
  });

  it("AC8: with no week named it is the first upcoming week's", async () => {
    const response = await get();
    expect(filenameOf(response)).toBe("supper-club-pick-list-2027-02-07.csv");
    expect(parseCsv(await response.text())).toEqual([
      HEADER,
      ["3–4 people", "Standard", "2"],
      ["3–4 people", "Vegan", "0"],
      ["2 people", "Standard", "1"],
      ["2 people", "Vegan", "1"],
      ["Meals to make", "", "4"],
    ]);
  });
});
