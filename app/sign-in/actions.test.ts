// Issue 9, AC26–AC29: the sign-in server actions. `next/headers` is faked, `redirect` throws as
// the real one does, `after` collects its callback for the test to run, and the composition root
// (`app/services.ts`) hands out an InMemoryRepository and a FakeEmail. Each test loads the actions
// afresh after stubbing NODE_ENV, so a cookie's `secure` holds whether it is read per call or at load.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeEmail } from "@core/adapters/fake-email.js";
import { InMemoryRepository } from "@core/adapters/in-memory-repository.js";
import type { Member } from "@core/members.js";
import type { EmailMessage } from "@core/ports/email.js";
import { hashCode, issueSignInCode, verifySignInCode } from "@core/sign-in/code.js";
import { SESSION_TTL_MS, verifySession } from "@core/sign-in/session.js";
import { emptyRequest, type CookieSet } from "../next-headers-fake";
import { loggedText, redirectOf } from "../screen-test-helpers";

const request = vi.hoisted(() => ({ current: { cookies: {}, headers: {}, sets: [] } as import("../next-headers-fake").RequestState }));
const services = vi.hoisted(() => ({
  repo: undefined as unknown as import("@core/adapters/in-memory-repository.js").InMemoryRepository,
  email: undefined as unknown as import("@core/ports/email.js").EmailPort,
  secret: "test-session-secret-that-is-long-enough-0123456789",
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
    vi.spyOn(repo, "incrementRateLimit").mockRejectedValue(new Error("counter unavailable"));
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
    vi.spyOn(repo, "saveSignInCode").mockRejectedValue(failure);
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
    issueSignInCode(repo, { subject: ada, code, codeHash: hashCode(code) }, { now: new Date() });

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
