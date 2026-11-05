// Issue 55, AC2, AC13 and AC14: /supper-club/continue, the GET form's target. Issue 77, AC1 and AC2: the
// redirects now open the Supper Club page's panes. `next/headers` is faked,
// `redirect` throws as the real one does, and the composition root hands out an InMemoryRepository.
// The route is loaded afresh after stubbing NODE_ENV, so a cookie's `secure` holds whether it is read
// per call or at load.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryRepository } from "@core/adapters/in-memory-repository.js";
import type { ProductWithOptions } from "@core/products.js";
import { safeReturnTo } from "@core/return-to.js";
import { emptyRequest } from "../../next-headers-fake";
import { redirectOf } from "../../screen-test-helpers";

const request = vi.hoisted(() => ({ current: { cookies: {}, headers: {}, sets: [] } as import("../../next-headers-fake").RequestState }));
const services = vi.hoisted(() => ({
  repo: undefined as unknown as import("@core/adapters/in-memory-repository.js").InMemoryRepository,
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
    throw new Error("/supper-club/continue has no reason to send email");
  },
  getSessionSecret: () => "test-session-secret-that-is-long-enough-0123456789",
  getSiteUrl: () => "https://members.example.test",
}));

const RETURN_TO = "ocf_return_to";

let product: ProductWithOptions;

// An id the product lacks reads as a string that matches nothing, so a test fails on what it asserts.
const typeId = (type: number) => product.optionTypes[type]?.id ?? "no-such-type";
const optionId = (type: number, option: number) => product.optionTypes[type]?.options[option]?.id ?? "no-such-option";

beforeEach(() => {
  request.current = emptyRequest();
  services.repo = new InMemoryRepository();
  product = services.repo.addProduct({
    name: "Supper Club",
    cap: 50,
    firstPickupDate: "2027-01-03",
    cutoffWeekday: 1,
    cutoffTime: "24:00:00",
    optionTypes: [
      {
        name: "Size",
        position: 1,
        options: [
          { name: "2 person", priceCents: 5000, position: 1 },
          { name: "3–4 person", priceCents: 8000, position: 2 },
        ],
      },
      {
        name: "Preference",
        position: 2,
        options: [
          { name: "Standard", priceCents: 0, position: 1 },
          { name: "Vegan", priceCents: 0, position: 2 },
        ],
      },
    ],
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

async function get(query: string, nodeEnv = "development"): Promise<string> {
  vi.stubEnv("NODE_ENV", nodeEnv);
  vi.resetModules();
  const { GET } = await import("./route");
  return redirectOf(GET(new Request(`http://localhost:4000/supper-club/continue?${query}`)));
}

const returnCookies = () => request.current.sets.filter((cookie) => cookie.name === RETURN_TO);
const returnPath = () => returnCookies()[0]?.value;
const picked = (size: number, menu: number) =>
  `${typeId(0)}=${optionId(0, size)}&${typeId(1)}=${optionId(1, menu)}`;

describe("AC2 — the form's target", () => {
  it("AC1 (issue 77): next=create-account redirects to /supper-club/create-account", async () => {
    expect(await get(`${picked(1, 1)}&next=create-account`)).toBe("/supper-club/create-account");
  });

  it("AC2 (issue 77): next=sign-in redirects to /supper-club/sign-in", async () => {
    expect(await get(`${picked(1, 1)}&next=sign-in`)).toBe("/supper-club/sign-in");
  });

  it.each(["next=somewhere", "next=", ""])("AC2 (issue 77): anything else (%j) redirects to /supper-club/sign-in", async (next) => {
    expect(await get(`${picked(1, 1)}&${next}`)).toBe("/supper-club/sign-in");
  });

  it("AC2: it sets ocf_return_to to /supper-club?<choices>, the choices picked when the button was pressed", async () => {
    await get(`${picked(1, 1)}&next=create-account`);
    expect(returnPath()).toBe(`/supper-club?${picked(1, 1)}`);
  });

  it("AC2: the other button carries the same choices", async () => {
    await get(`${picked(1, 0)}&next=sign-in`);
    expect(returnPath()).toBe(`/supper-club?${picked(1, 0)}`);
  });

  it("AC2: the cookie has SIGN_IN_EMAIL_COOKIE's options and max age", async () => {
    await get(`${picked(0, 0)}&next=sign-in`, "development");
    expect(returnCookies()).toHaveLength(1);
    expect(returnCookies()[0]).toMatchObject({ maxAge: 600, httpOnly: true, sameSite: "lax", path: "/" });
    expect(Boolean(returnCookies()[0]?.secure)).toBe(false);
  });

  it("AC2: in production the cookie is secure", async () => {
    await get(`${picked(0, 0)}&next=sign-in`, "production");
    expect(returnCookies()).toEqual([expect.objectContaining({ secure: true })]);
  });
});

describe("AC14 — the return path carries the resolved choices, never the raw query", () => {
  it("AC14: a choice that is missing resolves to the type's first option", async () => {
    await get(`${typeId(1)}=${optionId(1, 1)}&next=sign-in`);
    expect(returnPath()).toBe(`/supper-club?${picked(0, 1)}`);
  });

  it("AC14: a choice that is not one of the type's options resolves to the type's first option", async () => {
    await get(`${typeId(0)}=not-an-option&${typeId(1)}=${optionId(1, 1)}&next=sign-in`);
    expect(returnPath()).toBe(`/supper-club?${picked(0, 1)}`);
  });

  it("AC14: keys that name no option type, next included, are not carried, and the order is the product's", async () => {
    await get(`evil=1&${typeId(1)}=${optionId(1, 1)}&next=create-account&${typeId(0)}=${optionId(0, 1)}`);
    expect(returnPath()).toBe(`/supper-club?${picked(1, 1)}`);
  });
});

describe("AC13 — the path set is one safeReturnTo keeps", () => {
  it("AC13: a query trying to reach another site sets a path that stays on this one", async () => {
    await get(`${typeId(0)}=${encodeURIComponent("//evil.com")}&${typeId(1)}=${encodeURIComponent("\\evil")}&next=sign-in`);
    expect(returnPath()).toBe(`/supper-club?${picked(0, 0)}`);
    expect(safeReturnTo(returnPath())).toBe(returnPath());
  });
});
