// Issue 97, AC1: / is no longer the developer placeholder; it sends everyone on to the Supper Club. The
// unit test sees only the target: `redirect` is mocked to throw with it. That it is a temporary
// redirect, a 307, only a real request shows (e2e/home-redirect.spec.ts). Issue 7's Spanish proof the
// placeholder carried lives on the language switch (app/language-switcher.test.ts).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryRepository } from "@core/adapters/in-memory-repository.js";
import type { Role } from "@core/members.js";
import { signSession } from "@core/sign-in/session.js";
import { emptyRequest } from "./next-headers-fake";
import Home from "./page";
import { redirectOf } from "./screen-test-helpers";

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
vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("./services", () => ({ getRepository: () => services.repo, getSessionSecret: () => services.secret }));

beforeEach(() => {
  request.current = emptyRequest();
  services.repo = new InMemoryRepository();
});

async function signInAs(role: Role): Promise<void> {
  const member = await services.repo.createMember({ email: "ada@example.com", role });
  const expiresAt = new Date(Date.now() + 24 * 60 * 60_000).toISOString();
  request.current.cookies.ocf_session = signSession({ subjectId: member.id, expiresAt }, services.secret);
}

// Inside an async function, so a `Home` that redirects synchronously is caught the same way.
const landing = () => redirectOf((async () => Home())());

describe("AC1 — / goes on to the Supper Club", () => {
  it("AC1: signed out, / redirects to /supper-club", async () => {
    await expect(landing()).resolves.toBe("/supper-club");
  });

  it.each(["member", "admin"] as const)("AC1: signed in as a %s, / redirects to /supper-club", async (role) => {
    await signInAs(role);
    await expect(landing()).resolves.toBe("/supper-club");
  });
});
