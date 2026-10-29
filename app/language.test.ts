// Issue 9, AC31: a signed-in member's stored language wins over the lang cookie and
// Accept-Language. Signed out, issue 7's order holds — app/page.test.ts and app/layout.test.ts
// prove that, unchanged.
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

describe("AC31 (issue 9) — getLanguage with a signed-in member", () => {
  it("AC31: a member whose language is es gets es over a lang cookie of en and an Accept-Language of en", async () => {
    await signIn("es");
    request.current.cookies.lang = "en";
    request.current.headers = { "accept-language": "en-US,en;q=0.9" };
    expect(await getLanguage()).toBe("es");
  });

  it("AC31: a member whose language is en gets en over a lang cookie of es and an Accept-Language of es", async () => {
    await signIn("en");
    request.current.cookies.lang = "es";
    request.current.headers = { "accept-language": "es-MX" };
    expect(await getLanguage()).toBe("en");
  });
});
