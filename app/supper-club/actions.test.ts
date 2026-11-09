// Issue 77, AC4, AC8 and AC9: the pane's server actions, each the action it mirrors with the pane's fixed
// page set. As app/create-account/actions.test.ts: `next/headers` is faked, `redirect` throws as the real
// one does, `after` collects its callback for the test to run, and the composition root hands out an
// InMemoryRepository and a FakeEmail. Issue 56: the two pay actions, over a FakePayments; what signUp and
// retrySignup do is src/signup.test.ts, and this holds the door: who gets in and where each outcome lands.
import { inspect } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeEmail } from "@core/adapters/fake-email.js";
import { FakePayments } from "@core/adapters/fake-payments.js";
import { InMemoryRepository } from "@core/adapters/in-memory-repository.js";
import { createTranslator } from "@core/i18n.js";
import type { Member } from "@core/members.js";
import type { EmailPort } from "@core/ports/email.js";
import { PaymentsError } from "@core/ports/payments.js";
import type { ProductWithOptions } from "@core/products.js";
import { hashCode } from "@core/sign-in/code.js";
import { signSession, verifySession } from "@core/sign-in/session.js";
import { emptyRequest, type CookieSet } from "../next-headers-fake";
import { ACCOUNT_PATH } from "../paths";
import { redirectOf } from "../screen-test-helpers";
import { PANE_CREATE_PAGES, PANE_SIGN_IN_PAGES, PAY_ERROR_SOLD_OUT } from "./paths";

const request = vi.hoisted(() => ({ current: { cookies: {}, headers: {}, sets: [] } as import("../next-headers-fake").RequestState }));
const services = vi.hoisted(() => ({
  repo: undefined as unknown as import("@core/adapters/in-memory-repository.js").InMemoryRepository,
  email: undefined as unknown as import("@core/ports/email.js").EmailPort,
  payments: undefined as unknown as import("@core/adapters/fake-payments.js").FakePayments,
  secret: "test-session-secret-that-is-long-enough-0123456789",
  siteUrl: "https://members.example.test",
}));
const scheduled = vi.hoisted(() => ({ tasks: [] as unknown[] }));

vi.mock("next/headers", async () => {
  const { fakeNextHeaders } = await import("../next-headers-fake");
  return {
    cookies: () => fakeNextHeaders(request.current).cookies(),
    headers: () => fakeNextHeaders(request.current).headers(),
  };
});
vi.mock("next/navigation", async () => ({ redirect: (await import("../screen-test-helpers")).throwingRedirect }));
vi.mock("next/server", () => ({
  after: (task: unknown) => {
    scheduled.tasks.push(task);
  },
}));
vi.mock("../services", () => ({
  getRepository: () => services.repo,
  getEmail: () => services.email,
  getPayments: () => services.payments,
  getSessionSecret: () => services.secret,
  getSiteUrl: () => services.siteUrl,
}));

// 14:25:30 UTC: 34 min 30 s left in the clock hour the request limit counts in.
const T0 = new Date("2026-10-28T14:25:30.000Z");
const HOUR_START = new Date("2026-10-28T14:00:00.000Z");
const MINUTE = 60_000;
const SIGN_IN_EMAIL = "ocf_sign_in_email";
const DRAFT = "ocf_account_draft";
const RETURN_TO = "ocf_return_to";
const SESSION = "ocf_session";
const ADDRESS = "203.0.113.7";
const ADA = "ada@example.com";
const RIGHT_CODE = "123456";
const WRONG_CODE = "654321";
const PICKS = "/supper-club?size=four&menu=vegan";

const CREATE = "/supper-club/create-account";
const SIGN_IN = "/supper-club/sign-in";

const REFUSAL = { kind: "rate_limit_refusal", bucket: "sign-in-request", key: ADDRESS, windowStart: HOUR_START, actor: null };

let repo: InMemoryRepository;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: T0 });
  request.current = emptyRequest();
  request.current.headers = { "x-forwarded-for": ADDRESS };
  scheduled.tasks = [];
  repo = new InMemoryRepository();
  services.repo = repo;
  services.email = new FakeEmail();
  services.payments = new FakePayments();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const load = () => import("./actions");

const form = (fields: Record<string, string>): FormData => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.append(name, value);
  return data;
};

const details = (over: Record<string, string> = {}): FormData =>
  form({ firstName: "Ada", lastName: "Lovelace", email: ADA, phone: "216-555-0100", language: "en", ...over });

const setsNamed = (name: string): CookieSet[] => request.current.sets.filter((cookie) => cookie.name === name);
const cookieGone = (name: string): boolean => !(name in request.current.cookies) || request.current.cookies[name] === "";

async function runScheduled(): Promise<void> {
  for (const task of scheduled.tasks.splice(0)) await (typeof task === "function" ? task() : task);
}

/** A member with a live code, and the email cookie the code step reads. */
const memberAtCodeStep = async (): Promise<Member> => {
  const member = await repo.createMember({ email: ADA });
  const createdAt = new Date();
  await repo.saveSignInCode({
    subjectId: member.id,
    codeHash: hashCode(RIGHT_CODE),
    createdAt,
    expiresAt: new Date(createdAt.getTime() + 10 * MINUTE),
  });
  request.current.cookies = { [SIGN_IN_EMAIL]: ADA };
  return member;
};

const VERIFY = [
  ["verifyPaneCode", SIGN_IN],
  ["verifyPaneAccountCode", CREATE],
] as const;

describe("the pane's page sets", () => {
  it("AC1: PANE_CREATE_PAGES is the Create Account pane, its code step, and /supper-club when no return path is held", () => {
    expect(PANE_CREATE_PAGES).toEqual({ start: CREATE, code: `${CREATE}/code`, done: "/supper-club" });
  });

  it("AC2: PANE_SIGN_IN_PAGES is the sign-in pane, its code step, and /supper-club when no return path is held", () => {
    expect(PANE_SIGN_IN_PAGES).toEqual({ start: SIGN_IN, code: `${SIGN_IN}/code`, done: "/supper-club" });
  });
});

describe.each(VERIFY)("%s — a confirmed code", (name) => {
  const verify = async (fields: Record<string, string>) => (await load())[name](form(fields));

  it(`AC9: ${name} lands on the return path, signed in, with the flow's cookies gone`, async () => {
    const member = await memberAtCodeStep();
    request.current.cookies[RETURN_TO] = PICKS;
    expect(await redirectOf(verify({ code: RIGHT_CODE }))).toBe(PICKS);
    expect(verifySession(setsNamed(SESSION)[0]?.value ?? "", services.secret, new Date())).toMatchObject({
      ok: true,
      session: { subjectId: member.id },
    });
    expect(cookieGone(RETURN_TO)).toBe(true);
    expect(cookieGone(SIGN_IN_EMAIL)).toBe(true);
    expect((await repo.findMemberById(member.id))?.emailConfirmedAt).toEqual(T0);
  });

  it(`AC9: ${name} records one sign_in_by_code event for the member`, async () => {
    const member = await memberAtCodeStep();
    await redirectOf(verify({ code: RIGHT_CODE }));
    expect(repo.events()).toEqual([{ kind: "sign_in_by_code", memberId: member.id, actor: { member: member.id } }]);
  });

  it(`AC4: ${name} with no return path in the cookie lands on /supper-club`, async () => {
    await memberAtCodeStep();
    expect(await redirectOf(verify({ code: RIGHT_CODE }))).toBe("/supper-club");
  });

  it(`AC4: ${name} with a bad return path still gives /, never /supper-club`, async () => {
    await memberAtCodeStep();
    request.current.cookies[RETURN_TO] = "//evil.com";
    expect(await redirectOf(verify({ code: RIGHT_CODE }))).toBe("/");
  });
});

describe.each(VERIFY)("%s — a code that fails stays in the pane", (name, pane) => {
  const verify = async (fields: Record<string, string>) => (await load())[name](form(fields));

  it(`AC8: ${name}, a wrong code goes back to ${pane}/code?error=invalid and signs nobody in`, async () => {
    await memberAtCodeStep();
    expect(await redirectOf(verify({ code: WRONG_CODE }))).toBe(`${pane}/code?error=invalid`);
    expect(setsNamed(SESSION)).toEqual([]);
  });

  it(`AC8: ${name}, with the email cookie gone goes to ${pane}?error=expired`, async () => {
    expect(await redirectOf(verify({ code: RIGHT_CODE }))).toBe(`${pane}?error=expired`);
  });

  it(`AC8: ${name}, the fifth wrong guess stays in the pane and records one lock event`, async () => {
    const member = await memberAtCodeStep();
    for (let guess = 1; guess <= 5; guess++) {
      expect(await redirectOf(verify({ code: WRONG_CODE }))).toBe(`${pane}/code?error=invalid`);
    }
    await runScheduled();
    expect(repo.events()).toEqual([{ kind: "lock", memberId: member.id, actor: { member: member.id } }]);
  });
});

describe("requestPaneCode", () => {
  it("AC8: a member's email goes on to /supper-club/sign-in/code, with the email cookie set", async () => {
    await repo.createMember({ email: ADA });
    const { requestPaneCode } = await load();
    expect(await redirectOf(requestPaneCode(form({ email: ADA })))).toBe(`${SIGN_IN}/code`);
    expect(setsNamed(SIGN_IN_EMAIL).map((cookie) => cookie.value)).toEqual([ADA]);
  });

  it("AC8: a blank email goes back to the pane's email step", async () => {
    const { requestPaneCode } = await load();
    expect(await redirectOf(requestPaneCode(form({ email: "  " })))).toBe(SIGN_IN);
  });

  it("AC8: limited, it goes back to /supper-club/sign-in?limited=<minutes>, and records the window's refusal", async () => {
    const { requestPaneCode } = await load();
    for (let i = 0; i < 20; i++) await redirectOf(requestPaneCode(form({ email: ADA })));
    expect(await redirectOf(requestPaneCode(form({ email: ADA })))).toBe(`${SIGN_IN}?limited=35`);
    expect(repo.events()).toEqual([REFUSAL]);
  });

  // Issue 101, AC2: the rule is requestCodeFor's (app/sign-in/actions.test.ts); this is the pane's resend through it.
  it("AC2 (issue 101): with resend=1 it goes on to /supper-club/sign-in/code?sent=1", async () => {
    await repo.createMember({ email: ADA });
    const { requestPaneCode } = await load();
    expect(await redirectOf(requestPaneCode(form({ email: ADA, resend: "1" })))).toBe(`${SIGN_IN}/code?sent=1`);
  });
});

describe("requestPaneAccountCode", () => {
  it("AC8: good details go on to /supper-club/create-account/code, with the email cookie set", async () => {
    const { requestPaneAccountCode } = await load();
    expect(await redirectOf(requestPaneAccountCode(details()))).toBe(`${CREATE}/code`);
    expect(setsNamed(SIGN_IN_EMAIL).map((cookie) => cookie.value)).toEqual([ADA]);
  });

  it("AC8: failing fields go back to /supper-club/create-account?error=<fields>, with the draft kept to refill the form", async () => {
    const { requestPaneAccountCode } = await load();
    const entered = { firstName: "", lastName: "Lovelace", email: "nope", phone: "216-555-0100", language: "es" };
    expect(await redirectOf(requestPaneAccountCode(form(entered)))).toBe(`${CREATE}?error=firstName,email`);
    expect(JSON.parse(setsNamed(DRAFT)[0]?.value ?? "null")).toEqual(entered);
  });

  it("AC8: limited, it goes back to /supper-club/create-account?limited=<minutes>, and records the window's refusal", async () => {
    const { requestPaneAccountCode } = await load();
    for (let i = 0; i < 20; i++) await redirectOf(requestPaneAccountCode(details()));
    expect(await redirectOf(requestPaneAccountCode(details()))).toBe(`${CREATE}?limited=35`);
    expect(repo.events()).toEqual([REFUSAL]);
  });
});

describe("resendPaneAccountCode", () => {
  it("AC8: a resent code goes back to /supper-club/create-account/code", async () => {
    request.current.cookies = { [SIGN_IN_EMAIL]: ADA };
    const { resendPaneAccountCode } = await load();
    expect(await redirectOf(resendPaneAccountCode(form({})))).toBe(`${CREATE}/code`);
  });

  it("AC8: with the email cookie gone it goes to /supper-club/create-account?error=expired", async () => {
    const { resendPaneAccountCode } = await load();
    expect(await redirectOf(resendPaneAccountCode(form({})))).toBe(`${CREATE}?error=expired`);
  });

  it("AC8: limited, it goes back to /supper-club/create-account?limited=<minutes>, and records the window's refusal", async () => {
    const { requestPaneAccountCode, resendPaneAccountCode } = await load();
    for (let i = 0; i < 20; i++) await redirectOf(requestPaneAccountCode(details()));
    expect(await redirectOf(resendPaneAccountCode(form({})))).toBe(`${CREATE}?limited=35`);
    expect(repo.events()).toEqual([REFUSAL]);
  });

  // Issue 101, AC2: the rule is requestCodeFor's (app/sign-in/actions.test.ts); this is the pane's resend through it.
  it("AC2 (issue 101): with resend=1, a resent code goes back to /supper-club/create-account/code?sent=1", async () => {
    request.current.cookies = { [SIGN_IN_EMAIL]: ADA };
    const { resendPaneAccountCode } = await load();
    expect(await redirectOf(resendPaneAccountCode(form({ resend: "1" })))).toBe(`${CREATE}/code?sent=1`);
  });
});

describe("issue 56 — the pay actions", () => {
  const SOURCE = "cnon:card-nonce-ok";
  const CONSENT_50 = "I agree to a weekly charge of $50 until I cancel, and to the Terms and Privacy Policy. To cancel, sign in to your account before the end of Monday.";
  const CONSENT_80 = "I agree to a weekly charge of $80 until I cancel, and to the Terms and Privacy Policy. To cancel, sign in to your account before the end of Monday.";

  let product: ProductWithOptions;
  let member: Member;
  let sizeId: string;
  let menuId: string;
  let optionIds: { two: string; four: string; standard: string; vegan: string };

  beforeEach(async () => {
    product = repo.addProduct({
      name: "Supper Club",
      cap: 50,
      firstPickupDate: "2027-01-03",
      cutoffWeekday: 1,
      cutoffTime: "24:00:00",
      optionTypes: [
        {
          name: "How many people?",
          position: 1,
          options: [
            { name: "2 people", priceCents: 5000, position: 1 },
            { name: "3–4 people", priceCents: 8000, position: 2 },
          ],
        },
        {
          name: "Which menu?",
          position: 2,
          options: [
            { name: "Standard", priceCents: 0, position: 1 },
            { name: "Vegan", priceCents: 0, position: 2 },
          ],
        },
      ],
    });
    const [size, menu] = product.optionTypes;
    sizeId = size?.id ?? "no size type";
    menuId = menu?.id ?? "no menu type";
    optionIds = {
      two: size?.options[0]?.id ?? "no option",
      four: size?.options[1]?.id ?? "no option",
      standard: menu?.options[0]?.id ?? "no option",
      vegan: menu?.options[1]?.id ?? "no option",
    };
    member = await repo.createMember({ email: ADA });
    await repo.confirmMemberEmail(member.id, T0);
  });

  const signIn = () => {
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    request.current.cookies = { [SESSION]: signSession({ subjectId: member.id, expiresAt }, services.secret) };
  };

  const pay = (over: Record<string, string> = {}) =>
    form({ [sizeId]: optionIds.four, [menuId]: optionIds.vegan, sourceId: SOURCE, consent: "on", ...over });

  const unticked = () => {
    const fields = pay();
    fields.delete("consent");
    return fields;
  };

  const join = async (fields: FormData) => redirectOf((await load()).joinSupperClub(fields));
  const retry = async () => redirectOf((await load()).retrySupperClubPayment());

  /** The redirect's path and each query value, whatever order they come in. */
  const landed = (to: string) => {
    const url = new URL(to, "https://members.example.test");
    return { path: url.pathname, query: Object.fromEntries(url.searchParams) };
  };

  const picksKept = () => ({ [sizeId]: optionIds.four, [menuId]: optionIds.vegan });

  const noAnswer = () => new DOMException("The operation timed out.", "TimeoutError");

  const nextCardDeclines = () => {
    const real = services.payments.saveCard.bind(services.payments);
    vi.spyOn(services.payments, "saveCard").mockImplementationOnce(async (input) => {
      const card = await real(input);
      services.payments.declineCard(card.id, "GENERIC_DECLINE");
      return card;
    });
  };

  const stranded = async () => {
    signIn();
    vi.spyOn(services.payments, "charge").mockRejectedValueOnce(noAnswer()).mockRejectedValueOnce(noAnswer());
    await join(pay());
  };

  describe("joinSupperClub", () => {
    it("AC8: a paid signup lands on /supper-club/done", async () => {
      signIn();
      expect(await join(pay())).toBe("/supper-club/done");
      expect(await repo.findActiveSubscription(member.id, product.id)).not.toBeNull();
    });

    it("AC1: a visitor with no session goes to the sign-in pane, and nothing happens", async () => {
      expect(await join(pay())).toBe(SIGN_IN);
      expect(services.payments.customers).toEqual([]);
      expect(services.payments.charges).toEqual([]);
    });

    it("AC4: pay is refused without the tick: back to the page with payError=consent, the picks kept, nothing charged", async () => {
      signIn();
      expect(landed(await join(unticked()))).toEqual({ path: "/supper-club", query: { payError: "consent", ...picksKept() } });
      expect(services.payments.customers).toEqual([]);
      expect(services.payments.charges).toEqual([]);
      expect(await repo.findPendingSignup(member.id, product.id)).toBeNull();
    });

    it("AC2: the charge comes from the option ids, never from anything else in the form", async () => {
      signIn();
      await join(pay({ amountCents: "100", priceCents: "100", price: "1" }));
      expect(services.payments.charges.map((charge) => charge.amountCents)).toEqual([8000]);
    });

    it("AC4: the consent wording is built on the server for the price charged, and never read from the form", async () => {
      signIn();
      const save = vi.spyOn(repo, "savePendingSignup");
      await join(pay({ consentText: CONSENT_50 }));
      const stored = save.mock.calls[0]?.[0].consentText;
      expect(stored).toContain(CONSENT_80);
      expect(stored).not.toContain(CONSENT_50);
    });

    it("AC5 (issue 63): what is stored is the whole sentence as shown, in plain words, within the panel and pickup line text", async () => {
      signIn();
      const save = vi.spyOn(repo, "savePendingSignup");
      await join(pay());
      expect(save.mock.calls[0]?.[0].consentText).toBe(
        "Today, for your first week: $80. Then every week, at the cutoff: $80. " +
          "First pickup: Sunday, January 3. After that, your card is charged $80 at the end of each Monday for the following week's pickup, until you cancel. " +
          CONSENT_80,
      );
    });

    it("AC4: the wording and its time are stored as of now", async () => {
      signIn();
      const save = vi.spyOn(repo, "savePendingSignup");
      await join(pay());
      expect(save.mock.calls[0]?.[0].consentAt).toEqual(T0);
    });

    it("AC9: a decline goes back to the page with payError=declined, the picks kept, and records card_declined", async () => {
      signIn();
      nextCardDeclines();
      expect(landed(await join(pay()))).toEqual({ path: "/supper-club", query: { payError: "declined", ...picksKept() } });
      expect(repo.events().map((event) => event.kind)).toEqual(["card_declined"]);
    });

    it("AC10: no answer goes back to the page with payError=unknown, and records charge_outcome_unknown", async () => {
      await stranded();
      const row = await repo.findPendingSignup(member.id, product.id);
      expect(row).toMatchObject({ ledgerStatus: "pending" });
      expect(repo.events().map((event) => event.kind)).toEqual(["charge_outcome_unknown"]);
    });

    it("AC10: the redirect there is payError=unknown", async () => {
      signIn();
      vi.spyOn(services.payments, "charge").mockRejectedValue(noAnswer());
      expect(landed(await join(pay()))).toMatchObject({ path: "/supper-club", query: { payError: "unknown" } });
    });

    it("AC10a: an error before the charge goes back to the page with payError=error, the picks kept", async () => {
      signIn();
      const outage = new PaymentsError({ status: 503, category: "API_ERROR", code: "SERVICE_UNAVAILABLE", detail: "Try later." });
      vi.spyOn(services.payments, "findCustomersByEmail").mockRejectedValueOnce(outage);
      expect(landed(await join(pay()))).toEqual({ path: "/supper-club", query: { payError: "error", ...picksKept() } });
      expect(services.payments.charges).toEqual([]);
    });

    it("AC5: a member who already has a box, from a second tab, lands on /supper-club/already, with one already_subscribed event", async () => {
      signIn();
      await join(pay());
      expect(await join(pay({ sourceId: "cnon:second-tab" }))).toBe("/supper-club/already");
      expect(repo.events().map((event) => event.kind)).toEqual(["already_subscribed"]);
      expect(services.payments.charges).toHaveLength(1);
    });

    it("AC6: a link to an existing customer records square_customer_linked", async () => {
      signIn();
      services.payments.addCustomer({ email: ADA, createdAt: T0, updatedAt: T0 });
      await join(pay());
      expect(repo.events().map((event) => event.kind)).toEqual(["square_customer_linked"]);
    });

    it("AC6: several customers record square_customer_linked and square_customer_duplicates", async () => {
      signIn();
      services.payments.addCustomer({ email: ADA, createdAt: T0, updatedAt: T0 });
      services.payments.addCustomer({ email: ADA, createdAt: T0, updatedAt: T0 });
      await join(pay());
      expect(repo.events().map((event) => event.kind).sort()).toEqual(["square_customer_duplicates", "square_customer_linked"]);
    });

    describe("issue 57 — sold out", () => {
      /** Every spot under the product's cap taken by another member. */
      const fillTheClub = async () => {
        for (let spot = 1; spot <= product.cap; spot++) {
          const other = await repo.createMember({ email: `other-${spot}@example.com` });
          const { ledgerId, amountCents } = await repo.savePendingSignup({
            memberId: other.id,
            productId: product.id,
            choices: picksKept(),
            firstChargeCents: 8000,
            weeklyCents: 8000,
            pickupDate: "2027-01-03",
            consentText: CONSENT_80,
            consentAt: T0,
          });
          await repo.confirmSignupRows(ledgerId, `PAYMENT_${spot}`, amountCents, T0);
        }
      };

      it("AC9, AC10 (issue 57): a sold_out signup lands on /supper-club?payError=soldout, charges nothing, and records sold_out", async () => {
        await fillTheClub();
        signIn();
        expect(landed(await join(pay()))).toMatchObject({ path: "/supper-club", query: { payError: "soldout" } });
        expect(services.payments.charges).toEqual([]);
        expect(repo.events().map((event) => event.kind)).toEqual(["sold_out"]);
      });

      it("AC5, AC9 (issue 57): the value the page and this action share is PAY_ERROR_SOLD_OUT, soldout", () => {
        expect(PAY_ERROR_SOLD_OUT).toBe("soldout");
      });
    });
  });

  describe("retrySupperClubPayment", () => {
    it("AC10: a visitor with no session goes to the sign-in pane", async () => {
      expect(await retry()).toBe(SIGN_IN);
    });

    it("AC10: a paid result lands on /supper-club/done", async () => {
      await stranded();
      expect(await retry()).toBe("/supper-club/done");
      expect(await repo.findActiveSubscription(member.id, product.id)).not.toBeNull();
      expect(services.payments.charges).toHaveLength(1);
    });

    it("AC10: a decline goes back to the normal form with payError=declined, and records card_declined", async () => {
      signIn();
      nextCardDeclines();
      vi.spyOn(services.payments, "charge").mockRejectedValueOnce(noAnswer()).mockRejectedValueOnce(noAnswer());
      await join(pay());
      expect(landed(await retry())).toMatchObject({ path: "/supper-club", query: { payError: "declined" } });
      expect(repo.events().map((event) => event.kind)).toContain("card_declined");
    });

    it("AC10: still no answer goes back to the page with payError=unknown", async () => {
      await stranded();
      vi.spyOn(services.payments, "findPaymentByReference").mockRejectedValueOnce(noAnswer());
      expect(landed(await retry())).toMatchObject({ path: "/supper-club", query: { payError: "unknown" } });
    });
  });

  // Issue 102, AC1 and AC2: what signUp and retrySignup do with the clock is src/signup.test.ts; these hold that
  // each action hands them one that reads the time when it is read, by moving the faked Date inside Square's answer.
  describe("AC1, AC2 (issue 102) — paid_at is when the paid answer came back", () => {
    it("AC1: joinSupperClub confirms the rows at the time the charge came back, and consent_at stays the request's start", async () => {
      const answered = new Date("2026-10-28T14:25:33.000Z");
      signIn();
      const real = services.payments.charge.bind(services.payments);
      vi.spyOn(services.payments, "charge").mockImplementationOnce(async (input) => {
        const result = await real(input);
        vi.setSystemTime(answered);
        return result;
      });
      const save = vi.spyOn(repo, "savePendingSignup");
      const confirm = vi.spyOn(repo, "confirmSignupRows");

      expect(await join(pay())).toBe("/supper-club/done");
      expect(confirm.mock.calls.map((call) => call[3])).toEqual([answered]);
      expect(save.mock.calls.map(([input]) => input.consentAt)).toEqual([T0]);
    });

    it("AC2: retrySupperClubPayment, finding the payment Square took, confirms the rows at the time the lookup came back, not the retry's start", async () => {
      const retried = new Date("2026-10-28T14:26:00.000Z");
      const found = new Date("2026-10-28T14:26:04.000Z");
      signIn();
      const real = services.payments.charge.bind(services.payments);
      const replyLost = async (input: Parameters<typeof real>[0]) => {
        await real(input);
        throw noAnswer();
      };
      vi.spyOn(services.payments, "charge").mockImplementationOnce(replyLost).mockImplementationOnce(replyLost);
      await join(pay());

      vi.setSystemTime(retried);
      signIn();
      const lookup = services.payments.findPaymentByReference.bind(services.payments);
      vi.spyOn(services.payments, "findPaymentByReference").mockImplementationOnce(async (input) => {
        const payment = await lookup(input);
        vi.setSystemTime(found);
        return payment;
      });
      const confirm = vi.spyOn(repo, "confirmSignupRows");

      expect(await retry()).toBe("/supper-club/done");
      expect(services.payments.charges).toHaveLength(1);
      expect(confirm.mock.calls.map((call) => call[3])).toEqual([found]);
    });
  });

  // The email's words are src/signup-email.test.ts; this holds whether it goes, when, and what a failure does.
  describe("issue 58 — the confirmation email", () => {
    const DONE = "/supper-club/done";
    const NOT_DELIVERED = "signup email not delivered";
    const PROVIDER_TEXT = "resend-reply-body: the to field is invalid";
    const STORE_TEXT = "connection to the store refused: store-secret";

    const sent = () => (services.email as FakeEmail).sent;
    /** The text of the one email the member has. */
    const onlyText = (): string => {
      expect(sent()).toHaveLength(1);
      return sent()[0]?.text ?? "";
    };
    const silenceErrors = () => vi.spyOn(console, "error").mockImplementation(() => {});
    const logged = (errors: { mock: { calls: unknown[][] } }): string => inspect(errors.mock.calls, { depth: 6 });
    const fieldsLoggedWith = (errors: { mock: { calls: unknown[][] } }, label: string): unknown[] =>
      errors.mock.calls.filter(([message]) => message === label).map(([, fields]) => fields);
    const storeDown = (): Error => Object.assign(new Error(STORE_TEXT), { name: "StoreDownError" });

    /** `then` runs once Square has taken the payment: what the signup itself needed has all been read. */
    const onceCharged = (then: () => unknown) => {
      const real = services.payments.charge.bind(services.payments);
      vi.spyOn(services.payments, "charge").mockImplementationOnce(async (input) => {
        const result = await real(input);
        await then();
        return result;
      });
    };

    /** Another tab's confirm lands while this tab waits on Square's reply. */
    const otherTabConfirmsDuringCharge = () => {
      const real = services.payments.charge.bind(services.payments);
      vi.spyOn(services.payments, "charge").mockImplementationOnce(async (input) => {
        const result = await real(input);
        if (result.outcome === "paid") {
          await repo.confirmSignupRows(input.referenceId ?? "no reference", result.paymentId, input.amountCents, T0);
        }
        return result;
      });
    };

    /** Each way a first payment goes through. `arrange` runs just before the request that pays. */
    const PAID_BY = {
      joinSupperClub: async (arrange: () => void = () => {}) => {
        signIn();
        arrange();
        return join(pay());
      },
      retrySupperClubPayment: async (arrange: () => void = () => {}) => {
        await stranded();
        arrange();
        return retry();
      },
    };
    const PATHS = Object.keys(PAID_BY) as (keyof typeof PAID_BY)[];

    /** Nothing was scheduled, so nothing can have gone out, then or later. */
    const expectNoEmail = async () => {
      expect(scheduled.tasks).toEqual([]);
      await runScheduled();
      expect(sent()).toEqual([]);
    };

    describe("AC1 — paid on the first try", () => {
      it("AC1: one email goes to the member's address, with what they signed up for", async () => {
        signIn();
        await join(pay());
        await runScheduled();
        expect(sent()).toEqual([
          {
            to: ADA,
            subject: "Receipt: you're in the Supper Club",
            text: expect.stringContaining(
              "How many people?: 3–4 people\nWhich menu?: Vegan\nCharged Wednesday, October 28: $80, for your first week\nThen every week, at the cutoff: $80\nFirst pickup: Sunday, January 3\n",
            ) as string,
          },
        ]);
      });
    });

    describe("AC2 — Try again finishes the signup", () => {
      it("AC2: by charging, one email goes to the member's address", async () => {
        await stranded();
        await retry();
        await runScheduled();
        expect(services.payments.charges).toHaveLength(1);
        expect(sent().map((message) => message.to)).toEqual([ADA]);
      });

      it("AC2: by finding Square's payment, one email goes to the member's address", async () => {
        signIn();
        const real = services.payments.charge.bind(services.payments);
        const replyLost = async (input: Parameters<typeof real>[0]) => {
          await real(input);
          throw noAnswer();
        };
        vi.spyOn(services.payments, "charge").mockImplementationOnce(replyLost).mockImplementationOnce(replyLost);
        await join(pay());
        await runScheduled();
        expect(sent()).toEqual([]);

        expect(await retry()).toBe(DONE);
        await runScheduled();
        expect(services.payments.charges).toHaveLength(1);
        expect(sent().map((message) => message.to)).toEqual([ADA]);
      });
    });

    describe("AC3 — no email", () => {
      it.each(PATHS)("AC3: %s, with the rows already confirmed by another tab, lands on done and sends nothing", async (path) => {
        expect(await PAID_BY[path](otherTabConfirmsDuringCharge)).toBe(DONE);
        await expectNoEmail();
      });

      it("AC3: a second tab after the first has paid is already subscribed, and the member has one email", async () => {
        signIn();
        await join(pay());
        expect(await join(pay({ sourceId: "cnon:second-tab" }))).toBe("/supper-club/already");
        await runScheduled();
        expect(sent()).toHaveLength(1);
      });

      it("AC3: Try again from a member who has paid is already subscribed, and the member has one email", async () => {
        signIn();
        await join(pay());
        expect(await retry()).toBe("/supper-club/already");
        await runScheduled();
        expect(sent()).toHaveLength(1);
      });

      it("AC3: joinSupperClub, declined, sends nothing", async () => {
        signIn();
        nextCardDeclines();
        await join(pay());
        await expectNoEmail();
      });

      it("AC3: joinSupperClub, with an unknown result, sends nothing", async () => {
        await stranded();
        await expectNoEmail();
      });

      it("AC3: joinSupperClub, sold out, sends nothing", async () => {
        signIn();
        vi.spyOn(repo, "countHeldSpots").mockResolvedValue(product.cap);
        expect(landed(await join(pay()))).toMatchObject({ query: { payError: "soldout" } });
        await expectNoEmail();
      });

      it("AC3: joinSupperClub, with an error, sends nothing", async () => {
        signIn();
        const outage = new PaymentsError({ status: 503, category: "API_ERROR", code: "SERVICE_UNAVAILABLE", detail: "Try later." });
        vi.spyOn(services.payments, "findCustomersByEmail").mockRejectedValueOnce(outage);
        expect(landed(await join(pay()))).toMatchObject({ query: { payError: "error" } });
        await expectNoEmail();
      });

      it("AC3: retrySupperClubPayment, declined, sends nothing", async () => {
        signIn();
        nextCardDeclines();
        vi.spyOn(services.payments, "charge").mockRejectedValueOnce(noAnswer()).mockRejectedValueOnce(noAnswer());
        await join(pay());
        expect(landed(await retry())).toMatchObject({ query: { payError: "declined" } });
        await expectNoEmail();
      });

      it("AC3: retrySupperClubPayment, with still no answer, sends nothing", async () => {
        await stranded();
        vi.spyOn(services.payments, "findPaymentByReference").mockRejectedValueOnce(noAnswer());
        expect(landed(await retry())).toMatchObject({ query: { payError: "unknown" } });
        await expectNoEmail();
      });

      it("AC3: retrySupperClubPayment, with an error, sends nothing", async () => {
        signIn();
        expect(landed(await retry())).toMatchObject({ query: { payError: "error" } });
        await expectNoEmail();
      });
    });

    describe("AC4 — the account link", () => {
      const originalSiteUrl = services.siteUrl;

      afterEach(() => {
        services.siteUrl = originalSiteUrl;
      });

      it.each(["https://members.example.test", "https://members.example.test/"])(
        "AC4: from a site address of %s the link is the site's address and ACCOUNT_PATH, with one slash",
        async (siteUrl) => {
          services.siteUrl = siteUrl;
          signIn();
          await join(pay());
          await runScheduled();
          expect(onlyText()).toContain(`\nGo to your account: https://members.example.test${ACCOUNT_PATH}\n`);
        },
      );
    });

    describe("AC7 (issue 63) — the footer", () => {
      const originalSiteUrl = services.siteUrl;

      afterEach(() => {
        services.siteUrl = originalSiteUrl;
      });

      it("AC7: the confirmation ends with the two lines, from the site's address", async () => {
        services.siteUrl = "https://other.example.test/";
        signIn();
        await join(pay());
        await runScheduled();
        expect(onlyText().endsWith("\n\nTerms: https://other.example.test/terms\nPrivacy: https://other.example.test/privacy")).toBe(true);
      });
    });

    describe("AC5, AC6 — the stored member", () => {
      const ana = async () => {
        member = await repo.saveAccount({ email: "ana@example.com", firstName: "Ana", lastName: "Ruiz", phone: "216-555-0100", language: "es" });
        await repo.confirmMemberEmail(member.id, T0);
      };

      it("AC5: a member with no first name gets the heading with no name", async () => {
        signIn();
        await join(pay());
        await runScheduled();
        expect(onlyText()).toMatch(/^You're in the Supper Club\n\n/);
      });

      it("AC5: a member with a first name gets it in the heading", async () => {
        await ana();
        signIn();
        await join(pay());
        await runScheduled();
        expect(onlyText().split("\n\n")[0]).toBe(createTranslator("es")("email.signupConfirmation.heading", { firstName: "Ana" }));
      });

      it("AC6: a member stored as es gets their pickup date in Spanish", async () => {
        await ana();
        signIn();
        await join(pay());
        await runScheduled();
        expect(onlyText()).toContain("domingo, 3 de enero");
      });
    });

    describe("AC7 — a failure never touches the paid signup", () => {
      const refusingSend = async () => {
        const { EmailSendError } = await import("@core/ports/email.js");
        const send = vi.fn<EmailPort["send"]>(async () => {
          throw new EmailSendError("Resend", 422, `{"message":"${PROVIDER_TEXT}"}`);
        });
        services.email = { send };
        return send;
      };

      it.each(PATHS)("AC7: %s, when the send fails, lands on done, and the log names the failure without the message text", async (path) => {
        const send = await refusingSend();
        const errors = silenceErrors();
        expect(await PAID_BY[path]()).toBe(DONE);
        await expect(runScheduled()).resolves.toBeUndefined();

        expect(send).toHaveBeenCalledTimes(1);
        const message = send.mock.calls[0]?.[0];
        expect(fieldsLoggedWith(errors, NOT_DELIVERED)).toEqual([
          expect.objectContaining({ stage: "send", memberId: member.id, error: "EmailSendError", status: 422 }),
        ]);
        expect(logged(errors)).not.toContain(PROVIDER_TEXT);
        expect(logged(errors)).not.toContain(message?.subject);
        expect(logged(errors)).not.toContain(message?.text);
      });

      it("AC7: nothing re-sends a lost email: Try again afterwards lands on already, and the one send stands", async () => {
        const send = await refusingSend();
        silenceErrors();
        signIn();
        await join(pay());
        await runScheduled();

        expect(await retry()).toBe("/supper-club/already");
        await runScheduled();
        expect(send).toHaveBeenCalledTimes(1);
      });

      it("AC7: a site address that can't be read fails in the send step, after the member has landed on done", async () => {
        vi.spyOn(services, "siteUrl", "get").mockImplementation(() => {
          throw storeDown();
        });
        const errors = silenceErrors();
        signIn();
        expect(await join(pay())).toBe(DONE);
        await expect(runScheduled()).resolves.toBeUndefined();

        expect(fieldsLoggedWith(errors, NOT_DELIVERED)).toEqual([expect.objectContaining({ stage: "send", memberId: member.id })]);
        expect(sent()).toEqual([]);
      });

      describe.each(PATHS)("%s, once the payment is through", (path) => {
        const READ_FAILS = [
          ["the product", () => vi.spyOn(repo, "findProductByName").mockRejectedValue(storeDown())],
          ["the member", () => vi.spyOn(repo, "findMemberById").mockRejectedValue(storeDown())],
          ["the confirmation", () => vi.spyOn(repo, "findSignupConfirmation").mockRejectedValue(storeDown())],
        ] as const;

        it.each(READ_FAILS)("AC7: a failed read of %s lands on done, logs stage store, and sends nothing", async (_name, fail) => {
          const errors = silenceErrors();
          expect(await PAID_BY[path](() => onceCharged(fail))).toBe(DONE);
          await expect(runScheduled()).resolves.toBeUndefined();

          expect(fieldsLoggedWith(errors, NOT_DELIVERED)).toEqual([
            expect.objectContaining({ stage: "store", memberId: member.id, error: "StoreDownError" }),
          ]);
          expect(logged(errors)).not.toContain(STORE_TEXT);
          expect(sent()).toEqual([]);
        });

        const READ_FINDS_NOTHING = [
          ["product", () => vi.spyOn(repo, "findProductByName").mockResolvedValue(null)],
          ["member", () => vi.spyOn(repo, "findMemberById").mockResolvedValue(null)],
          ["confirmation", () => vi.spyOn(repo, "findSignupConfirmation").mockResolvedValue(null)],
        ] as const;

        it.each(READ_FINDS_NOTHING)("AC7: a read that finds no %s is logged as a failure at stage store, and sends nothing", async (_name, fail) => {
          const errors = silenceErrors();
          expect(await PAID_BY[path](() => onceCharged(fail))).toBe(DONE);
          await expect(runScheduled()).resolves.toBeUndefined();

          expect(fieldsLoggedWith(errors, NOT_DELIVERED)).toEqual([expect.objectContaining({ stage: "store", memberId: member.id })]);
          expect(sent()).toEqual([]);
        });
      });
    });

    describe("AC8 — after the response", () => {
      it.each(PATHS)("AC8: %s redirects with the email still to come, whatever the send would do", async (path) => {
        const send = vi.fn<EmailPort["send"]>(() => new Promise(() => {}));
        const read = vi.spyOn(repo, "findSignupConfirmation");
        expect(
          await PAID_BY[path](() => {
            services.email = { send };
          }),
        ).toBe(DONE);

        expect(scheduled.tasks).toHaveLength(1);
        expect(read).not.toHaveBeenCalled();
        expect(send).not.toHaveBeenCalled();
      });
    });
  });
});
