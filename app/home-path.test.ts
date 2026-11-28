// Issue 271, AC7: `homePath()`, the one home of `/`'s rule (issue 136): a signed-in member, of any role, goes on to their
// account home, everyone else to the Supper Club. The rule's cases are here; the Not Found page takes one each way
// (app/not-found.test.ts), and `/`'s own tests (app/page.test.ts) keep reading the redirect. The session is read
// through the real `getSignedInMember`, with `next/headers` faked.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryRepository } from "@core/adapters/in-memory-repository.js";
import { ROLES, type Role } from "@core/members.js";
import { signSession } from "@core/sign-in/session.js";
import { homePath } from "./home-path";
import { emptyRequest } from "./next-headers-fake";
import { ACCOUNT_PATH } from "./paths";
import { SUPPER_CLUB_PATH } from "./supper-club/paths";

const request = vi.hoisted(() => ({ current: { cookies: {}, headers: {}, sets: [] } as import("./next-headers-fake").RequestState }));
const services = vi.hoisted(() => ({
  repo: undefined as unknown as import("@core/adapters/in-memory-repository.js").InMemoryRepository,
  secret: "test-session-secret-that-is-long-enough-0123456789",
}));
vi.mock("next/headers", async () => {
  const { fakeNextHeaders } = await import("./next-headers-fake");
  return {
    cookies: () => fakeNextHeaders(request.current).cookies(),
    headers: () => fakeNextHeaders(request.current).headers(),
  };
});
vi.mock("next/navigation", async () => ({ redirect: (await import("./screen-test-helpers")).throwingRedirect }));
vi.mock("./services", () => ({ getRepository: () => services.repo, getSessionSecret: () => services.secret }));

beforeEach(() => {
  request.current = emptyRequest();
  services.repo = new InMemoryRepository();
});

const DAY_MS = 24 * 60 * 60_000;

/** Sets the session cookie for a new member of `role`, signed with `secret`, expiring `expiresInMs` from now. */
async function cookieFor(role: Role, { secret = services.secret, expiresInMs = DAY_MS } = {}): Promise<void> {
  const member = await services.repo.createMember({ email: "ada@example.com", role });
  const expiresAt = new Date(Date.now() + expiresInMs).toISOString();
  request.current.cookies.ocf_session = signSession({ subjectId: member.id, expiresAt }, secret);
}

describe("AC7 (issue 271) — homePath, signed out", () => {
  it(`AC7: with no session cookie, homePath() is ${SUPPER_CLUB_PATH}`, async () => {
    await expect(homePath()).resolves.toBe(SUPPER_CLUB_PATH);
  });

  it.each([
    ["has expired", { expiresInMs: -60_000 }],
    ["was signed with another secret", { secret: "another-session-secret-that-is-long-enough-987" }],
  ])(`AC7: with a session cookie whose token %s, homePath() is ${SUPPER_CLUB_PATH}`, async (_what, token) => {
    await cookieFor("member", token);
    await expect(homePath()).resolves.toBe(SUPPER_CLUB_PATH);
  });
});

describe("AC7 (issue 271) — homePath, signed in", () => {
  it.each(ROLES)(`AC7: signed in as a %s, homePath() is ${ACCOUNT_PATH}`, async (role) => {
    await cookieFor(role);
    await expect(homePath()).resolves.toBe(ACCOUNT_PATH);
  });
});
