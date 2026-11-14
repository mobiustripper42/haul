// Issue 141, AC1 and AC2: the menu run's cron route, `GET` with the composition root mocked over the fakes, as
// app/api/charge-run/route.test.ts drives the charge run's, and the real menu run underneath: `runMenuRun` is wrapped,
// not replaced, so what the route hands it can be read. The run's own cases are src/menu-run.test.ts's, and the cron
// check's edge cases app/api/cron-auth.test.ts's: here one accepted and one refused case go through the route, and the
// run fires once over a week whose email is due and a week with no menu, so the event the route is declared to record
// (app/audit-entry-points.ts) is the one it records. The clock is pinned with fake Date.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeEmail } from "@core/adapters/fake-email.js";
import { InMemoryRepository } from "@core/adapters/in-memory-repository.js";
import { menuEmailWeekday, runMenuRun, type MenuRunReport } from "@core/menu-run.js";
import type { ProductWithOptions } from "@core/products.js";
import { MENUS, SIZES } from "../../admin/subscribers-fixture";
import { authorizedCron } from "../cron-auth";
import { GET } from "./route";

const services = vi.hoisted(() => ({
  repo: undefined as unknown as import("@core/adapters/in-memory-repository.js").InMemoryRepository,
  email: undefined as unknown as import("@core/adapters/fake-email.js").FakeEmail,
}));

vi.mock("../../services", () => ({
  getRepository: () => services.repo,
  getEmail: () => services.email,
  getSiteUrl: () => SITE_URL,
  getSessionSecret: () => SESSION_SECRET,
  // The real reading of the env, so the route meets the throw a bad MENU_EMAIL_WEEKDAY gives.
  getMenuEmailWeekday: () => menuEmailWeekday({ MENU_EMAIL_WEEKDAY: process.env.MENU_EMAIL_WEEKDAY }),
}));
vi.mock("@core/menu-run.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("@core/menu-run.js")>();
  return { ...real, runMenuRun: vi.fn(real.runMenuRun) };
});
vi.mock("../cron-auth", async (importOriginal) => {
  const real = await importOriginal<typeof import("../cron-auth")>();
  return { ...real, authorizedCron: vi.fn(real.authorizedCron) };
});

const SECRET = "cron-secret-0123456789abcdefghij";
const SAME_LENGTH = "cron-secret-0123456789abcdefghiJ";
const SESSION_SECRET = "test-session-secret-that-is-long-enough-0123456789";
// With a trailing slash, so the links show they were joined with one slash.
const SITE_URL = "https://members.example.test/";
/** Thursday January 14, 15:00 in Cleveland: January 17's email day with MENU_EMAIL_WEEKDAY 4. */
const RUN_AT = new Date("2027-01-14T20:00:00.000Z");
const WEEK = "2027-01-17";
const NEXT = "2027-01-24";

let product: ProductWithOptions;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: RUN_AT });
  services.repo = new InMemoryRepository();
  services.email = new FakeEmail();
  product = services.repo.addProduct({
    name: "Supper Club",
    cap: 50,
    firstPickupDate: "2027-01-03",
    cutoffWeekday: 1,
    cutoffTime: "24:00:00",
    optionTypes: [SIZES, { ...MENUS, menuTexts: true }],
  });
  vi.mocked(runMenuRun).mockClear();
  vi.mocked(authorizedCron).mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const fire = (authorization?: string): Promise<Response> =>
  GET(new Request("http://localhost/api/menu-run", authorization === undefined ? {} : { headers: { authorization } }));

/** January 17 holds a menu and one paid box; January 24 holds none; Lenny is an admin. */
async function aWeekToSend(): Promise<{ memberEmail: string; adminId: string }> {
  const repo = services.repo;
  const menus = product.optionTypes[1]?.options ?? [];
  const menu = await repo.createMenu({ name: "Autumn harvest", texts: Object.fromEntries(menus.map((option) => [option.id, `${option.name} soup`])) });
  await repo.assignWeekMenu(product.id, WEEK, menu.id);
  const saved = await repo.saveAccount({ email: "ada@example.com", firstName: "Ada", lastName: "Lovelace", phone: "216-555-0100", language: "en" });
  const signup = await repo.savePendingSignup({
    memberId: saved.id,
    productId: product.id,
    choices: Object.fromEntries(product.optionTypes.map((type) => [type.id, type.options[0]?.id ?? "no such option"])),
    firstChargeCents: 8000,
    weeklyCents: 8000,
    pickupDate: "2027-01-03",
    consentText: "I agree to a weekly charge until I cancel.",
    consentAt: new Date("2026-12-01T15:00:00.000Z"),
  });
  expect(await repo.confirmSignupRows(signup.ledgerId, "PAYMENT_SIGNUP", 8000, new Date("2026-12-01T15:00:00.000Z"))).toBe("confirmed");
  await repo.addLedgerRow(signup.subscriptionId, WEEK, "paid", 8000);
  const lenny = await repo.createMember({ email: "lenny@example.com", role: "admin" });
  return { memberEmail: saved.email, adminId: lenny.id };
}

/** What the route's call resolved to, or what it threw. */
const outcomeOf = (pending: Promise<Response>) =>
  pending.then(
    (response) => ({ returned: response instanceof Response, status: response.status }),
    (error: unknown) => ({ thrown: String(error) }),
  );

describe("AC1 — the secret fires the run", () => {
  it("AC1: with CRON_SECRET and Authorization: Bearer <it>, the run fires once, sends the week's menu and the reminder, records menu_reminder_sent, and the response is 200 with its report as JSON, not cached", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    vi.stubEnv("MENU_EMAIL_WEEKDAY", "4");
    const { memberEmail, adminId } = await aWeekToSend();

    const response = await fire(`Bearer ${SECRET}`);

    expect(runMenuRun).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type") ?? "no content-type").toMatch(/^application\/json\b/);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const expected: MenuRunReport = { menuEmail: { weekOf: WEEK, sent: 1 }, reminder: { weeks: [NEXT], sent: 1 } };
    expect(await response.json()).toEqual(expected);
    expect(services.email.sent.map((message) => message.to).sort()).toEqual([memberEmail, "lenny@example.com"]);
    expect(services.repo.events()).toEqual([expect.objectContaining({ kind: "menu_reminder_sent", memberId: adminId })]);
  });

  it("AC1: the run is given the app's repository and email, now at the request, the site URL, the Upcoming weeks, Weeks and menu links under it, the env's weekday and the session secret", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    vi.stubEnv("MENU_EMAIL_WEEKDAY", "4");

    await fire(`Bearer ${SECRET}`);

    expect(runMenuRun).toHaveBeenCalledTimes(1);
    expect(vi.mocked(runMenuRun).mock.calls[0]?.[0]).toEqual({
      repo: services.repo,
      email: services.email,
      now: RUN_AT,
      siteUrl: SITE_URL,
      accountWeeksUrl: "https://members.example.test/account/weeks",
      adminWeeksUrl: "https://members.example.test/admin/weeks",
      menuUrl: "https://members.example.test/menu",
      emailWeekday: 4,
      sessionSecret: SESSION_SECRET,
    });
  });

  it("AC1: anything but the secret is 404, a Response the route returns, and the run never fires", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    vi.stubEnv("MENU_EMAIL_WEEKDAY", "4");
    await aWeekToSend();

    expect(await outcomeOf(fire(`Bearer ${SAME_LENGTH}`))).toEqual({ returned: true, status: 404 });
    expect(runMenuRun).not.toHaveBeenCalled();
    expect(services.email.sent).toEqual([]);
  });

  it("AC1: the route asks the shared authorizedCron about the request it was given, not a copy of it", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    const request = new Request("http://localhost/api/menu-run", { headers: { authorization: `Bearer ${SAME_LENGTH}` } });

    await GET(request);

    expect(authorizedCron).toHaveBeenCalledWith(request);
  });
});

describe("AC2 — MENU_EMAIL_WEEKDAY", () => {
  it.each([
    ["unset", undefined],
    ["empty", ""],
    ["not a weekday", "7"],
    ["padded with a zero", "03"],
  ])("AC2: with the secret and MENU_EMAIL_WEEKDAY %s, the route returns a 500 with no body, and the run never fires or sends", async (_what, value) => {
    vi.stubEnv("CRON_SECRET", SECRET);
    vi.stubEnv("MENU_EMAIL_WEEKDAY", value);
    await aWeekToSend();

    const pending = fire(`Bearer ${SECRET}`);

    expect(await outcomeOf(pending)).toEqual({ returned: true, status: 500 });
    expect(await (await pending).text()).toBe("");
    expect(runMenuRun).not.toHaveBeenCalled();
    expect(services.email.sent).toEqual([]);
  });

  it("AC2: the bearer is checked first: a wrong secret is 404 whatever MENU_EMAIL_WEEKDAY holds", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    vi.stubEnv("MENU_EMAIL_WEEKDAY", "not a day");

    expect(await outcomeOf(fire(`Bearer ${SAME_LENGTH}`))).toEqual({ returned: true, status: 404 });
  });

  it("AC2: the weekday is read at each firing: changed to a bad value after a good one, the next firing is 500", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    vi.stubEnv("MENU_EMAIL_WEEKDAY", "4");
    expect((await fire(`Bearer ${SECRET}`)).status).toBe(200);

    vi.stubEnv("MENU_EMAIL_WEEKDAY", "8");
    expect((await fire(`Bearer ${SECRET}`)).status).toBe(500);
    expect(runMenuRun).toHaveBeenCalledTimes(1);
  });
});
