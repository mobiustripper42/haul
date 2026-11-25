// Issue 260, AC6: Your details' four actions for a member who never joined, with the fakes ./details-actions.test.ts uses. What
// each one stores, sends and refuses is that file's, for a subscriber; here each goes through once with no subscription, and
// the three that file does not call signed out are.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeEmail } from "@core/adapters/fake-email.js";
import { FakePayments } from "@core/adapters/fake-payments.js";
import { InMemoryRepository } from "@core/adapters/in-memory-repository.js";
import type { Member } from "@core/members.js";
import { signSession } from "@core/sign-in/session.js";
import { hashCode } from "@core/sign-in/code.js";
import { addSupperClub } from "../admin/subscribers-fixture";
import { emptyRequest } from "../next-headers-fake";
import { redirectOf } from "../screen-test-helpers";
import { confirmEmailChange, keepOldEmail, resendEmailChange, saveDetails } from "./details-actions";

const request = vi.hoisted(() => ({ current: { cookies: {}, headers: {}, sets: [] } as import("../next-headers-fake").RequestState }));
const services = vi.hoisted(() => ({
  repo: undefined as unknown as import("@core/adapters/in-memory-repository.js").InMemoryRepository,
  email: undefined as unknown as import("@core/adapters/fake-email.js").FakeEmail,
  payments: undefined as unknown as import("@core/adapters/fake-payments.js").FakePayments,
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
  getPayments: () => services.payments,
  getSessionSecret: () => services.secret,
  getSiteUrl: () => "https://members.example.test",
}));

const NOW = new Date("2026-10-28T14:25:30.000Z");
const OLD = "ada@example.com";
const NEW = "ada.new@example.com";
const CODE = "123456";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  request.current = emptyRequest();
  request.current.headers = { "x-forwarded-for": "203.0.113.7" };
  scheduled.tasks = [];
  services.repo = new InMemoryRepository();
  services.email = new FakeEmail();
  services.payments = new FakePayments();
  addSupperClub(services.repo);
});

afterEach(() => {
  vi.useRealTimers();
});

const form = (fields: Record<string, string> = {}): FormData => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.append(name, value);
  return data;
};

/** Ada, confirmed, with no subscription. Not signed in. */
const ada = async (): Promise<Member> => {
  const member = await services.repo.saveAccount({ email: OLD, firstName: "Ada", lastName: "Lovelace", phone: "216-555-0100", language: "en" });
  await services.repo.confirmMemberEmail(member.id, NOW);
  return member;
};

const signedInAda = async (): Promise<Member> => {
  const member = await ada();
  request.current.cookies.ocf_session = signSession({ subjectId: member.id, expiresAt: new Date(NOW.getTime() + 60_000).toISOString() }, services.secret);
  return member;
};

/** A change of Ada's email to NEW, pending, whose code is CODE. */
const pending = (member: Member) => services.repo.startEmailChange({ memberId: member.id, newEmail: NEW, codeHash: hashCode(CODE), now: NOW });

/** Runs what was handed to `after`, and gives back the 6-digit code in the one email sent, and who it went to. */
const codeSent = async () => {
  for (const task of scheduled.tasks.splice(0)) await (typeof task === "function" ? task() : task);
  return services.email.sent.map((message) => ({ to: message.to, code: /\b\d{6}\b/.exec(message.text)?.[0] }));
};

describe("AC6 (issue 260) — Your details, a member who never joined", () => {
  it("AC6: saveDetails stores the name, phone, language and menu email choice, and lands on /account?saved=1", async () => {
    const member = await signedInAda();
    const save = form({ firstName: "Adaline", lastName: "Byron", email: OLD, phone: "216-555-0199", language: "es" });
    expect(await redirectOf(saveDetails(save))).toBe("/account?saved=1");
    expect(await services.repo.findMemberById(member.id)).toMatchObject({ email: OLD, firstName: "Adaline", lastName: "Byron", phone: "2165550199", language: "es", menuEmails: false });
  });

  it("AC6: a save with a new email sends the code to the new address alone, and the code confirms it", async () => {
    const member = await signedInAda();
    expect(await redirectOf(saveDetails(form({ firstName: "Ada", lastName: "Lovelace", email: NEW, phone: "216-555-0100", language: "en" })))).toBe("/account");
    const sent = await codeSent();
    expect(sent.map(({ to }) => to)).toEqual([NEW]);
    expect(await redirectOf(confirmEmailChange(form({ code: sent[0]?.code ?? "" })))).toBe("/account?saved=1");
    expect((await services.repo.findMemberById(member.id))?.email).toBe(NEW);
  });

  it("AC6: confirmEmailChange with the right code changes the member's email, and lands on /account?saved=1", async () => {
    const member = await signedInAda();
    await pending(member);
    expect(await redirectOf(confirmEmailChange(form({ code: CODE })))).toBe("/account?saved=1");
    expect((await services.repo.findMemberById(member.id))?.email).toBe(NEW);
  });

  it("AC6: resendEmailChange sends a new code to the pending address, and lands on /account?sent=1", async () => {
    await pending(await signedInAda());
    expect(await redirectOf(resendEmailChange(form({ resend: "1" })))).toBe("/account?sent=1");
    expect(await codeSent()).toEqual([{ to: NEW, code: expect.stringMatching(/^\d{6}$/) }]);
  });

  it("AC6: keepOldEmail drops the pending change, and lands on /account", async () => {
    const member = await signedInAda();
    await pending(member);
    expect(await redirectOf(keepOldEmail(form()))).toBe("/account");
    expect(await services.repo.findEmailChange(member.id)).toBeNull();
    expect((await services.repo.findMemberById(member.id))?.email).toBe(OLD);
  });

  it.each([
    ["confirmEmailChange", confirmEmailChange],
    ["resendEmailChange", resendEmailChange],
    ["keepOldEmail", keepOldEmail],
  ] as const)("AC6: signed out, %s goes to /sign-in, and the pending change stands", async (_name, action) => {
    const member = await ada();
    await pending(member);
    expect(await redirectOf(action(form({ code: CODE })))).toBe("/sign-in");
    expect((await services.repo.findEmailChange(member.id))?.newEmail).toBe(NEW);
    expect((await services.repo.findMemberById(member.id))?.email).toBe(OLD);
  });
});
