// Issue 130, AC1 and AC2: a signed-in member's page comes out in the language the request asks for,
// not their saved one. One case each through getLanguage; the cookie-then-browser edge cases are
// src/i18n.test.ts's.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryRepository } from "@core/adapters/in-memory-repository.js";
import type { Language } from "@core/i18n.js";
import { signSession } from "@core/sign-in/session.js";
import { getLanguage } from "./language";
import { emptyRequest } from "./next-headers-fake";

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
vi.mock("./services", () => ({
  getRepository: () => services.repo,
  getEmail: () => {
    throw new Error("getLanguage has no reason to send email");
  },
  getSessionSecret: () => services.secret,
}));

beforeEach(() => {
  request.current = emptyRequest();
  services.repo = new InMemoryRepository();
});

async function signIn(language: Language): Promise<void> {
  const member = await services.repo.createMember({ email: "ada@example.com", language });
  const expiresAt = new Date(Date.now() + 24 * 60 * 60_000).toISOString();
  request.current.cookies.ocf_session = signSession({ subjectId: member.id, expiresAt }, services.secret);
}

describe("AC1 (issue 130) — the lang cookie picks a signed-in member's page", () => {
  it("AC1: a member saved as en, with a lang cookie of es, gets es", async () => {
    await signIn("en");
    request.current.cookies.lang = "es";
    expect(await getLanguage()).toBe("es");
  });
});

describe("AC2 (issue 130) — with no cookie, the browser picks a signed-in member's page", () => {
  it("AC2: a member saved as es, with no lang cookie and an Accept-Language of en, gets en", async () => {
    await signIn("es");
    request.current.headers = { "accept-language": "en-US,en;q=0.9" };
    expect(await getLanguage()).toBe("en");
  });
});
