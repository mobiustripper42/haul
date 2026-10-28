// Issue 9, AC30: getSignedInMember, reading ocf_session with `next/headers` faked and the
// composition root mocked, so a test can tell whether the repository was reached at all.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryRepository } from "@core/adapters/in-memory-repository.js";
import { signSession } from "@core/sign-in/session.js";
import { emptyRequest } from "./next-headers-fake";
import { getRepository } from "./services";
import { getSignedInMember } from "./session";

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
  getRepository: vi.fn(() => services.repo),
  getEmail: vi.fn(() => {
    throw new Error("getSignedInMember has no reason to send email");
  }),
  getSessionSecret: () => services.secret,
}));

const DAY = 24 * 60 * 60_000;
const tokenFor = (subjectId: string, expiresAt: Date, secret = services.secret): string =>
  signSession({ subjectId, expiresAt: expiresAt.toISOString() }, secret);

beforeEach(() => {
  request.current = emptyRequest();
  services.repo = new InMemoryRepository();
  vi.mocked(getRepository).mockClear();
});

describe("AC30 (issue 9) — getSignedInMember", () => {
  it("AC30: with no ocf_session cookie it returns null without calling getRepository()", async () => {
    expect(await getSignedInMember()).toBeNull();
    expect(vi.mocked(getRepository)).not.toHaveBeenCalled();
  });

  it.each([
    ["a token that is not a token", (id: string) => `not-a-token-for-${id}`],
    ["a token signed with another secret", (id: string) => tokenFor(id, new Date(Date.now() + DAY), "another-secret-that-is-long-enough-0123456789")],
    ["an expired token", (id: string) => tokenFor(id, new Date(Date.now() - 1000))],
  ])("AC30: with %s it returns null", async (_what, token) => {
    const ada = await services.repo.createMember({ email: "ada@example.com" });
    request.current.cookies = { ocf_session: token(ada.id) };
    expect(await getSignedInMember()).toBeNull();
  });

  it("AC30: with a valid token whose member no longer exists it returns null", async () => {
    request.current.cookies = { ocf_session: tokenFor("00000000-0000-4000-8000-000000000000", new Date(Date.now() + DAY)) };
    expect(await getSignedInMember()).toBeNull();
  });

  it("AC30: with a valid token it returns the member", async () => {
    const ada = await services.repo.createMember({ email: "ada@example.com", language: "es" });
    request.current.cookies = { ocf_session: tokenFor(ada.id, new Date(Date.now() + DAY)) };
    expect(await getSignedInMember()).toEqual(ada);
  });
});
