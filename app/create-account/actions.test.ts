// Issue 55, AC4–AC12 and AC16: the Create Account server actions. As app/sign-in/actions.test.ts:
// `next/headers` is faked, `redirect` throws as the real one does, `after` collects its callback for
// the test to run, and the composition root hands out an InMemoryRepository and a FakeEmail. Each test
// loads the actions afresh after stubbing NODE_ENV, so a cookie's `secure` holds whether it is read
// per call or at load.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeEmail } from "@core/adapters/fake-email.js";
import { InMemoryRepository } from "@core/adapters/in-memory-repository.js";
import { renderEmail } from "@core/email-templates.js";
import type { Member } from "@core/members.js";
import { hashCode, redeemSignInLink } from "@core/sign-in/code.js";
import { SESSION_TTL_MS, verifySession } from "@core/sign-in/session.js";
import { emptyRequest, type CookieSet } from "../next-headers-fake";
import { loggedText, redirectOf } from "../screen-test-helpers";

const request = vi.hoisted(() => ({ current: { cookies: {}, headers: {}, sets: [] } as import("../next-headers-fake").RequestState }));
const services = vi.hoisted(() => ({
  repo: undefined as unknown as import("@core/adapters/in-memory-repository.js").InMemoryRepository,
  email: undefined as unknown as import("@core/ports/email.js").EmailPort,
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
const CODE_PAGE = "/create-account/code";

let repo: InMemoryRepository;
let email: FakeEmail;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: T0 });
  request.current = emptyRequest();
  request.current.headers = { "x-forwarded-for": ADDRESS };
  scheduled.tasks = [];
  repo = new InMemoryRepository();
  email = new FakeEmail();
  services.repo = repo;
  services.email = email;
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

async function load(nodeEnv = "development") {
  vi.stubEnv("NODE_ENV", nodeEnv);
  vi.resetModules();
  return import("./actions");
}

const form = (fields: Record<string, string>): FormData => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.append(name, value);
  return data;
};

const details = (over: Record<string, string> = {}): FormData =>
  form({ firstName: "Ada", lastName: "Lovelace", email: ADA, phone: "216-555-0100", language: "en", ...over });

/** Runs every callback handed to `after`, in order. */
async function runScheduled(): Promise<void> {
  for (const task of scheduled.tasks.splice(0)) await (typeof task === "function" ? task() : task);
}

const setsNamed = (name: string): CookieSet[] => request.current.sets.filter((cookie) => cookie.name === name);
const cookieGone = (name: string): boolean => !(name in request.current.cookies) || request.current.cookies[name] === "";
const silenceErrors = () => vi.spyOn(console, "error").mockImplementation(() => {});
const fieldsLoggedWith = (spy: { mock: { calls: unknown[][] } }, message: string): unknown[] =>
  spy.mock.calls.filter((args) => args[0] === message).map((args) => args[1]);

const codeIn = (text: string | undefined): string => /\b(\d{6})\b/.exec(text ?? "")?.[1] ?? "no code in the message";
const tokenIn = (text: string | undefined): string | undefined => /\/sign-in\/link\?token=([A-Za-z0-9_-]+)/.exec(text ?? "")?.[1];

const confirmedMember = async (): Promise<Member> => {
  const member = await repo.createMember({ email: ADA });
  await repo.confirmMemberEmail(member.id, new Date(T0.getTime() - 60 * MINUTE));
  const stored = await repo.findMemberById(member.id);
  if (!stored) throw new Error("the member just created is gone");
  return stored;
};

/** A live code for `member`, saved straight through the store at the current time, with no hold. */
const plantCode = (member: Member) => {
  const createdAt = new Date();
  return repo.saveSignInCode({
    subjectId: member.id,
    codeHash: hashCode(RIGHT_CODE),
    createdAt,
    expiresAt: new Date(createdAt.getTime() + 10 * MINUTE),
  });
};

describe("AC4 — details that fail", () => {
  it.each([
    ["firstName", { firstName: "" }],
    ["lastName", { lastName: "" }],
    ["phone", { phone: "" }],
    ["email", { email: "name@example" }],
  ])("AC4: a failing %s redirects to /create-account?error=<that field>", async (field, over: Record<string, string>) => {
    const { requestAccountCode } = await load();
    expect(await redirectOf(requestAccountCode(details(over)))).toBe(`/create-account?error=${field}`);
  });

  it.each(["firstName", "lastName", "phone"])("AC4: a %s of only whitespace is missing", async (field) => {
    const { requestAccountCode } = await load();
    expect(await redirectOf(requestAccountCode(details({ [field]: "  \t " })))).toBe(`/create-account?error=${field}`);
  });

  it("AC4: every failing field is listed, comma-separated, in form order", async () => {
    const { requestAccountCode } = await load();
    const fields = { phone: "", email: "nope", lastName: " ", firstName: "" };
    expect(await redirectOf(requestAccountCode(details(fields)))).toBe("/create-account?error=firstName,lastName,email,phone");
  });

  it("AC4: no member is written, no email is sent, and nothing is left to run after the response", async () => {
    const { requestAccountCode } = await load();
    await redirectOf(requestAccountCode(details({ firstName: "" })));
    expect(scheduled.tasks).toEqual([]);
    await runScheduled();
    expect(await repo.findMemberByEmail(ADA)).toBeNull();
    expect(email.sent).toEqual([]);
  });

  it("AC4: no email cookie is set", async () => {
    const { requestAccountCode } = await load();
    expect(await redirectOf(requestAccountCode(details({ firstName: "" })))).toBe("/create-account?error=firstName");
    expect(setsNamed(SIGN_IN_EMAIL)).toEqual([]);
  });

  it("AC4: failing requests are not counted: 25 of them, then the 20 the limit allows, all get through", async () => {
    const { requestAccountCode } = await load();
    for (let i = 0; i < 25; i++) expect(await redirectOf(requestAccountCode(details({ phone: "" })))).toBe("/create-account?error=phone");
    for (let i = 0; i < 20; i++) expect(await redirectOf(requestAccountCode(details()))).toBe(CODE_PAGE);
  });

  it("AC4: it sets ocf_account_draft to the values as entered, as JSON keyed by field", async () => {
    const entered = { firstName: "", lastName: " Lovelace ", email: "ada@example", phone: "", language: "es" };
    const { requestAccountCode } = await load();
    await redirectOf(requestAccountCode(form(entered)));
    expect(setsNamed(DRAFT)).toHaveLength(1);
    expect(JSON.parse(setsNamed(DRAFT)[0]?.value ?? "null")).toEqual(entered);
  });

  it("AC4: the draft has SIGN_IN_EMAIL_COOKIE's options and max age", async () => {
    const { requestAccountCode } = await load("development");
    await redirectOf(requestAccountCode(details({ firstName: "" })));
    expect(setsNamed(DRAFT)[0]).toMatchObject({ maxAge: 600, httpOnly: true, sameSite: "lax", path: "/" });
    expect(Boolean(setsNamed(DRAFT)[0]?.secure)).toBe(false);
  });

  it("AC4: in production the draft is secure", async () => {
    const { requestAccountCode } = await load("production");
    await redirectOf(requestAccountCode(details({ firstName: "" })));
    expect(setsNamed(DRAFT)).toEqual([expect.objectContaining({ secure: true })]);
  });

  it("AC4: a request that passes validation deletes the draft", async () => {
    request.current.cookies = { [DRAFT]: JSON.stringify({ firstName: "" }) };
    const { requestAccountCode } = await load();
    expect(await redirectOf(requestAccountCode(details()))).toBe(CODE_PAGE);
    expect(cookieGone(DRAFT)).toBe(true);
  });

  it("AC4: a request that passes validation deletes the draft even when the limit then refuses it", async () => {
    const { requestAccountCode } = await load();
    for (let i = 0; i < 20; i++) await redirectOf(requestAccountCode(details()));
    request.current.cookies = { ...request.current.cookies, [DRAFT]: "{}" };
    expect(await redirectOf(requestAccountCode(details()))).toBe("/create-account?limited=35");
    expect(cookieGone(DRAFT)).toBe(true);
  });
});

describe("AC5 — an email no member has", () => {
  it("AC5: it redirects to the code step with the email cookie set, as sign-in's", async () => {
    const { requestAccountCode } = await load("development");
    expect(await redirectOf(requestAccountCode(details()))).toBe(CODE_PAGE);
    expect(setsNamed(SIGN_IN_EMAIL)).toEqual([expect.objectContaining({ value: ADA, maxAge: 600, httpOnly: true, sameSite: "lax", path: "/" })]);
  });

  it("AC5: the email is trimmed in the cookie", async () => {
    const { requestAccountCode } = await load();
    await redirectOf(requestAccountCode(details({ email: `  ${ADA} ` })));
    expect(setsNamed(SIGN_IN_EMAIL)[0]?.value).toBe(ADA);
  });

  it("AC5: after the response a member exists, unconfirmed, with the details given", async () => {
    const { requestAccountCode } = await load();
    await redirectOf(requestAccountCode(details({ firstName: " Ada ", language: "es" })));
    await runScheduled();
    expect(await repo.findMemberByEmail(ADA)).toMatchObject({
      firstName: "Ada",
      lastName: "Lovelace",
      phone: "216-555-0100",
      language: "es",
      role: "member",
      emailConfirmedAt: null,
    });
  });

  it("AC5: a sign-in code is emailed to that address, in the language chosen", async () => {
    const { requestAccountCode } = await load();
    await redirectOf(requestAccountCode(details({ language: "es" })));
    await runScheduled();
    expect(email.sent).toHaveLength(1);
    const code = codeIn(email.last()?.text);
    expect(email.last()).toEqual({ to: ADA, ...renderEmail("signInCode", "es", { code, minutes: 10 }) });
  });

  it("AC5: a store failure after the response is logged with a null member id, its stage and the error's name, never the email, and nothing is sent", async () => {
    const { requestAccountCode } = await load();
    vi.spyOn(repo, "saveSignInCode").mockRejectedValue(Object.assign(new Error("could not reach postgres://haul:hunter2@db/haul"), { name: "StoreDownError" }));
    const errors = silenceErrors();
    await redirectOf(requestAccountCode(details()));
    await expect(runScheduled()).resolves.toBeUndefined();

    expect(fieldsLoggedWith(errors, "sign-in email not delivered")).toEqual([expect.objectContaining({ stage: "store", memberId: null, error: "StoreDownError" })]);
    const logged = loggedText(errors);
    expect(logged).not.toContain(ADA);
    expect(logged).not.toContain("hunter2");
    expect(email.sent).toEqual([]);
  });
});

describe("AC6 — an email whose member is unconfirmed", () => {
  it("AC6: the member's first name, last name, phone and language are replaced, and a code is emailed", async () => {
    const before = await repo.createMember({ email: ADA });
    const { requestAccountCode } = await load();
    await redirectOf(requestAccountCode(details({ firstName: "Augusta", lastName: "King", phone: "216-555-0199", language: "es" })));
    await runScheduled();
    expect(await repo.findMemberByEmail(ADA)).toMatchObject({
      id: before.id,
      firstName: "Augusta",
      lastName: "King",
      phone: "216-555-0199",
      language: "es",
      emailConfirmedAt: null,
    });
    expect(email.sent).toHaveLength(1);
  });

  it("AC6: inside the resend wait the details are replaced and no second email goes", async () => {
    const { requestAccountCode } = await load();
    await redirectOf(requestAccountCode(details()));
    await runScheduled();
    vi.setSystemTime(new Date(T0.getTime() + 30_000));
    expect(await redirectOf(requestAccountCode(details({ phone: "216-555-0199" })))).toBe(CODE_PAGE);
    await runScheduled();
    expect((await repo.findMemberByEmail(ADA))?.phone).toBe("216-555-0199");
    expect(email.sent).toHaveLength(1);
  });

  it("AC6: past the resend wait a new code is emailed", async () => {
    const { requestAccountCode } = await load();
    await redirectOf(requestAccountCode(details()));
    await runScheduled();
    vi.setSystemTime(new Date(T0.getTime() + 10 * MINUTE));
    await redirectOf(requestAccountCode(details()));
    await runScheduled();
    expect(email.sent).toHaveLength(2);
  });
});

describe("AC7 — an email whose member is confirmed", () => {
  it("AC7: nothing on the member changes", async () => {
    const before = await confirmedMember();
    const { requestAccountCode } = await load();
    await redirectOf(requestAccountCode(details({ firstName: "Mallory", lastName: "Hacker", phone: "216-555-0666", language: "es" })));
    await runScheduled();
    expect(email.sent).toHaveLength(1);
    expect(await repo.findMemberById(before.id)).toEqual(before);
  });

  it("AC7: an ordinary sign-in code is emailed, in the member's own language", async () => {
    await confirmedMember();
    const { requestAccountCode } = await load();
    await redirectOf(requestAccountCode(details({ language: "es" })));
    await runScheduled();
    const code = codeIn(email.last()?.text);
    expect(email.sent).toHaveLength(1);
    expect(email.last()).toEqual({ to: ADA, ...renderEmail("signInCode", "en", { code, minutes: 10 }) });
  });

  it("AC7: the same code step as AC5", async () => {
    await confirmedMember();
    const { requestAccountCode } = await load();
    expect(await redirectOf(requestAccountCode(details()))).toBe(CODE_PAGE);
    expect(setsNamed(SIGN_IN_EMAIL)[0]?.value).toBe(ADA);
  });
});

describe("AC8 — the right code on the code step", () => {
  /** Asks for a code through the action and returns the one emailed; the email cookie stays set, as a browser's would. */
  const askForCode = async (requestAccountCode: (data: FormData) => Promise<void>): Promise<string> => {
    await redirectOf(requestAccountCode(details()));
    await runScheduled();
    return codeIn(email.last()?.text);
  };

  it("AC8: it sets email_confirmed_at, starts a session for the member, deletes the email cookie and redirects to /", async () => {
    const { requestAccountCode, verifyAccountCode } = await load();
    const code = await askForCode(requestAccountCode);
    vi.setSystemTime(new Date(T0.getTime() + MINUTE));
    expect(await redirectOf(verifyAccountCode(form({ code })))).toBe("/");

    const member = await repo.findMemberByEmail(ADA);
    expect(member?.emailConfirmedAt).toEqual(new Date(T0.getTime() + MINUTE));
    const sessions = setsNamed(SESSION);
    expect(sessions).toHaveLength(1);
    expect(verifySession(sessions[0]?.value ?? "", services.secret, new Date())).toEqual({
      ok: true,
      session: { subjectId: member?.id, expiresAt: new Date(T0.getTime() + MINUTE + SESSION_TTL_MS).toISOString() },
    });
    expect(cookieGone(SIGN_IN_EMAIL)).toBe(true);
  });

  it("AC8: it records one sign_in_by_code event for the member", async () => {
    const { requestAccountCode, verifyAccountCode } = await load();
    const code = await askForCode(requestAccountCode);
    await redirectOf(verifyAccountCode(form({ code })));
    const member = await repo.findMemberByEmail(ADA);
    expect(repo.events()).toEqual([{ kind: "sign_in_by_code", memberId: member?.id, actor: { member: member?.id } }]);
  });

  it("AC8: with ocf_return_to set it redirects there and deletes the cookie", async () => {
    const { requestAccountCode, verifyAccountCode } = await load();
    const code = await askForCode(requestAccountCode);
    request.current.cookies[RETURN_TO] = "/supper-club?size=four&menu=vegan";
    expect(await redirectOf(verifyAccountCode(form({ code })))).toBe("/supper-club?size=four&menu=vegan");
    expect(cookieGone(RETURN_TO)).toBe(true);
  });

  it("AC8: a confirmed member's email_confirmed_at does not move", async () => {
    const before = await confirmedMember();
    await plantCode(before);
    request.current.cookies = { [SIGN_IN_EMAIL]: ADA };
    const { verifyAccountCode } = await load();
    expect(await redirectOf(verifyAccountCode(form({ code: RIGHT_CODE })))).toBe("/");
    expect((await repo.findMemberById(before.id))?.emailConfirmedAt).toEqual(new Date(T0.getTime() - 60 * MINUTE));
    expect(setsNamed(SESSION)).toHaveLength(1);
  });
});

describe("AC10 — a code that fails behaves exactly as on sign-in", () => {
  const unconfirmedWithCode = async (): Promise<Member> => {
    const member = await repo.createMember({ email: ADA });
    await plantCode(member);
    request.current.cookies = { [SIGN_IN_EMAIL]: ADA };
    return member;
  };

  it.each([
    ["a wrong code", { code: WRONG_CODE }],
    ["a blank code", { code: "   " }],
    ["no code field", {}],
  ])("AC10: %s redirects to /create-account/code?error=invalid, keeps the email cookie, sets no session and confirms nobody", async (_what, fields: Record<string, string>) => {
    const member = await unconfirmedWithCode();
    const { verifyAccountCode } = await load();
    expect(await redirectOf(verifyAccountCode(form(fields)))).toBe(`${CODE_PAGE}?error=invalid`);
    expect(request.current.cookies[SIGN_IN_EMAIL]).toBe(ADA);
    expect(setsNamed(SESSION)).toEqual([]);
    expect((await repo.findMemberById(member.id))?.emailConfirmedAt).toBeNull();
  });

  it("AC10: an expired code redirects the same way", async () => {
    await unconfirmedWithCode();
    vi.setSystemTime(new Date(T0.getTime() + 10 * MINUTE));
    const { verifyAccountCode } = await load();
    expect(await redirectOf(verifyAccountCode(form({ code: RIGHT_CODE })))).toBe(`${CODE_PAGE}?error=invalid`);
    expect(setsNamed(SESSION)).toEqual([]);
  });

  it("AC10: a used code redirects the same way", async () => {
    const member = await unconfirmedWithCode();
    await repo.consumeSignInCode(member.id, new Date());
    const { verifyAccountCode } = await load();
    expect(await redirectOf(verifyAccountCode(form({ code: RIGHT_CODE })))).toBe(`${CODE_PAGE}?error=invalid`);
    expect(setsNamed(SESSION)).toEqual([]);
  });

  it("AC10: an email with no member redirects the same way", async () => {
    request.current.cookies = { [SIGN_IN_EMAIL]: "nobody@example.com" };
    const { verifyAccountCode } = await load();
    expect(await redirectOf(verifyAccountCode(form({ code: RIGHT_CODE })))).toBe(`${CODE_PAGE}?error=invalid`);
  });

  it("AC10: the fifth wrong guess answers as the others do, then records one lock event for the member and emails the link, which redeems", async () => {
    const member = await unconfirmedWithCode();
    const { verifyAccountCode } = await load();
    for (let guess = 1; guess <= 5; guess++) {
      expect(await redirectOf(verifyAccountCode(form({ code: WRONG_CODE })))).toBe(`${CODE_PAGE}?error=invalid`);
    }
    expect(email.sent).toEqual([]);
    await runScheduled();
    expect(repo.events()).toEqual([{ kind: "lock", memberId: member.id, actor: { member: member.id } }]);
    expect(email.sent).toHaveLength(1);
    const token = tokenIn(email.last()?.text) ?? "no link in the message";
    expect(email.last()?.to).toBe(ADA);
    expect(await redeemSignInLink(repo, token, { now: new Date() })).toEqual({ ok: true, subjectId: member.id });
  });

  it("AC10: while locked the right code is refused the same way", async () => {
    await unconfirmedWithCode();
    const { verifyAccountCode } = await load();
    for (let guess = 1; guess <= 5; guess++) await redirectOf(verifyAccountCode(form({ code: WRONG_CODE })));
    expect(await redirectOf(verifyAccountCode(form({ code: RIGHT_CODE })))).toBe(`${CODE_PAGE}?error=invalid`);
    expect(setsNamed(SESSION)).toEqual([]);
  });

  it("AC10: a locked member's request on the details step is emailed the link, not a code", async () => {
    await unconfirmedWithCode();
    const { requestAccountCode, verifyAccountCode } = await load();
    for (let guess = 1; guess <= 5; guess++) await redirectOf(verifyAccountCode(form({ code: WRONG_CODE })));
    await runScheduled();
    const sentByTheLock = email.sent.length;
    vi.setSystemTime(new Date(T0.getTime() + 10 * MINUTE));
    expect(await redirectOf(requestAccountCode(details()))).toBe(CODE_PAGE);
    await runScheduled();
    expect(email.sent).toHaveLength(sentByTheLock + 1);
    expect(tokenIn(email.last()?.text)).toBeDefined();
  });

  it("AC10: a missing email cookie redirects to /create-account?error=expired and spends nothing", async () => {
    const member = await repo.createMember({ email: ADA });
    await plantCode(member);
    const before = await repo.getSignInCode(member.id);
    const { verifyAccountCode } = await load();
    expect(await redirectOf(verifyAccountCode(form({ code: RIGHT_CODE })))).toBe("/create-account?error=expired");
    expect(await repo.getSignInCode(member.id)).toEqual(before);
    expect(setsNamed(SESSION)).toEqual([]);
  });
});

describe("AC11 — the details step answers alike for a new, an unconfirmed and a confirmed email", () => {
  const CASES: Array<[string, () => Promise<unknown>]> = [
    ["no member has the email", async () => {}],
    ["its member is unconfirmed", () => repo.createMember({ email: ADA })],
    ["its member is confirmed", confirmedMember],
  ];

  it("AC11: the same redirect, the same cookies and one task after the response, in all three", async () => {
    const { requestAccountCode } = await load();
    const responses: unknown[] = [];
    for (const [, arrange] of CASES) {
      repo = new InMemoryRepository();
      services.repo = repo;
      request.current.sets = [];
      request.current.cookies = {};
      scheduled.tasks = [];
      await arrange();
      const to = await redirectOf(requestAccountCode(details()));
      responses.push({ to, sets: request.current.sets, cookies: request.current.cookies, tasks: scheduled.tasks.length });
    }
    expect(responses[0]).toMatchObject({ to: CODE_PAGE, tasks: 1 });
    expect(responses[1]).toEqual(responses[0]);
    expect(responses[2]).toEqual(responses[0]);
  });

  it.each(CASES)("AC11: when %s, nothing reads or writes a member before the response", async (_what, arrange) => {
    await arrange();
    const saveAccount = vi.spyOn(repo, "saveAccount");
    const findMemberByEmail = vi.spyOn(repo, "findMemberByEmail");
    const { requestAccountCode } = await load();
    expect(await redirectOf(requestAccountCode(details()))).toBe(CODE_PAGE);
    expect(saveAccount).not.toHaveBeenCalled();
    expect(findMemberByEmail).not.toHaveBeenCalled();
    expect(email.sent).toEqual([]);
    await runScheduled();
    expect(email.sent).toHaveLength(1);
  });
});

describe("AC12 — limited in sign-in's own bucket", () => {
  const refusal = { kind: "rate_limit_refusal", bucket: "sign-in-request", key: ADDRESS, windowStart: HOUR_START, actor: null };

  it("AC12: the 21st request in the hour redirects to /create-account?limited=<minutes left, rounded up>", async () => {
    const { requestAccountCode } = await load();
    for (let i = 0; i < 20; i++) expect(await redirectOf(requestAccountCode(details()))).toBe(CODE_PAGE);
    expect(await redirectOf(requestAccountCode(details()))).toBe("/create-account?limited=35");
  });

  it("AC12: with 30 seconds left in the hour it redirects to /create-account?limited=1", async () => {
    vi.setSystemTime(new Date("2026-10-28T14:59:30.000Z"));
    const { requestAccountCode } = await load();
    for (let i = 0; i < 20; i++) await redirectOf(requestAccountCode(details()));
    expect(await redirectOf(requestAccountCode(details()))).toBe("/create-account?limited=1");
  });

  it("AC12: a refused request sets no email cookie and leaves nothing to run after the response", async () => {
    const { requestAccountCode } = await load();
    for (let i = 0; i < 20; i++) await redirectOf(requestAccountCode(details()));
    await runScheduled();
    request.current.sets = [];
    await redirectOf(requestAccountCode(details()));
    expect(request.current.sets).toEqual([]);
    expect(scheduled.tasks).toEqual([]);
  });

  it("AC12: requests through sign-in count: after 20 there, Create Account's next is refused", async () => {
    const { requestAccountCode } = await load();
    const { requestCode } = await import("../sign-in/actions");
    for (let i = 0; i < 20; i++) expect(await redirectOf(requestCode(form({ email: ADA })))).toBe("/sign-in/code");
    expect(await redirectOf(requestAccountCode(details()))).toBe("/create-account?limited=35");
  });

  it("AC12: requests through Create Account count: after 20 here, sign-in's next is refused", async () => {
    const { requestAccountCode } = await load();
    const { requestCode } = await import("../sign-in/actions");
    for (let i = 0; i < 20; i++) expect(await redirectOf(requestAccountCode(details()))).toBe(CODE_PAGE);
    expect(await redirectOf(requestCode(form({ email: ADA })))).toBe("/sign-in?limited=35");
  });

  it("AC12: the window's first refusal records one rate_limit_refusal event, with no actor, and the later ones none", async () => {
    const { requestAccountCode } = await load();
    for (let i = 0; i < 20; i++) await redirectOf(requestAccountCode(details()));
    expect(repo.events()).toEqual([]);
    await redirectOf(requestAccountCode(details()));
    await redirectOf(requestAccountCode(details()));
    expect(repo.events()).toEqual([refusal]);
  });

  it("AC12: the client key is limitKeyFor(clientIpFrom(headers)): another address has its own count", async () => {
    const { requestAccountCode } = await load();
    for (let i = 0; i < 20; i++) await redirectOf(requestAccountCode(details()));
    expect(await redirectOf(requestAccountCode(details()))).toMatch(/^\/create-account\?limited=/);
    request.current.headers = { "x-forwarded-for": "203.0.113.8" };
    expect(await redirectOf(requestAccountCode(details()))).toBe(CODE_PAGE);
  });
});

describe("AC16 — resendAccountCode", () => {
  const stale = async (): Promise<Member> => {
    const member = await repo.createMember({ email: ADA });
    await plantCode(member);
    vi.setSystemTime(new Date(T0.getTime() + 10 * MINUTE));
    request.current.cookies = { [SIGN_IN_EMAIL]: ADA };
    return member;
  };

  it("AC16: it redirects back to /create-account/code", async () => {
    await stale();
    const { resendAccountCode } = await load();
    expect(await redirectOf(resendAccountCode(form({})))).toBe(CODE_PAGE);
  });

  it("AC16: after the response a new code goes to the email in the cookie", async () => {
    await stale();
    const { resendAccountCode } = await load();
    await redirectOf(resendAccountCode(form({})));
    expect(email.sent).toEqual([]);
    await runScheduled();
    expect(email.sent).toHaveLength(1);
    expect(email.last()?.to).toBe(ADA);
    expect(codeIn(email.last()?.text)).not.toBe("no code in the message");
  });

  it("AC16: an email in the form is ignored", async () => {
    await stale();
    await repo.createMember({ email: "grace@example.com" });
    const { resendAccountCode } = await load();
    await redirectOf(resendAccountCode(form({ email: "grace@example.com" })));
    await runScheduled();
    expect(email.sent.map((message) => message.to)).toEqual([ADA]);
    expect(setsNamed(SIGN_IN_EMAIL).map((cookie) => cookie.value)).toEqual([ADA]);
  });

  it("AC16: inside the resend wait nothing more is sent, and the answer is the same", async () => {
    await repo.createMember({ email: ADA }).then(plantCode);
    request.current.cookies = { [SIGN_IN_EMAIL]: ADA };
    const { resendAccountCode } = await load();
    expect(await redirectOf(resendAccountCode(form({})))).toBe(CODE_PAGE);
    await runScheduled();
    expect(email.sent).toEqual([]);
  });

  it("AC16: with no cookie it redirects to /create-account?error=expired and counts nothing", async () => {
    await repo.createMember({ email: ADA });
    const { requestAccountCode, resendAccountCode } = await load();
    for (let i = 0; i < 25; i++) expect(await redirectOf(resendAccountCode(form({ email: ADA })))).toBe("/create-account?error=expired");
    expect(scheduled.tasks).toEqual([]);
    for (let i = 0; i < 20; i++) expect(await redirectOf(requestAccountCode(details()))).toBe(CODE_PAGE);
  });

  it("AC16: limited it redirects to /create-account?limited=<minutes>, counting in the same bucket, and records the refusal", async () => {
    const { requestAccountCode, resendAccountCode } = await load();
    for (let i = 0; i < 20; i++) await redirectOf(requestAccountCode(details()));
    expect(await redirectOf(resendAccountCode(form({})))).toBe("/create-account?limited=35");
    expect(repo.events()).toEqual([{ kind: "rate_limit_refusal", bucket: "sign-in-request", key: ADDRESS, windowStart: HOUR_START, actor: null }]);
  });
});
