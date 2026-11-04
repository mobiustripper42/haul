// Issue 9, AC26–AC29, and issue 22, AC18–AC20: the sign-in server actions. `next/headers` is
// faked, `redirect` throws as the real one does, `after` collects its callback for the test to run,
// and the composition root (`app/services.ts`) hands out an InMemoryRepository and a FakeEmail. Each
// test loads the actions afresh after stubbing NODE_ENV, so a cookie's `secure` holds whether it is
// read per call or at load.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeEmail } from "@core/adapters/fake-email.js";
import { InMemoryRepository } from "@core/adapters/in-memory-repository.js";
import { renderEmail } from "@core/email-templates.js";
import type { Member } from "@core/members.js";
import type { EmailMessage } from "@core/ports/email.js";
import type { Repository } from "@core/ports/repository.js";
import { hashCode, issueSignInCode, issueSignInLink, redeemSignInLink, verifySignInCode } from "@core/sign-in/code.js";
import { SESSION_TTL_MS, verifySession } from "@core/sign-in/session.js";
import { emptyRequest, type CookieSet } from "../next-headers-fake";
import { loggedText, redirectOf } from "../screen-test-helpers";

const request = vi.hoisted(() => ({ current: { cookies: {}, headers: {}, sets: [] } as import("../next-headers-fake").RequestState }));
const services = vi.hoisted(() => ({
  repo: undefined as unknown as import("@core/adapters/in-memory-repository.js").InMemoryRepository,
  email: undefined as unknown as import("@core/ports/email.js").EmailPort,
  secret: "test-session-secret-that-is-long-enough-0123456789",
  secretError: undefined as Error | undefined,
  siteUrl: "https://members.example.test",
  siteUrlError: undefined as Error | undefined,
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
  getSessionSecret: () => {
    if (services.secretError) throw services.secretError;
    return services.secret;
  },
  getSiteUrl: () => {
    if (services.siteUrlError) throw services.siteUrlError;
    return services.siteUrl;
  },
}));

// 14:25:30 UTC: 34 min 30 s left in the clock hour the request limit counts in.
const T0 = new Date("2026-10-28T14:25:30.000Z");
const STRANGER = "nobody@example.com";
const SIGN_IN_EMAIL = "ocf_sign_in_email";
const SESSION = "ocf_session";

let repo: InMemoryRepository;
let email: FakeEmail;
let ada: Member;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: T0 });
  request.current = emptyRequest();
  request.current.headers = { "x-forwarded-for": "203.0.113.7" };
  scheduled.tasks = [];
  repo = new InMemoryRepository();
  email = new FakeEmail();
  services.repo = repo;
  services.email = email;
  services.secretError = undefined;
  services.siteUrlError = undefined;
  ada = await repo.createMember({ email: "ada@example.com" });
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

/** Runs every callback handed to `after`, in order. */
async function runScheduled(): Promise<void> {
  for (const task of scheduled.tasks.splice(0)) await (typeof task === "function" ? task() : task);
}

const setsNamed = (name: string): CookieSet[] => request.current.sets.filter((c) => c.name === name);
const cookieGone = (name: string): boolean =>
  !(name in request.current.cookies) || request.current.cookies[name] === "";
const silenceErrors = () => vi.spyOn(console, "error").mockImplementation(() => {});

type WriteMethod = "recordEvent" | "saveSignInCode" | "saveSignInLink" | "incrementRateLimit";

/**
 * Makes `method` reject with `error` on the repository and on every repository `withActor` hands its
 * function: since issue 71 a write runs inside withActor, on whichever repository that gives it.
 */
function failWrite(method: WriteMethod, error: Error): void {
  vi.spyOn(repo, method).mockRejectedValue(error);
  const withActor = repo.withActor.bind(repo);
  const failing = (scoped: Repository): Repository =>
    new Proxy(scoped, {
      get(target, prop) {
        if (prop === method) return () => Promise.reject(error);
        const value: unknown = Reflect.get(target, prop, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  vi.spyOn(repo, "withActor").mockImplementation(((actor, fn) =>
    withActor(actor, (scoped) => fn(failing(scoped)))) as Repository["withActor"]);
}

describe("AC26 (issue 9) — requestCode", () => {
  it.each([
    ["missing", {}],
    ["empty", { email: "" }],
    ["blank", { email: "   " }],
  ])("AC26: an email that is %s redirects to /sign-in, sets no cookie and counts nothing", async (_what, fields: Record<string, string>) => {
    const { requestCode } = await load();
    for (let i = 0; i < 25; i++) expect(await redirectOf(requestCode(form(fields)))).toBe("/sign-in");
    expect(request.current.sets).toEqual([]);
    expect(scheduled.tasks).toEqual([]);
    // Had any of those 25 counted against the address, the 20 below would not all get through.
    for (let i = 0; i < 20; i++) expect(await redirectOf(requestCode(form({ email: STRANGER })))).toBe("/sign-in/code");
  });

  it.each([
    ["a member's", "  Ada@Example.com  ", "Ada@Example.com"],
    ["a stranger's", "\tNobody@Example.com ", "Nobody@Example.com"],
  ])("AC26: %s email sets ocf_sign_in_email to the trimmed email for 600 s, httpOnly, lax, path /, not secure, and redirects to /sign-in/code", async (_who, entered, trimmed) => {
    const { requestCode } = await load("development");
    expect(await redirectOf(requestCode(form({ email: entered })))).toBe("/sign-in/code");
    expect(request.current.sets).toHaveLength(1);
    const [cookie] = request.current.sets;
    expect(cookie).toMatchObject({ name: SIGN_IN_EMAIL, value: trimmed, maxAge: 600, httpOnly: true, sameSite: "lax", path: "/" });
    expect(Boolean(cookie?.secure)).toBe(false);
  });

  it.each([
    ["a member's", "Ada@Example.com"],
    ["a stranger's", STRANGER],
  ])("AC26: in production, %s email's ocf_sign_in_email is secure", async (_who, entered) => {
    const { requestCode } = await load("production");
    expect(await redirectOf(requestCode(form({ email: entered })))).toBe("/sign-in/code");
    expect(request.current.sets).toEqual([
      expect.objectContaining({ name: SIGN_IN_EMAIL, value: entered, maxAge: 600, httpOnly: true, sameSite: "lax", path: "/", secure: true }),
    ]);
  });

  it("AC26: the 21st request from one address in a clock hour redirects to /sign-in?limited=<minutes left, rounded up> and sets no cookie", async () => {
    const { requestCode } = await load();
    for (let i = 0; i < 20; i++) await redirectOf(requestCode(form({ email: i % 2 ? STRANGER : "ada@example.com" })));
    request.current.sets = [];
    expect(await redirectOf(requestCode(form({ email: "ada@example.com" })))).toBe("/sign-in?limited=35");
    expect(await redirectOf(requestCode(form({ email: STRANGER })))).toBe("/sign-in?limited=35");
    expect(request.current.sets).toEqual([]);
  });

  it("AC26: limited with 30 seconds left in the hour redirects to /sign-in?limited=1", async () => {
    vi.setSystemTime(new Date("2026-10-28T14:59:30.000Z"));
    const { requestCode } = await load();
    for (let i = 0; i < 20; i++) await redirectOf(requestCode(form({ email: STRANGER })));
    expect(await redirectOf(requestCode(form({ email: STRANGER })))).toBe("/sign-in?limited=1");
  });

  it("AC26: the client key is limitKeyFor(clientIpFrom(headers)) — two IPv6 addresses in one /64 share a limit", async () => {
    const { requestCode } = await load();
    request.current.headers = { "x-forwarded-for": "2001:db8:0:2::1" };
    for (let i = 0; i < 20; i++) expect(await redirectOf(requestCode(form({ email: STRANGER })))).toBe("/sign-in/code");
    request.current.headers = { "x-forwarded-for": "2001:db8:0:2::ffff" };
    expect(await redirectOf(requestCode(form({ email: STRANGER })))).toMatch(/^\/sign-in\?limited=/);
    request.current.headers = { "x-forwarded-for": "2001:db8:0:3::1" };
    expect(await redirectOf(requestCode(form({ email: STRANGER })))).toBe("/sign-in/code");
  });

  it("AC26: the client key is limitKeyFor(clientIpFrom(headers)) — behind a Cloudflare hop, the limit follows cf-connecting-ip", async () => {
    const { requestCode } = await load();
    for (let i = 0; i < 20; i++) {
      request.current.headers = { "x-forwarded-for": `173.245.48.${i + 1}`, "cf-connecting-ip": "198.51.100.7" };
      expect(await redirectOf(requestCode(form({ email: STRANGER })))).toBe("/sign-in/code");
    }
    request.current.headers = { "x-forwarded-for": "173.245.48.99", "cf-connecting-ip": "198.51.100.7" };
    expect(await redirectOf(requestCode(form({ email: STRANGER })))).toMatch(/^\/sign-in\?limited=/);
    request.current.headers = { "x-forwarded-for": "173.245.48.99", "cf-connecting-ip": "198.51.100.8" };
    expect(await redirectOf(requestCode(form({ email: STRANGER })))).toBe("/sign-in/code");
  });

  it("AC26: with no usable client address the key is null and nothing is limited", async () => {
    const { requestCode } = await load();
    request.current.headers = {};
    for (let i = 0; i < 25; i++) expect(await redirectOf(requestCode(form({ email: STRANGER })))).toBe("/sign-in/code");
  });

  it("AC26: a broken counter is written to console.error, naming the bucket, and the request still goes through", async () => {
    const { requestCode } = await load();
    const errors = silenceErrors();
    failWrite("incrementRateLimit", new Error("counter unavailable"));
    expect(await redirectOf(requestCode(form({ email: "ada@example.com" })))).toBe("/sign-in/code");
    expect(loggedText(errors)).toContain("sign-in-request");
  });
});

describe("AC27 (issue 9) — requestCode issues and sends after the response", () => {
  it("AC27: for a member's email it schedules one after() callback and has stored and sent nothing yet", async () => {
    const { requestCode } = await load();
    await redirectOf(requestCode(form({ email: "Ada@Example.com" })));
    expect(scheduled.tasks).toHaveLength(1);
    expect(await repo.getSignInCode(ada.id)).toBeNull();
    expect(email.sent).toEqual([]);
  });

  it("AC27: the callback issues the code and emails it to the member; that code then verifies", async () => {
    const { requestCode } = await load();
    await redirectOf(requestCode(form({ email: "Ada@Example.com" })));
    await runScheduled();
    expect(email.sent).toHaveLength(1);
    const message = email.last();
    expect(message?.to).toBe("ada@example.com");
    const code = /\b(\d{6})\b/.exec(message?.text ?? "")?.[1] ?? "no code in the message";
    const result = await verifySignInCode(repo, (e) => repo.findMemberByEmail(e), { email: "ada@example.com", code }, { now: new Date() });
    expect(result).toEqual({ ok: true, subjectId: ada.id });
  });

  it("AC27: on 'skip' nothing is sent — a second request 30 seconds later sends no second email", async () => {
    const { requestCode } = await load();
    await redirectOf(requestCode(form({ email: "ada@example.com" })));
    await runScheduled();
    vi.setSystemTime(new Date(T0.getTime() + 30_000));
    await redirectOf(requestCode(form({ email: "ada@example.com" })));
    await runScheduled();
    expect(email.sent).toHaveLength(1);
  });

  it("AC27: for a stranger's email nothing is scheduled", async () => {
    const { requestCode } = await load();
    await redirectOf(requestCode(form({ email: STRANGER })));
    expect(scheduled.tasks).toEqual([]);
    expect(email.sent).toEqual([]);
  });

  it("AC27: an EmailSendError while sending is caught and logged with the member id, the error's name and its status — never its message, the code or the message text", async () => {
    const { requestCode } = await load();
    const { EmailSendError } = await import("@core/ports/email.js");
    let captured: EmailMessage | undefined;
    services.email = {
      send: async (message) => {
        captured = message;
        throw new EmailSendError("Resend", 422, '{"message":"resend-reply-body: the to field is invalid"}');
      },
    };
    const errors = silenceErrors();
    await redirectOf(requestCode(form({ email: "ada@example.com" })));
    await expect(runScheduled()).resolves.toBeUndefined();

    const logged = loggedText(errors);
    expect(logged).toContain(ada.id);
    expect(logged).toContain("EmailSendError");
    expect(logged).toContain("422");
    expect(logged).not.toContain("resend-reply-body");
    expect(logged).not.toContain("Resend send failed");
    if (!captured) throw new Error("the callback never tried to send");
    expect(logged).not.toContain(captured.text);
    const code = /\b(\d{6})\b/.exec(captured.text)?.[1] ?? "no code in the message";
    expect(logged.replaceAll(ada.id, "")).not.toContain(code);
  });

  it("AC27: an error while issuing is caught and logged with the member id and the error's name — never its message — and nothing is sent", async () => {
    const { requestCode } = await load();
    const failure = Object.assign(new Error("could not reach postgres://haul:hunter2@db/haul"), { name: "StoreDownError" });
    failWrite("saveSignInCode", failure);
    const errors = silenceErrors();
    await redirectOf(requestCode(form({ email: "ada@example.com" })));
    await expect(runScheduled()).resolves.toBeUndefined();

    const logged = loggedText(errors);
    expect(logged).toContain(ada.id);
    expect(logged).toContain("StoreDownError");
    expect(logged).not.toContain("hunter2");
    expect(email.sent).toEqual([]);
  });
});

describe("AC28 (issue 9) — verifyCode", () => {
  const issueCode = (code: string) =>
    issueSignInCode(repo, { subject: ada, code, codeHash: hashCode(code) }, { now: new Date(), mintLinkToken: () => "tok-never" });

  it("AC28: with no ocf_sign_in_email cookie it redirects to /sign-in?error=expired", async () => {
    await issueCode("123456");
    const { verifyCode } = await load();
    expect(await redirectOf(verifyCode(form({ code: "123456" })))).toBe("/sign-in?error=expired");
    expect(setsNamed(SESSION)).toEqual([]);
  });

  it("AC28: the right code, trimmed, sets ocf_session to a token for the member expiring 30 days on, deletes ocf_sign_in_email and redirects to /", async () => {
    await issueCode("123456");
    request.current.cookies = { [SIGN_IN_EMAIL]: "Ada@Example.com" };
    const { verifyCode } = await load("development");
    expect(await redirectOf(verifyCode(form({ code: "  123456 " })))).toBe("/");

    const sessions = setsNamed(SESSION);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ maxAge: 2_592_000, httpOnly: true, sameSite: "lax", path: "/" });
    expect(Boolean(sessions[0]?.secure)).toBe(false);
    expect(verifySession(sessions[0]?.value ?? "", services.secret, new Date())).toEqual({
      ok: true,
      session: { subjectId: ada.id, expiresAt: new Date(T0.getTime() + SESSION_TTL_MS).toISOString() },
    });
    expect(cookieGone(SIGN_IN_EMAIL)).toBe(true);
  });

  it("AC28: in production ocf_session is secure", async () => {
    await issueCode("123456");
    request.current.cookies = { [SIGN_IN_EMAIL]: "ada@example.com" };
    const { verifyCode } = await load("production");
    expect(await redirectOf(verifyCode(form({ code: "123456" })))).toBe("/");
    expect(setsNamed(SESSION)).toEqual([
      expect.objectContaining({ maxAge: 2_592_000, httpOnly: true, sameSite: "lax", path: "/", secure: true }),
    ]);
  });

  it.each([
    ["a wrong code", "ada@example.com", { code: "654321" }],
    ["a blank code", "ada@example.com", { code: "   " }],
    ["no code field", "ada@example.com", {}],
    ["a stranger's email", STRANGER, { code: "123456" }],
  ])("AC28: %s redirects to /sign-in/code?error=invalid, keeps ocf_sign_in_email and sets no session", async (_what, cookieEmail, fields: Record<string, string>) => {
    await issueCode("123456");
    request.current.cookies = { [SIGN_IN_EMAIL]: cookieEmail };
    const { verifyCode } = await load();
    expect(await redirectOf(verifyCode(form(fields)))).toBe("/sign-in/code?error=invalid");
    expect(request.current.cookies[SIGN_IN_EMAIL]).toBe(cookieEmail);
    expect(setsNamed(SESSION)).toEqual([]);
  });
});

describe("AC29 (issue 9) — signOut", () => {
  it("AC29: deletes ocf_session and redirects to /", async () => {
    request.current.cookies = { [SESSION]: "some-token" };
    const { signOut } = await load();
    expect(await redirectOf(signOut())).toBe("/");
    expect(cookieGone(SESSION)).toBe(true);
  });
});

// Issue 22 from here on.
const MINUTE = 60_000;
const RIGHT_CODE = "123456";
const WRONG_CODE = "654321";
const LINK_IN_TEXT = /\/sign-in\/link\?token=([A-Za-z0-9_-]+)/;
const tokenIn = (text: string | undefined): string | undefined => LINK_IN_TEXT.exec(text ?? "")?.[1];

/** The link email Ada should get for `token`, rendered as the template renders it. */
const linkEmailFor = (token: string) => ({
  to: "ada@example.com",
  ...renderEmail("signInLink", "en", { link: `${services.siteUrl}/sign-in/link?token=${token}`, minutes: 10 }),
});

/** Ada's code, saved straight through the store at the current time, with no hold. */
const plantCode = () => {
  const createdAt = new Date();
  return repo.saveSignInCode({
    subjectId: ada.id,
    codeHash: hashCode(RIGHT_CODE),
    createdAt,
    expiresAt: new Date(createdAt.getTime() + 10 * MINUTE),
  });
};

/** Locks Ada through the core alone: her code, then five wrong guesses on it. No link is sent. */
async function lockAda(): Promise<void> {
  await plantCode();
  for (let g = 0; g < 5; g++) {
    await verifySignInCode(repo, (e) => repo.findMemberByEmail(e), { email: ada.email, code: WRONG_CODE }, { now: new Date() });
  }
}

describe("AC18 (issue 22) — verifyCode emails the link after the guess that locks", () => {
  it("AC18: the guess that locks schedules one after() callback; before it runs nothing is stored or sent, then Ada gets the link email for <site>/sign-in/link?token=…, and the token redeems", async () => {
    await plantCode();
    request.current.cookies = { [SIGN_IN_EMAIL]: "ada@example.com" };
    const { verifyCode } = await load();
    for (let g = 1; g <= 4; g++) {
      expect(await redirectOf(verifyCode(form({ code: WRONG_CODE })))).toBe("/sign-in/code?error=invalid");
      expect(scheduled.tasks).toEqual([]);
    }
    expect(await redirectOf(verifyCode(form({ code: WRONG_CODE })))).toBe("/sign-in/code?error=invalid");
    expect(scheduled.tasks).toHaveLength(1);
    expect((await repo.getSignInCode(ada.id))?.linkHash ?? null).toBeNull();
    expect(email.sent).toEqual([]);

    // The code went this same instant: a link saved with the hold would be refused.
    await runScheduled();
    expect(email.sent).toHaveLength(1);
    const token = tokenIn(email.last()?.text) ?? "no link in the message";
    expect(email.last()).toEqual(linkEmailFor(token));
    expect(await redeemSignInLink(repo, token, { now: new Date() })).toEqual({ ok: true, subjectId: ada.id });
  });

  it("AC18: the locking guess answers as any wrong guess does — the same redirect, ocf_sign_in_email kept, no cookie set", async () => {
    await plantCode();
    request.current.cookies = { [SIGN_IN_EMAIL]: "ada@example.com" };
    const { verifyCode } = await load();
    for (let g = 1; g <= 4; g++) await redirectOf(verifyCode(form({ code: WRONG_CODE })));
    const cookiesBefore = { ...request.current.cookies };
    expect(await redirectOf(verifyCode(form({ code: WRONG_CODE })))).toBe("/sign-in/code?error=invalid");
    expect(request.current.cookies).toEqual(cookiesBefore);
    expect(request.current.sets).toEqual([]);
  });

  it("AC18: a stranger's fifth wrong guess schedules nothing", async () => {
    await plantCode();
    request.current.cookies = { [SIGN_IN_EMAIL]: STRANGER };
    const { verifyCode } = await load();
    for (let g = 1; g <= 5; g++) {
      expect(await redirectOf(verifyCode(form({ code: WRONG_CODE })))).toBe("/sign-in/code?error=invalid");
    }
    expect(scheduled.tasks).toEqual([]);
  });

  it("AC18: a failed send is caught and logged as \"sign-in email not delivered\" with the member id, the error's name and its status — never the token, the URL or the error's message", async () => {
    await plantCode();
    request.current.cookies = { [SIGN_IN_EMAIL]: "ada@example.com" };
    const { verifyCode } = await load();
    // The class as the reloaded actions module sees it, as AC27 (issue 9) takes it.
    const { EmailSendError } = await import("@core/ports/email.js");
    let captured: EmailMessage | undefined;
    services.email = {
      send: async (message) => {
        captured = message;
        throw new EmailSendError("Resend", 422, '{"message":"resend-reply-body: the to field is invalid"}');
      },
    };
    const errors = silenceErrors();
    for (let g = 1; g <= 5; g++) await redirectOf(verifyCode(form({ code: WRONG_CODE })));
    await expect(runScheduled()).resolves.toBeUndefined();

    const logged = loggedText(errors);
    expect(logged).toContain("sign-in email not delivered");
    expect(logged).toContain(ada.id);
    expect(logged).toContain("EmailSendError");
    expect(logged).toContain("422");
    expect(logged).not.toContain("resend-reply-body");
    const token = tokenIn(captured?.text);
    expect(token, "the callback never tried to send the link").toBeDefined();
    expect(logged).not.toContain(token);
    expect(logged).not.toContain("/sign-in/link");
    expect(logged).not.toContain(services.siteUrl);
  });

  it("AC18: an error while saving the link is caught and logged with the member id and the error's name — never its message — and nothing is sent", async () => {
    await plantCode();
    request.current.cookies = { [SIGN_IN_EMAIL]: "ada@example.com" };
    const failure = Object.assign(new Error("could not reach postgres://haul:hunter2@db/haul"), { name: "StoreDownError" });
    failWrite("saveSignInLink", failure);
    const errors = silenceErrors();
    const { verifyCode } = await load();
    for (let g = 1; g <= 5; g++) await redirectOf(verifyCode(form({ code: WRONG_CODE })));
    await expect(runScheduled()).resolves.toBeUndefined();

    const logged = loggedText(errors);
    expect(logged).toContain(ada.id);
    expect(logged).toContain("StoreDownError");
    expect(logged).not.toContain("hunter2");
    expect(email.sent).toEqual([]);
  });

  it.each([
    ["a member's wrong guess", "ada@example.com", WRONG_CODE],
    ["a member's right code", "ada@example.com", RIGHT_CODE],
    ["a stranger's guess", STRANGER, RIGHT_CODE],
  ])("AC18: verifyCode reads getSiteUrl() before the guess — when it throws, %s fails with that error, spends nothing and starts no session", async (_what, cookieEmail, code) => {
    await plantCode();
    const before = await repo.getSignInCode(ada.id);
    request.current.cookies = { [SIGN_IN_EMAIL]: cookieEmail };
    const failure = new Error("SITE_URL must be set in production");
    services.siteUrlError = failure;
    const { verifyCode } = await load();
    await expect(verifyCode(form({ code }))).rejects.toBe(failure);
    expect(await repo.getSignInCode(ada.id)).toEqual(before);
    expect(setsNamed(SESSION)).toEqual([]);
  });
});

describe("AC19 (issue 22) — requestCode reads the site's address first, then sends what issueSignInCode says", () => {
  it("AC19: when getSiteUrl() throws, a member's request and a stranger's fail with that error, set no cookie, and none of them counts against the address", async () => {
    const failure = new Error("SITE_URL must be set in production");
    services.siteUrlError = failure;
    const { requestCode } = await load();
    for (let i = 0; i < 25; i++) {
      await expect(requestCode(form({ email: i % 2 ? STRANGER : "ada@example.com" }))).rejects.toBe(failure);
    }
    expect(request.current.sets).toEqual([]);
    expect(scheduled.tasks).toEqual([]);
    services.siteUrlError = undefined;
    for (let i = 0; i < 20; i++) expect(await redirectOf(requestCode(form({ email: STRANGER })))).toBe("/sign-in/code");
  });

  it("AC19: a request the limit would refuse fails with getSiteUrl()'s error too", async () => {
    const { requestCode } = await load();
    for (let i = 0; i < 20; i++) await redirectOf(requestCode(form({ email: STRANGER })));
    const failure = new Error("SITE_URL must be set in production");
    services.siteUrlError = failure;
    await expect(requestCode(form({ email: STRANGER }))).rejects.toBe(failure);
  });

  it("AC19: a locked member's request outside the wait emails the link after the response, and its token redeems", async () => {
    await lockAda();
    vi.setSystemTime(new Date(T0.getTime() + 10 * MINUTE));
    const { requestCode } = await load();
    expect(await redirectOf(requestCode(form({ email: "ada@example.com" })))).toBe("/sign-in/code");
    expect(email.sent).toEqual([]);
    await runScheduled();
    expect(email.sent).toHaveLength(1);
    const token = tokenIn(email.last()?.text) ?? "no link in the message";
    expect(email.last()).toEqual(linkEmailFor(token));
    expect(await redeemSignInLink(repo, token, { now: new Date() })).toEqual({ ok: true, subjectId: ada.id });
  });

  it("AC19: { send: 'nothing' } sends nothing — a locked member's second request 5 minutes after the link gets no second email", async () => {
    await lockAda();
    vi.setSystemTime(new Date(T0.getTime() + 10 * MINUTE));
    const { requestCode } = await load();
    await redirectOf(requestCode(form({ email: "ada@example.com" })));
    await runScheduled();
    vi.setSystemTime(new Date(T0.getTime() + 15 * MINUTE));
    expect(await redirectOf(requestCode(form({ email: "ada@example.com" })))).toBe("/sign-in/code");
    await runScheduled();
    expect(email.sent).toHaveLength(1);
  });

  it("AC19: the response is the same whether it sends nothing, a link or a code — the same redirect and the same cookie", async () => {
    await lockAda();
    const { requestCode } = await load();
    const respond = async (minutes: number) => {
      vi.setSystemTime(new Date(T0.getTime() + minutes * MINUTE));
      request.current.sets = [];
      const to = await redirectOf(requestCode(form({ email: "ada@example.com" })));
      await runScheduled();
      return { to, sets: request.current.sets, sent: email.sent.length };
    };
    const nothing = await respond(5);
    const link = await respond(10);
    const token = tokenIn(email.last()?.text) ?? "no link in the message";
    await redeemSignInLink(repo, token, { now: new Date() });
    const code = await respond(11);

    // Each response really was the outcome it is named for: nothing, then the link, then a code.
    expect([nothing.sent, link.sent, code.sent]).toEqual([0, 1, 2]);
    expect(/\b\d{6}\b/.test(email.last()?.text ?? "")).toBe(true);
    expect({ to: link.to, sets: link.sets }).toEqual({ to: nothing.to, sets: nothing.sets });
    expect({ to: code.to, sets: code.sets }).toEqual({ to: nothing.to, sets: nothing.sets });
  });

  it("AC19: a link email that fails to send is logged as a code's is — member id, name, status — never the token or the URL", async () => {
    await lockAda();
    vi.setSystemTime(new Date(T0.getTime() + 10 * MINUTE));
    const { requestCode } = await load();
    // The class as the reloaded actions module sees it, as AC27 (issue 9) takes it.
    const { EmailSendError } = await import("@core/ports/email.js");
    let captured: EmailMessage | undefined;
    services.email = {
      send: async (message) => {
        captured = message;
        throw new EmailSendError("Resend", 422, '{"message":"resend-reply-body: the to field is invalid"}');
      },
    };
    const errors = silenceErrors();
    await redirectOf(requestCode(form({ email: "ada@example.com" })));
    await expect(runScheduled()).resolves.toBeUndefined();

    const token = tokenIn(captured?.text);
    expect(token, "the callback never tried to send a link").toBeDefined();
    const logged = loggedText(errors);
    expect(logged).toContain(ada.id);
    expect(logged).toContain("EmailSendError");
    expect(logged).toContain("422");
    expect(logged).not.toContain("resend-reply-body");
    expect(logged).not.toContain(token);
    expect(logged).not.toContain("/sign-in/link");
    expect(logged).not.toContain(services.siteUrl);
  });
});

describe("AC20 (issue 22) — signInWithLink", () => {
  const TOKEN = "Lk3vQ9_xR2-mN8pT4wY6zA1bC5dE7fG0hJ2kL4nP6qS";

  /** Ada's code and, straight after it with no hold, a live link for TOKEN. */
  const linkForAda = async () => {
    await plantCode();
    await issueSignInLink(repo, ada, { now: new Date(), mintLinkToken: () => TOKEN, hold: false });
  };

  it("AC20: a token that redeems, trimmed, sets ocf_session for the member expiring 30 days on, deletes ocf_sign_in_email and redirects to /", async () => {
    await linkForAda();
    request.current.cookies = { [SIGN_IN_EMAIL]: "ada@example.com" };
    const { signInWithLink } = await load("development");
    await expect(redirectOf(signInWithLink(form({ token: `  ${TOKEN} ` })))).resolves.toBe("/");

    const sessions = setsNamed(SESSION);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ maxAge: 2_592_000, httpOnly: true, sameSite: "lax", path: "/" });
    expect(verifySession(sessions[0]?.value ?? "", services.secret, new Date())).toEqual({
      ok: true,
      session: { subjectId: ada.id, expiresAt: new Date(T0.getTime() + SESSION_TTL_MS).toISOString() },
    });
    expect(cookieGone(SIGN_IN_EMAIL)).toBe(true);
  });

  it("AC20: the token works once — a second press starts no session and redirects to /sign-in?error=link", async () => {
    await linkForAda();
    const { signInWithLink } = await load();
    await expect(redirectOf(signInWithLink(form({ token: TOKEN })))).resolves.toBe("/");
    request.current.sets = [];
    await expect(redirectOf(signInWithLink(form({ token: TOKEN })))).resolves.toBe("/sign-in?error=link");
    expect(setsNamed(SESSION)).toEqual([]);
  });

  it.each([
    ["an unknown token", { token: "not-the-live-token" }],
    ["an empty token", { token: "" }],
    ["a blank token", { token: "   " }],
    ["no token field", {}],
  ])("AC20: %s starts no session and redirects to /sign-in?error=link", async (_what, fields: Record<string, string>) => {
    await linkForAda();
    const { signInWithLink } = await load();
    await expect(redirectOf(signInWithLink(form(fields)))).resolves.toBe("/sign-in?error=link");
    expect(setsNamed(SESSION)).toEqual([]);
  });

  it("AC20: an expired link's token starts no session and redirects to /sign-in?error=link", async () => {
    await linkForAda();
    vi.setSystemTime(new Date(T0.getTime() + 10 * MINUTE));
    const { signInWithLink } = await load();
    await expect(redirectOf(signInWithLink(form({ token: TOKEN })))).resolves.toBe("/sign-in?error=link");
    expect(setsNamed(SESSION)).toEqual([]);
  });

  it("AC20: it reads the session secret first — when that throws, it fails with that error and the link still redeems", async () => {
    await linkForAda();
    const failure = new Error("SESSION_SECRET must be set in production");
    services.secretError = failure;
    const { signInWithLink } = await load();
    await expect(signInWithLink(form({ token: TOKEN }))).rejects.toBe(failure);
    expect(await redeemSignInLink(repo, TOKEN, { now: new Date() })).toEqual({ ok: true, subjectId: ada.id });
  });
});

// Issue 34 from here on: sign-in events in the audit log, and the sign-in email log's stage. The
// fake repository's events() is its record of what recordEvent was given, in order.
const ADDRESS = "203.0.113.7";
const HOUR_START = new Date("2026-10-28T14:00:00.000Z");
const LINK_TOKEN = "Lk3vQ9_xR2-mN8pT4wY6zA1bC5dE7fG0hJ2kL4nP6qS";

/** Ada's code and, straight after it with no hold, a live link for LINK_TOKEN. */
const plantLink = async () => {
  await plantCode();
  await issueSignInLink(repo, ada, { now: new Date(), mintLinkToken: () => LINK_TOKEN, hold: false });
};

/** The second argument of each console.error call whose first is `message`: the fields logged with it. */
const fieldsLoggedWith = (spy: { mock: { calls: unknown[][] } }, message: string): unknown[] =>
  spy.mock.calls.filter((args) => args[0] === message).map((args) => args[1]);

/** A failure as `pg` raises one: named "error", its code a SQLSTATE, its message carrying what a log must not. */
const pgError = (code: string): Error =>
  Object.assign(new Error("could not reach postgres://haul:hunter2@db/haul"), { name: "error", code });

describe("AC1 — a sign-in by code records one sign_in_by_code event", () => {
  it("AC1: the right code records one sign_in_by_code event for the member by the time it redirects to /, with nothing left to run after the response", async () => {
    await plantCode();
    request.current.cookies = { [SIGN_IN_EMAIL]: "ada@example.com" };
    const { verifyCode } = await load();
    expect(await redirectOf(verifyCode(form({ code: RIGHT_CODE })))).toBe("/");
    expect(repo.events()).toEqual([{ kind: "sign_in_by_code", memberId: ada.id, actor: { member: ada.id } }]);
    expect(scheduled.tasks).toEqual([]);
  });
});

describe("AC2 — a sign-in by link records one sign_in_by_link event", () => {
  it("AC2: pressing the link page's button with a live token records one sign_in_by_link event for the member by the time it redirects to /, with nothing left to run after the response", async () => {
    await plantLink();
    const { signInWithLink } = await load();
    expect(await redirectOf(signInWithLink(form({ token: LINK_TOKEN })))).toBe("/");
    expect(repo.events()).toEqual([{ kind: "sign_in_by_link", memberId: ada.id, actor: { member: ada.id } }]);
    expect(scheduled.tasks).toEqual([]);
  });
});

describe("AC3 — the guess that locks records one lock event, after the response", () => {
  it("AC3: the fifth wrong guess records nothing before the scheduled work runs, then one lock event for the member", async () => {
    await plantCode();
    request.current.cookies = { [SIGN_IN_EMAIL]: "ada@example.com" };
    const { verifyCode } = await load();
    for (let g = 1; g <= 5; g++) await redirectOf(verifyCode(form({ code: WRONG_CODE })));
    expect(repo.events()).toEqual([]);
    await runScheduled();
    expect(repo.events()).toEqual([{ kind: "lock", memberId: ada.id, actor: { member: ada.id } }]);
  });

  it("AC3: the four wrong guesses before it record nothing, and guesses while locked — wrong or right — record nothing more", async () => {
    await plantCode();
    request.current.cookies = { [SIGN_IN_EMAIL]: "ada@example.com" };
    const { verifyCode } = await load();
    for (let g = 1; g <= 4; g++) {
      await redirectOf(verifyCode(form({ code: WRONG_CODE })));
      await runScheduled();
      expect(repo.events()).toEqual([]);
    }
    await redirectOf(verifyCode(form({ code: WRONG_CODE })));
    await runScheduled();
    expect(await redirectOf(verifyCode(form({ code: WRONG_CODE })))).toBe("/sign-in/code?error=invalid");
    expect(await redirectOf(verifyCode(form({ code: RIGHT_CODE })))).toBe("/sign-in/code?error=invalid");
    await runScheduled();
    expect(repo.events()).toEqual([{ kind: "lock", memberId: ada.id, actor: { member: ada.id } }]);
  });
});

describe("AC4 — an address's first rate-limit refusal in a window records one rate_limit_refusal event", () => {
  // A refusal identifies nobody, so its actor is null (issue 71).
  const refusal = (windowStart: Date, key = ADDRESS) => ({ kind: "rate_limit_refusal", bucket: "sign-in-request", key, windowStart, actor: null });

  it("AC4: the 21st request in the clock hour records one rate_limit_refusal event with the bucket, the address's limiter key and the window's start; the 20 within the limit record nothing", async () => {
    const { requestCode } = await load();
    for (let i = 0; i < 20; i++) await redirectOf(requestCode(form({ email: i % 2 ? STRANGER : "ada@example.com" })));
    expect(repo.events()).toEqual([]);
    expect(await redirectOf(requestCode(form({ email: STRANGER })))).toBe("/sign-in?limited=35");
    expect(repo.events()).toEqual([refusal(HOUR_START)]);
  });

  it("AC4: the 22nd and later in that window record nothing; the first refusal in the next window records one", async () => {
    const { requestCode } = await load();
    for (let i = 0; i < 23; i++) await redirectOf(requestCode(form({ email: STRANGER })));
    expect(repo.events()).toEqual([refusal(HOUR_START)]);

    vi.setSystemTime(new Date("2026-10-28T15:05:00.000Z"));
    for (let i = 0; i < 20; i++) await redirectOf(requestCode(form({ email: STRANGER })));
    expect(repo.events()).toEqual([refusal(HOUR_START)]);
    expect(await redirectOf(requestCode(form({ email: STRANGER })))).toBe("/sign-in?limited=55");
    await redirectOf(requestCode(form({ email: STRANGER })));
    expect(repo.events()).toEqual([refusal(HOUR_START), refusal(new Date("2026-10-28T15:00:00.000Z"))]);
  });

  it("AC4: the key carried is the limiter key, not the raw address — an IPv6 client's /64", async () => {
    request.current.headers = { "x-forwarded-for": "2001:db8:0:2::1" };
    const { requestCode } = await load();
    for (let i = 0; i < 21; i++) await redirectOf(requestCode(form({ email: STRANGER })));
    expect(repo.events()).toEqual([refusal(HOUR_START, "2001:db8:0:2::/64")]);
  });

  it("AC4: with no usable client address (a null key), 25 requests record nothing", async () => {
    request.current.headers = {};
    const { requestCode } = await load();
    for (let i = 0; i < 25; i++) expect(await redirectOf(requestCode(form({ email: STRANGER })))).toBe("/sign-in/code");
    await runScheduled();
    expect(repo.events()).toEqual([]);
  });
});

describe("AC5 — what happens more than once records no event", () => {
  type Actions = Awaited<ReturnType<typeof load>>;

  it.each<[string, (actions: Actions) => Promise<void>]>([
    [
      "a wrong code",
      async ({ verifyCode }) => {
        await plantCode();
        request.current.cookies = { [SIGN_IN_EMAIL]: "ada@example.com" };
        expect(await redirectOf(verifyCode(form({ code: WRONG_CODE })))).toBe("/sign-in/code?error=invalid");
      },
    ],
    [
      "an expired code",
      async ({ verifyCode }) => {
        await plantCode();
        vi.setSystemTime(new Date(T0.getTime() + 10 * MINUTE));
        request.current.cookies = { [SIGN_IN_EMAIL]: "ada@example.com" };
        expect(await redirectOf(verifyCode(form({ code: RIGHT_CODE })))).toBe("/sign-in/code?error=invalid");
      },
    ],
    [
      "a consumed code",
      async ({ verifyCode }) => {
        await plantCode();
        await repo.consumeSignInCode(ada.id, new Date());
        request.current.cookies = { [SIGN_IN_EMAIL]: "ada@example.com" };
        expect(await redirectOf(verifyCode(form({ code: RIGHT_CODE })))).toBe("/sign-in/code?error=invalid");
      },
    ],
    [
      "an unknown link token",
      async ({ signInWithLink }) => {
        await plantLink();
        expect(await redirectOf(signInWithLink(form({ token: "not-the-live-token" })))).toBe("/sign-in?error=link");
      },
    ],
    [
      "an expired link",
      async ({ signInWithLink }) => {
        await plantLink();
        vi.setSystemTime(new Date(T0.getTime() + 10 * MINUTE));
        expect(await redirectOf(signInWithLink(form({ token: LINK_TOKEN })))).toBe("/sign-in?error=link");
      },
    ],
    [
      "a link already used",
      async ({ signInWithLink }) => {
        await plantLink();
        await redeemSignInLink(repo, LINK_TOKEN, { now: new Date() });
        expect(await redirectOf(signInWithLink(form({ token: LINK_TOKEN })))).toBe("/sign-in?error=link");
      },
    ],
    [
      "a stranger's email at every step — the request, five guesses and the right code",
      async ({ requestCode, verifyCode }) => {
        await plantCode();
        await redirectOf(requestCode(form({ email: STRANGER })));
        request.current.cookies = { [SIGN_IN_EMAIL]: STRANGER };
        for (let g = 1; g <= 5; g++) await redirectOf(verifyCode(form({ code: WRONG_CODE })));
        expect(await redirectOf(verifyCode(form({ code: RIGHT_CODE })))).toBe("/sign-in/code?error=invalid");
      },
    ],
    [
      "a member's code request and the code email it sends",
      async ({ requestCode }) => {
        await redirectOf(requestCode(form({ email: "ada@example.com" })));
        await runScheduled();
        expect(email.sent).toHaveLength(1);
      },
    ],
    [
      "a locked member's request and the link email it sends",
      async ({ requestCode }) => {
        await lockAda();
        vi.setSystemTime(new Date(T0.getTime() + 10 * MINUTE));
        await redirectOf(requestCode(form({ email: "ada@example.com" })));
        await runScheduled();
        expect(tokenIn(email.last()?.text)).toBeDefined();
      },
    ],
  ])("AC5: %s records no event", async (_what, act) => {
    const actions = await load();
    await act(actions);
    await runScheduled();
    expect(repo.events()).toEqual([]);
  });
});

describe("AC10 — an event that fails to record is logged and changes nothing the member sees", () => {
  // Issue 71, AC14: logged by recordEventSafely, under this message.
  const EVENT_NOT_RECORDED = "audit event not recorded";

  it("AC10: when sign_in_by_code fails to record, the sign-in still completes, and console.error gets the message with the event, the member id, the error's name and its code — never its message", async () => {
    failWrite("recordEvent", pgError("57P01"));
    const errors = silenceErrors();
    await plantCode();
    request.current.cookies = { [SIGN_IN_EMAIL]: "ada@example.com" };
    const { verifyCode } = await load();

    expect(await redirectOf(verifyCode(form({ code: RIGHT_CODE })))).toBe("/");
    const sessions = setsNamed(SESSION);
    expect(sessions).toHaveLength(1);
    expect(verifySession(sessions[0]?.value ?? "", services.secret, new Date())).toMatchObject({ ok: true, session: { subjectId: ada.id } });
    expect(cookieGone(SIGN_IN_EMAIL)).toBe(true);

    expect(fieldsLoggedWith(errors, EVENT_NOT_RECORDED)).toEqual([expect.objectContaining({ error: "error", code: "57P01" })]);
    const logged = loggedText(errors);
    expect(logged).toContain("sign_in_by_code");
    expect(logged).toContain(ada.id);
    expect(logged).not.toContain("hunter2");
  });

  it("AC10: when sign_in_by_link fails to record, the sign-in still completes, and the failure is logged with the event, the member id, the error's name and its code — never its message", async () => {
    failWrite("recordEvent", pgError("57P01"));
    const errors = silenceErrors();
    await plantLink();
    const { signInWithLink } = await load();

    expect(await redirectOf(signInWithLink(form({ token: LINK_TOKEN })))).toBe("/");
    const sessions = setsNamed(SESSION);
    expect(sessions).toHaveLength(1);
    expect(verifySession(sessions[0]?.value ?? "", services.secret, new Date())).toMatchObject({ ok: true, session: { subjectId: ada.id } });

    expect(fieldsLoggedWith(errors, EVENT_NOT_RECORDED)).toEqual([expect.objectContaining({ error: "error", code: "57P01" })]);
    const logged = loggedText(errors);
    expect(logged).toContain("sign_in_by_link");
    expect(logged).toContain(ada.id);
    expect(logged).not.toContain("hunter2");
  });

  it("AC10: when the lock fails to record, the lock's link is still stored and sent, and the failure is logged with the event, the member id, the error's name and its code — never its message", async () => {
    failWrite("recordEvent", pgError("57P01"));
    const errors = silenceErrors();
    await plantCode();
    request.current.cookies = { [SIGN_IN_EMAIL]: "ada@example.com" };
    const { verifyCode } = await load();

    for (let g = 1; g <= 5; g++) await redirectOf(verifyCode(form({ code: WRONG_CODE })));
    await expect(runScheduled()).resolves.toBeUndefined();
    expect(email.sent).toHaveLength(1);
    const token = tokenIn(email.last()?.text) ?? "no link in the message";
    expect(email.last()).toEqual(linkEmailFor(token));
    expect(await redeemSignInLink(repo, token, { now: new Date() })).toEqual({ ok: true, subjectId: ada.id });

    expect(fieldsLoggedWith(errors, EVENT_NOT_RECORDED)).toEqual([expect.objectContaining({ error: "error", code: "57P01" })]);
    const logged = loggedText(errors);
    expect(logged).toContain("lock");
    expect(logged).toContain(ada.id);
    expect(logged).not.toContain("hunter2");
    expect(logged).not.toContain(token);
  });

  it("AC10: when a refusal fails to record, the request still redirects to /sign-in?limited=<minutes>, and the failure is logged with the event, the error's name and its code — never the client address or its message", async () => {
    failWrite("recordEvent", pgError("57P01"));
    const errors = silenceErrors();
    const { requestCode } = await load();

    for (let i = 0; i < 20; i++) await redirectOf(requestCode(form({ email: STRANGER })));
    expect(await redirectOf(requestCode(form({ email: STRANGER })))).toBe("/sign-in?limited=35");
    expect(request.current.sets.filter((c) => c.name === SIGN_IN_EMAIL)).toHaveLength(20);

    expect(fieldsLoggedWith(errors, EVENT_NOT_RECORDED)).toEqual([expect.objectContaining({ error: "error", code: "57P01" })]);
    const logged = loggedText(errors);
    expect(logged).toContain("rate_limit_refusal");
    expect(logged).not.toContain(ADDRESS);
    expect(logged).not.toContain("hunter2");
  });
});

describe("AC11 — the sign-in email log says which stage failed", () => {
  const NOT_DELIVERED = "sign-in email not delivered";

  it("AC11: a Postgres error storing a code is logged with stage store, the member id, the error's name and its SQLSTATE — never its message — and nothing is sent", async () => {
    failWrite("saveSignInCode", pgError("53300"));
    const errors = silenceErrors();
    const { requestCode } = await load();
    await redirectOf(requestCode(form({ email: "ada@example.com" })));
    await expect(runScheduled()).resolves.toBeUndefined();

    expect(fieldsLoggedWith(errors, NOT_DELIVERED)).toEqual([expect.objectContaining({ stage: "store", error: "error", code: "53300" })]);
    const logged = loggedText(errors);
    expect(logged).toContain(ada.id);
    expect(logged).not.toContain("hunter2");
    expect(email.sent).toEqual([]);
  });

  it("AC11: a Postgres error storing the lock's link is logged with stage store, the member id, the error's name and its SQLSTATE — never its message — and nothing is sent", async () => {
    await plantCode();
    request.current.cookies = { [SIGN_IN_EMAIL]: "ada@example.com" };
    failWrite("saveSignInLink", pgError("53300"));
    const errors = silenceErrors();
    const { verifyCode } = await load();
    for (let g = 1; g <= 5; g++) await redirectOf(verifyCode(form({ code: WRONG_CODE })));
    await expect(runScheduled()).resolves.toBeUndefined();

    expect(fieldsLoggedWith(errors, NOT_DELIVERED)).toEqual([expect.objectContaining({ stage: "store", error: "error", code: "53300" })]);
    const logged = loggedText(errors);
    expect(logged).toContain(ada.id);
    expect(logged).not.toContain("hunter2");
    expect(email.sent).toEqual([]);
  });

  it("AC11: a code email that fails to send is logged with stage send, the member id, the error's name and its status — never the code or the error's message", async () => {
    const { requestCode } = await load();
    const { EmailSendError } = await import("@core/ports/email.js");
    let captured: EmailMessage | undefined;
    services.email = {
      send: async (message) => {
        captured = message;
        throw new EmailSendError("Resend", 422, '{"message":"resend-reply-body: the to field is invalid"}');
      },
    };
    const errors = silenceErrors();
    await redirectOf(requestCode(form({ email: "ada@example.com" })));
    await expect(runScheduled()).resolves.toBeUndefined();

    expect(fieldsLoggedWith(errors, NOT_DELIVERED)).toEqual([expect.objectContaining({ stage: "send", error: "EmailSendError", status: 422 })]);
    const logged = loggedText(errors);
    expect(logged).toContain(ada.id);
    expect(logged).not.toContain("resend-reply-body");
    const code = /\b(\d{6})\b/.exec(captured?.text ?? "")?.[1];
    expect(code, "the callback never tried to send a code").toBeDefined();
    expect(logged.replaceAll(ada.id, "")).not.toContain(code);
  });

  it("AC11: the lock's link email that fails to send is logged with stage send, the member id, the error's name and its status — never the token, the URL or the error's message", async () => {
    await plantCode();
    request.current.cookies = { [SIGN_IN_EMAIL]: "ada@example.com" };
    const { verifyCode } = await load();
    const { EmailSendError } = await import("@core/ports/email.js");
    let captured: EmailMessage | undefined;
    services.email = {
      send: async (message) => {
        captured = message;
        throw new EmailSendError("Resend", 422, '{"message":"resend-reply-body: the to field is invalid"}');
      },
    };
    const errors = silenceErrors();
    for (let g = 1; g <= 5; g++) await redirectOf(verifyCode(form({ code: WRONG_CODE })));
    await expect(runScheduled()).resolves.toBeUndefined();

    expect(fieldsLoggedWith(errors, NOT_DELIVERED)).toEqual([expect.objectContaining({ stage: "send", error: "EmailSendError", status: 422 })]);
    const logged = loggedText(errors);
    expect(logged).toContain(ada.id);
    expect(logged).not.toContain("resend-reply-body");
    const token = tokenIn(captured?.text);
    expect(token, "the callback never tried to send the link").toBeDefined();
    expect(logged).not.toContain(token);
    expect(logged).not.toContain("/sign-in/link");
    expect(logged).not.toContain(services.siteUrl);
  });
});

// Issue 71 from here on: every event names who acted, read from the fake's events().
describe("AC4 (issue 71) — a sign-in event's actor", () => {
  const kindsAndActors = () => repo.events().map(({ kind, actor }) => ({ kind, actor }));

  it("AC4: a sign-in by code's event names the member signing in as its actor", async () => {
    await plantCode();
    request.current.cookies = { [SIGN_IN_EMAIL]: "ada@example.com" };
    const { verifyCode } = await load();
    expect(await redirectOf(verifyCode(form({ code: RIGHT_CODE })))).toBe("/");
    expect(kindsAndActors()).toEqual([{ kind: "sign_in_by_code", actor: { member: ada.id } }]);
  });

  it("AC4: a sign-in by link's event names the member signing in as its actor", async () => {
    await plantLink();
    const { signInWithLink } = await load();
    expect(await redirectOf(signInWithLink(form({ token: LINK_TOKEN })))).toBe("/");
    expect(kindsAndActors()).toEqual([{ kind: "sign_in_by_link", actor: { member: ada.id } }]);
  });

  it("AC4: a lock's event names the locked member as its actor", async () => {
    await plantCode();
    request.current.cookies = { [SIGN_IN_EMAIL]: "ada@example.com" };
    const { verifyCode } = await load();
    for (let g = 1; g <= 5; g++) await redirectOf(verifyCode(form({ code: WRONG_CODE })));
    await runScheduled();
    expect(kindsAndActors()).toEqual([{ kind: "lock", actor: { member: ada.id } }]);
  });

  it("AC4: a rate-limit refusal's event has a null actor", async () => {
    const { requestCode } = await load();
    for (let i = 0; i < 21; i++) await redirectOf(requestCode(form({ email: "ada@example.com" })));
    await runScheduled();
    expect(kindsAndActors()).toEqual([{ kind: "rate_limit_refusal", actor: null }]);
  });
});
