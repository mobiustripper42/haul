// Issue 156: Your details' four actions, through an InMemoryRepository, a FakeEmail and FakePayments, with
// `next/headers` faked, `redirect` throwing as the real one does and `after` collecting its callback for the test to
// run, as app/create-account/actions.test.ts drives Create Account. The code rules are requestEmailChange's and
// verifyEmailChange's (src/email-change.test.ts), the request limit's rules takeRateLimit's, and which details are
// valid validateAccountDetails's; each goes through here accepted once and refused once. What is held here is what
// the actions do with their answers: what is stored, what is emailed and to whom, what is recorded, where the member
// lands, and what is counted. The words of the two emails are src/sign-in-email.test.ts's.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeEmail } from "@core/adapters/fake-email.js";
import { FakePayments } from "@core/adapters/fake-payments.js";
import { InMemoryRepository } from "@core/adapters/in-memory-repository.js";
import { createTranslator } from "@core/i18n.js";
import type { Member } from "@core/members.js";
import { PaymentsError } from "@core/ports/payments.js";
import type { ProductWithOptions } from "@core/products.js";
import { signSession, verifySession } from "@core/sign-in/session.js";
import { addSupperClub } from "../../admin/subscribers-fixture";
import { AUDIT_ENTRY_POINTS } from "../../audit-entry-points";
import { emptyRequest } from "../../next-headers-fake";
import { redirectOf } from "../../screen-test-helpers";
import { requestCode } from "../../sign-in/actions";
import { confirmEmailChange, keepOldEmail, resendEmailChange, saveDetails } from "./actions";

const request = vi.hoisted(() => ({ current: { cookies: {}, headers: {}, sets: [] } as import("../../next-headers-fake").RequestState }));
const services = vi.hoisted(() => ({
  repo: undefined as unknown as import("@core/adapters/in-memory-repository.js").InMemoryRepository,
  email: undefined as unknown as import("@core/adapters/fake-email.js").FakeEmail,
  payments: undefined as unknown as import("@core/adapters/fake-payments.js").FakePayments,
  secret: "test-session-secret-that-is-long-enough-0123456789",
  siteUrl: "https://members.example.test",
}));
const scheduled = vi.hoisted(() => ({ tasks: [] as unknown[] }));

vi.mock("next/headers", async () => {
  const { fakeNextHeaders } = await import("../../next-headers-fake");
  return {
    cookies: () => fakeNextHeaders(request.current).cookies(),
    headers: () => fakeNextHeaders(request.current).headers(),
  };
});
vi.mock("next/navigation", async () => ({ redirect: (await import("../../screen-test-helpers")).throwingRedirect }));
vi.mock("next/server", () => ({
  after: (task: unknown) => {
    scheduled.tasks.push(task);
  },
}));
vi.mock("../../services", () => ({
  getRepository: () => services.repo,
  getEmail: () => services.email,
  getPayments: () => services.payments,
  getSessionSecret: () => services.secret,
  getSiteUrl: () => services.siteUrl,
}));

// 14:25:30 UTC: 34 min 30 s left in the clock hour sign-in's request limit counts in, so a refusal waits 35 minutes.
const T0 = new Date("2026-10-28T14:25:30.000Z");
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const ADDRESS = "203.0.113.7";
const OLD = "ada@example.com";
const NEW = "ada.new@example.com";
const PAGE = "/account/details";
const SESSION = "ocf_session";
const DRAFT = "ocf_account_draft";
const STRANGER = "nobody@example.com";

let repo: InMemoryRepository;
let email: FakeEmail;
let payments: FakePayments;
let product: ProductWithOptions;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: T0 });
  request.current = emptyRequest();
  request.current.headers = { "x-forwarded-for": ADDRESS };
  scheduled.tasks = [];
  repo = new InMemoryRepository();
  email = new FakeEmail();
  payments = new FakePayments();
  services.repo = repo;
  services.email = email;
  services.payments = payments;
  product = addSupperClub(repo);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const form = (fields: Record<string, string>): FormData => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.append(name, value);
  return data;
};

/** Ada's details as the form posts them, with `over` changed. */
const details = (over: Record<string, string> = {}): FormData =>
  form({ firstName: "Ada", lastName: "Lovelace", email: OLD, phone: "216-555-0100", language: "en", ...over });

/** Runs every callback handed to `after`, in order. */
async function runScheduled(): Promise<void> {
  for (const task of scheduled.tasks.splice(0)) await (typeof task === "function" ? task() : task);
}

const codeIn = (text: string | undefined): string => /\b(\d{6})\b/.exec(text ?? "")?.[1] ?? "no code in the message";
const sentTo = (address: string) => email.sent.filter((message) => message.to === address);
const silenceErrors = () => vi.spyOn(console, "error").mockImplementation(() => {});

const reload = async (member: Member): Promise<Member> => {
  const stored = await repo.findMemberById(member.id);
  if (!stored) throw new Error("the member is gone");
  return stored;
};

/** Ada: through Create Account, confirmed, with an active Supper Club subscription, signed in. */
const ada = async (): Promise<Member> => {
  const saved = await repo.saveAccount({ email: OLD, firstName: "Ada", lastName: "Lovelace", phone: "216-555-0100", language: "en" });
  await repo.confirmMemberEmail(saved.id, new Date(T0.getTime() - 30 * DAY));
  const signup = await repo.savePendingSignup({
    memberId: saved.id,
    productId: product.id,
    choices: Object.fromEntries(product.optionTypes.map((type) => [type.id, type.options[0]?.id ?? "no such option"])),
    firstChargeCents: 8000,
    weeklyCents: 8000,
    pickupDate: "2027-01-03",
    consentText: "I agree to a weekly charge of $80.",
    consentAt: new Date("2026-10-01T17:00:00.000Z"),
  });
  await repo.confirmSignupRows(signup.ledgerId, `PAYMENT_${signup.ledgerId}`, signup.amountCents, new Date("2026-10-01T17:00:05.000Z"));
  request.current.cookies[SESSION] = signSession({ subjectId: saved.id, expiresAt: new Date(T0.getTime() + DAY).toISOString() }, services.secret);
  return reload(saved);
};

/** Ada with a Square customer, as after her first payment; the customer's id. */
const adaInSquare = async (): Promise<{ member: Member; customerId: string }> => {
  const member = await ada();
  const customer = payments.addCustomer({ email: OLD, createdAt: T0, updatedAt: T0 });
  await repo.setMemberSquareCustomer(member.id, customer.id);
  return { member: await reload(member), customerId: customer.id };
};

/** Saves a new email, with `over` changed too, and returns the code sent to it, with the outbox emptied. */
const pendingChange = async (newEmail = NEW, over: Record<string, string> = {}): Promise<string> => {
  expect(await redirectOf(saveDetails(details({ ...over, email: newEmail })))).toBe(PAGE);
  await runScheduled();
  const code = codeIn(email.sent.find((message) => message.to.toLowerCase() === newEmail.toLowerCase())?.text);
  email.clear();
  return code;
};

/**
 * Uses up what is left of sign-in's request limit for this address, through sign-in itself, and empties what it left
 * behind. `already` is how many requests this hour have counted so far: a save with a new email is one (AC13).
 */
const useUpTheLimit = async (already = 0): Promise<void> => {
  for (let i = already; i < 20; i++) expect(await redirectOf(requestCode(form({ email: STRANGER })))).toBe("/sign-in/code");
  await runScheduled();
  email.clear();
  request.current.sets = [];
};

const REFUSAL = { kind: "rate_limit_refusal", bucket: "sign-in-request", key: ADDRESS };

describe("AC1 (issue 156) — signed out", () => {
  it("AC1: saveDetails is sent to sign in and stores nothing", async () => {
    const member = await ada();
    delete request.current.cookies[SESSION];
    expect(await redirectOf(saveDetails(details({ firstName: "Adaline", email: NEW })))).toBe("/sign-in");
    expect(await reload(member)).toEqual(member);
    expect(await repo.findEmailChange(member.id)).toBeNull();
  });
});

describe("AC3 (issue 156) — a save with the email unchanged", () => {
  it("AC3: it stores first name, last name, phone and language, and lands on /account/details?saved=1", async () => {
    const member = await ada();
    const saved = details({ firstName: "Adaline", lastName: "Byron", phone: "216-555-0199", language: "es" });
    expect(await redirectOf(saveDetails(saved))).toBe(`${PAGE}?saved=1`);
    expect(await reload(member)).toEqual({ ...member, firstName: "Adaline", lastName: "Byron", phone: "216-555-0199", language: "es" });
  });

  it("AC3: no email is sent, before or after the response", async () => {
    await ada();
    expect(await redirectOf(saveDetails(details({ firstName: "Adaline" })))).toBe(`${PAGE}?saved=1`);
    await runScheduled();
    expect(email.sent).toEqual([]);
  });

  it("AC3: it writes as the signed-in member, so the audit trigger names them", async () => {
    const member = await ada();
    const withActor = vi.spyOn(repo, "withActor");
    expect(await redirectOf(saveDetails(details({ firstName: "Adaline" })))).toBe(`${PAGE}?saved=1`);
    expect(withActor).toHaveBeenCalledWith({ member: member.id }, expect.any(Function));
  });
});

describe("AC4 (issue 156) — a save that breaks a Create Account rule", () => {
  it("AC4: a bad email stores nothing, the name typed beside it included, starts no change, and lands on /account/details?error=email", async () => {
    const member = await ada();
    expect(await redirectOf(saveDetails(details({ firstName: "Adaline", email: "ada.new@" })))).toBe(`${PAGE}?error=email`);
    expect(await reload(member)).toEqual(member);
    expect(await repo.findEmailChange(member.id)).toBeNull();
    await runScheduled();
    expect(email.sent).toEqual([]);
  });

  it("AC4: the draft cookie holds what was typed, so the form refills with it", async () => {
    await ada();
    await redirectOf(saveDetails(details({ firstName: "", lastName: "Byron", phone: "216-555-0199", language: "es" })));
    expect(JSON.parse(request.current.cookies[DRAFT] ?? "null")).toEqual({
      firstName: "",
      lastName: "Byron",
      email: OLD,
      phone: "216-555-0199",
      language: "es",
    });
  });
});

describe("AC5 (issue 156) — the language for emails", () => {
  it("AC5: saving Español changes the member's preference and sets no cookie, so the page stays in its language", async () => {
    const member = await ada();
    expect(await redirectOf(saveDetails(details({ language: "es" })))).toBe(`${PAGE}?saved=1`);
    expect((await reload(member)).language).toBe("es");
    expect(request.current.sets.map((cookie) => cookie.name)).not.toContain("lang");
  });
});

describe("AC6 (issue 156) — an email that differs only by case or spaces", () => {
  it.each([" ada@example.com ", "Ada@Example.COM", "  ADA@EXAMPLE.COM"])("AC6: %j is not a change: the save lands on ?saved=1, starts no change and sends nothing", async (typed) => {
    const member = await ada();
    expect(await redirectOf(saveDetails(details({ firstName: "Adaline", email: typed })))).toBe(`${PAGE}?saved=1`);
    expect(await repo.findEmailChange(member.id)).toBeNull();
    expect(await reload(member)).toMatchObject({ email: OLD, firstName: "Adaline" });
    await runScheduled();
    expect(email.sent).toEqual([]);
  });
});

describe("AC7 (issue 156) — a save with a new email", () => {
  it("AC7: it lands on /account/details with a change to the new address pending, and the member's email unchanged", async () => {
    const member = await ada();
    expect(await redirectOf(saveDetails(details({ email: NEW })))).toBe(PAGE);
    expect((await repo.findEmailChange(member.id))?.newEmail).toBe(NEW);
    expect((await reload(member)).email).toBe(OLD);
  });

  it("AC7: one email goes to the new address with a 6-digit code, and none to the old", async () => {
    await ada();
    await redirectOf(saveDetails(details({ email: NEW })));
    await runScheduled();
    expect(email.sent.map((message) => message.to)).toEqual([NEW]);
    expect(codeIn(email.last()?.text)).toMatch(/^\d{6}$/);
  });

  it("AC7: a save that changes the language and the email sends the code in the new language", async () => {
    await ada();
    await redirectOf(saveDetails(details({ email: NEW, language: "es" })));
    await runScheduled();
    expect(email.sent.map((message) => message.subject)).toEqual([createTranslator("es")("details.codeEmail.subject")]);
    expect(email.last()?.subject).not.toBe(createTranslator("en")("details.codeEmail.subject"));
  });
});

describe("AC8 (issue 156) — the rest of a save with a new email", () => {
  it("AC8: name, phone and language are stored straight away, before the code is confirmed", async () => {
    const member = await ada();
    expect(await redirectOf(saveDetails(details({ firstName: "Adaline", lastName: "Byron", phone: "216-555-0199", language: "es", email: NEW })))).toBe(PAGE);
    expect(await reload(member)).toEqual({ ...member, firstName: "Adaline", lastName: "Byron", phone: "216-555-0199", language: "es" });
  });
});

describe("AC10 (issue 156) — the right code", () => {
  it("AC10: it makes the new address the member's email and lands on /account/details?saved=1", async () => {
    const member = await ada();
    const code = await pendingChange();
    expect(await redirectOf(confirmEmailChange(form({ code })))).toBe(`${PAGE}?saved=1`);
    expect((await reload(member)).email).toBe(NEW);
  });

  it("AC10: the member stays signed in", async () => {
    const member = await ada();
    const code = await pendingChange();
    await redirectOf(confirmEmailChange(form({ code })));
    const verified = verifySession(request.current.cookies[SESSION] ?? "", services.secret, new Date());
    expect(verified.ok && verified.session.subjectId).toBe(member.id);
  });

  it("AC10: a new address typed with capitals is stored the way sign-in looks addresses up, so it signs in", async () => {
    const member = await ada();
    const code = await pendingChange("Ada.New@Example.COM");
    expect(await redirectOf(confirmEmailChange(form({ code })))).toBe(`${PAGE}?saved=1`);
    expect((await reload(member)).email).toBe(NEW);
    expect((await repo.findMemberByEmail(NEW))?.id).toBe(member.id);
  });
});

describe("AC11 (issue 156) — Square refuses", () => {
  it("AC11: the member's email does not change, nothing is emailed or recorded, and the step lands on ?error=square", async () => {
    const { member } = await adaInSquare();
    const code = await pendingChange();
    payments.failNext(new PaymentsError({ status: 503, category: "API_ERROR", code: "SERVICE_UNAVAILABLE", detail: "Try later." }));
    expect(await redirectOf(confirmEmailChange(form({ code })))).toBe(`${PAGE}?error=square`);
    expect((await reload(member)).email).toBe(OLD);
    await runScheduled();
    expect(email.sent).toEqual([]);
    expect(repo.events().filter((event) => event.kind === "email_changed")).toEqual([]);
  });

  it("AC11: a member with a Square customer has its email set to the new address on confirm", async () => {
    const { customerId } = await adaInSquare();
    const code = await pendingChange();
    expect(await redirectOf(confirmEmailChange(form({ code })))).toBe(`${PAGE}?saved=1`);
    expect(payments.customers.find((customer) => customer.id === customerId)?.email).toBe(NEW);
  });
});

describe("AC12 (issue 156) — a wrong code", () => {
  it("AC12: it changes nothing and lands on /account/details?error=invalid", async () => {
    const member = await ada();
    const code = await pendingChange();
    const wrong = code === "000000" ? "111111" : "000000";
    expect(await redirectOf(confirmEmailChange(form({ code: wrong })))).toBe(`${PAGE}?error=invalid`);
    expect((await reload(member)).email).toBe(OLD);
    expect((await repo.findEmailChange(member.id))?.newEmail).toBe(NEW);
  });

  it("AC12: six wrong guesses email nothing, no link included, and record no lock", async () => {
    await ada();
    const code = await pendingChange();
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < 6; i++) expect(await redirectOf(confirmEmailChange(form({ code: wrong })))).toBe(`${PAGE}?error=invalid`);
    await runScheduled();
    expect(email.sent).toEqual([]);
    expect(repo.events().filter((event) => event.kind === "lock")).toEqual([]);
  });
});

describe("AC13 (issue 156) — Send a new code, and the request limit", () => {
  it("AC13: Send a new code sends a code to the pending address, which confirms it, and lands on /account/details?sent=1", async () => {
    const member = await ada();
    await pendingChange();
    expect(await redirectOf(resendEmailChange(form({ resend: "1" })))).toBe(`${PAGE}?sent=1`);
    await runScheduled();
    expect(email.sent.map((message) => message.to)).toEqual([NEW]);
    expect(await redirectOf(confirmEmailChange(form({ code: codeIn(email.last()?.text) })))).toBe(`${PAGE}?saved=1`);
    expect((await reload(member)).email).toBe(NEW);
  });

  it("AC13: a save that changes the email is counted in sign-in's request limit: after 20, sign-in's next request is refused", async () => {
    await ada();
    for (let i = 0; i < 20; i++) expect(await redirectOf(saveDetails(details({ email: `ada.${i}@example.com` })))).toBe(PAGE);
    expect(await redirectOf(requestCode(form({ email: STRANGER })))).toBe("/sign-in?limited=35");
  });

  it("AC13: a save that leaves the email unchanged is not counted: after 20, sign-in's next request is let through", async () => {
    await ada();
    for (let i = 0; i < 20; i++) expect(await redirectOf(saveDetails(details({ firstName: `Ada${i}` })))).toBe(`${PAGE}?saved=1`);
    expect(await redirectOf(requestCode(form({ email: STRANGER })))).toBe("/sign-in/code");
  });

  it("AC13: over the limit, a save with a new email stores its name, phone and language, starts no change, emails nothing, and lands on ?limited=35", async () => {
    const member = await ada();
    await useUpTheLimit();
    expect(await redirectOf(saveDetails(details({ firstName: "Adaline", phone: "216-555-0199", language: "es", email: NEW })))).toBe(`${PAGE}?limited=35`);
    expect(await reload(member)).toEqual({ ...member, firstName: "Adaline", phone: "216-555-0199", language: "es" });
    expect(await repo.findEmailChange(member.id)).toBeNull();
    await runScheduled();
    expect(email.sent).toEqual([]);
  });

  it("AC13: the save over the limit records the window's rate_limit_refusal", async () => {
    await ada();
    await useUpTheLimit();
    await redirectOf(saveDetails(details({ email: NEW })));
    expect(repo.events()).toEqual([expect.objectContaining(REFUSAL)]);
  });

  it("AC13: over the limit, a save with the email unchanged is not refused: it lands on ?saved=1", async () => {
    const member = await ada();
    await useUpTheLimit();
    expect(await redirectOf(saveDetails(details({ firstName: "Adaline" })))).toBe(`${PAGE}?saved=1`);
    expect((await reload(member)).firstName).toBe("Adaline");
  });

  it("AC13: over the limit, Send a new code sends nothing, records the refusal, and lands on ?limited=35; the code sent before still confirms", async () => {
    const member = await ada();
    const code = await pendingChange();
    await useUpTheLimit(1);
    expect(await redirectOf(resendEmailChange(form({ resend: "1" })))).toBe(`${PAGE}?limited=35`);
    await runScheduled();
    expect(email.sent).toEqual([]);
    expect(repo.events()).toEqual([expect.objectContaining(REFUSAL)]);
    expect(await redirectOf(confirmEmailChange(form({ code })))).toBe(`${PAGE}?saved=1`);
    expect((await reload(member)).email).toBe(NEW);
  });
});

describe("AC14 (issue 156) — Keep the old email", () => {
  it("AC14: it drops the pending change, keeps the old address, records nothing, and lands on /account/details", async () => {
    const member = await ada();
    await pendingChange();
    expect(await redirectOf(keepOldEmail(form({})))).toBe(PAGE);
    expect(await repo.findEmailChange(member.id)).toBeNull();
    expect((await reload(member)).email).toBe(OLD);
    expect(repo.events()).toEqual([]);
  });
});

describe("AC15 (issue 156) — a new email another member holds", () => {
  it("AC15: the save lands where an unheld one does, a change is pending so the code step shows, and nothing is emailed", async () => {
    const member = await ada();
    await repo.createMember({ email: NEW });
    expect(await redirectOf(saveDetails(details({ email: NEW })))).toBe(PAGE);
    expect((await repo.findEmailChange(member.id))?.newEmail).toBe(NEW);
    await runScheduled();
    expect(email.sent).toEqual([]);
  });
});

describe("AC17 (issue 156) — the audit trail", () => {
  it("AC17: a confirmed change records one email_changed event, as the member, with the old and new address as from and to", async () => {
    const member = await ada();
    const code = await pendingChange();
    await redirectOf(confirmEmailChange(form({ code })));
    expect(repo.events()).toEqual([{ kind: "email_changed", memberId: member.id, detail: { from: OLD, to: NEW }, actor: { member: member.id } }]);
  });

  it("AC17: the four actions are declared: confirmEmailChange records email_changed, saveDetails and resendEmailChange rate_limit_refusal, keepOldEmail none", () => {
    const entry = (name: string) => AUDIT_ENTRY_POINTS[`app/account/details/actions.ts#${name}`];
    expect(entry("confirmEmailChange")).toEqual({ records: ["email_changed"] });
    expect(entry("saveDetails")).toEqual({ records: ["rate_limit_refusal"] });
    expect(entry("resendEmailChange")).toEqual({ records: ["rate_limit_refusal"] });
    expect(entry("keepOldEmail")).toEqual({ none: expect.stringMatching(/\S/) });
  });
});

describe("AC19 (issue 156) — the notice to the old address", () => {
  const SUBJECT = "Your Ohio City Farm sign-in email was changed";

  it("AC19: after the response, and not before, the old address gets one email saying the sign-in email changed", async () => {
    await ada();
    const code = await pendingChange();
    await redirectOf(confirmEmailChange(form({ code })));
    expect(email.sent).toEqual([]);
    await runScheduled();
    expect(sentTo(OLD).map((message) => message.subject)).toEqual([SUBJECT]);
    expect(sentTo(OLD)[0]?.text).toContain(NEW);
  });

  it("AC19: it is in the member's email language", async () => {
    await ada();
    const code = await pendingChange(NEW, { language: "es" });
    await redirectOf(confirmEmailChange(form({ code })));
    await runScheduled();
    expect(sentTo(OLD).map((message) => message.subject)).toEqual([createTranslator("es")("details.changedEmail.subject")]);
    expect(sentTo(OLD)[0]?.subject).not.toBe(SUBJECT);
  });

  it("AC19: if it fails to send, the change still stands", async () => {
    const member = await ada();
    const code = await pendingChange();
    silenceErrors();
    vi.spyOn(email, "send").mockRejectedValue(new Error("the provider is down"));
    expect(await redirectOf(confirmEmailChange(form({ code })))).toBe(`${PAGE}?saved=1`);
    await runScheduled();
    expect((await reload(member)).email).toBe(NEW);
    expect(repo.events().map((event) => event.kind)).toEqual(["email_changed"]);
  });
});
