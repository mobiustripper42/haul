// Issue 10, AC3–AC6 through the page: `await Admin()` with `next/headers` faked and the composition
// root mocked, as app/page-sign-in.test.ts renders the home page. A signed-in request is an
// ocf_session cookie for a member in an InMemoryRepository.
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryRepository } from "@core/adapters/in-memory-repository.js";
import type { Role } from "@core/members.js";
import { signSession } from "@core/sign-in/session.js";
import { emptyRequest } from "../next-headers-fake";
import { attributesOf, redirectOf, screenMarkup, textsOf } from "../screen-test-helpers";
import Admin from "./page";

const request = vi.hoisted(() => ({ current: { cookies: {}, headers: {}, sets: [] } as import("../next-headers-fake").RequestState }));
const services = vi.hoisted(() => ({
  repo: undefined as unknown as import("@core/adapters/in-memory-repository.js").InMemoryRepository,
  secret: "test-session-secret-that-is-long-enough-0123456789",
}));

vi.mock("next/headers", async () => {
  const { fakeNextHeaders } = await import("../next-headers-fake");
  return {
    cookies: () => fakeNextHeaders(request.current).cookies(),
    headers: () => fakeNextHeaders(request.current).headers(),
  };
});
vi.mock("next/navigation", async () => ({ redirect: (await import("../screen-test-helpers")).throwingRedirect }));
vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("../services", () => ({
  getRepository: () => services.repo,
  getEmail: () => {
    throw new Error("/admin has no reason to send email");
  },
  getSessionSecret: () => services.secret,
}));

const DAY = 24 * 60 * 60_000;
const tokenFor = (subjectId: string, expiresAt: Date, secret = services.secret): string =>
  signSession({ subjectId, expiresAt: expiresAt.toISOString() }, secret);

beforeEach(() => {
  request.current = emptyRequest();
  services.repo = new InMemoryRepository();
});

async function signInAs(role: Role): Promise<void> {
  const member = await services.repo.createMember({ email: "lenny@example.com", role });
  request.current.cookies.ocf_session = tokenFor(member.id, new Date(Date.now() + DAY));
}

describe("AC3 (issue 10) — /admin, signed out", () => {
  it("AC3: with no ocf_session cookie /admin redirects to /sign-in", async () => {
    await expect(redirectOf(Admin())).resolves.toBe("/sign-in");
  });
});

describe("AC4 (issue 10) — /admin, a session that does not hold", () => {
  it.each([
    ["an expired token", (id: string) => tokenFor(id, new Date(Date.now() - 1000))],
    ["a token signed with another secret", (id: string) => tokenFor(id, new Date(Date.now() + DAY), "another-secret-that-is-long-enough-0123456789")],
    ["a token that is not a token", (id: string) => `not-a-token-for-${id}`],
  ])("AC4: for an admin, with %s /admin redirects to /sign-in", async (_what, token) => {
    const admin = await services.repo.createMember({ email: "lenny@example.com", role: "admin" });
    request.current.cookies = { ocf_session: token(admin.id) };
    await expect(redirectOf(Admin())).resolves.toBe("/sign-in");
  });

  it("AC4: with a valid token whose member no longer exists /admin redirects to /sign-in", async () => {
    request.current.cookies = { ocf_session: tokenFor("00000000-0000-4000-8000-000000000000", new Date(Date.now() + DAY)) };
    await expect(redirectOf(Admin())).resolves.toBe("/sign-in");
  });
});

describe("AC5 (issue 10) — /admin, signed in as a member", () => {
  it('AC5: for a member whose role is "member", /admin redirects to /', async () => {
    await signInAs("member");
    await expect(redirectOf(Admin())).resolves.toBe("/");
  });
});

describe("AC6 (issue 10) — /admin, signed in as an admin", () => {
  const render = async () => renderToStaticMarkup(await Admin());

  it('AC6: shows the <h1> "Admin Page", then a paragraph holding one link to / reading "Member Page", and no other text', async () => {
    await signInAs("admin");
    const html = await render();
    expect(textsOf(html)).toEqual(["Admin Page", "Member Page"]);
    expect(screenMarkup(html)).toMatch(
      /<h1\b[^>]*>Admin Page<\/h1>\s*<p\b[^>]*>\s*<a\b[^>]*\bhref="\/"[^>]*>Member Page<\/a>\s*<\/p>/,
    );
  });

  it("AC6: has exactly one heading and one link, and no form, button or input — no switcher, no sign-out", async () => {
    await signInAs("admin");
    const html = await render();
    expect(attributesOf(html, "h1")).toHaveLength(1);
    expect(attributesOf(html, "a")).toEqual([expect.objectContaining({ href: "/" })]);
    expect(attributesOf(html, "form")).toEqual([]);
    expect(attributesOf(html, "button")).toEqual([]);
    expect(attributesOf(html, "input")).toEqual([]);
  });
});
