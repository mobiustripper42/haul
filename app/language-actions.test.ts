// AC14: the switcher's server action, with `next/headers` faked. Each test re-imports the action
// after stubbing NODE_ENV, so it holds whether the action reads NODE_ENV per call or at load.
// Issue 130, AC3: the switch, pressed by a signed-in member, leaves their saved language alone.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryRepository } from "@core/adapters/in-memory-repository.js";
import type { Language } from "@core/i18n.js";
import { signSession } from "@core/sign-in/session.js";
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
    throw new Error("setLanguage has no reason to send email");
  },
  getSessionSecret: () => services.secret,
}));

beforeEach(() => {
  request.current = emptyRequest();
  services.repo = new InMemoryRepository();
  vi.resetModules();
});

/** A signed-in member saved as `language`; returns their id. */
async function signIn(language: Language): Promise<string> {
  const member = await services.repo.createMember({ email: "ada@example.com", language });
  const expiresAt = new Date(Date.now() + 24 * 60 * 60_000).toISOString();
  request.current.cookies.ocf_session = signSession({ subjectId: member.id, expiresAt }, services.secret);
  return member.id;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

async function submit(nodeEnv: string, fields: Record<string, string>): Promise<void> {
  vi.stubEnv("NODE_ENV", nodeEnv);
  const { setLanguage } = await import("./language-actions");
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.append(name, value);
  await expect(setLanguage(form)).resolves.toBeUndefined();
}

const ONE_YEAR_SECONDS = 31_536_000;

describe("AC14 — setLanguage", () => {
  it.each(["development", "test"])(
    "AC14: language=es sets lang=es for a year, path /, lax, httpOnly, not secure when NODE_ENV is %s",
    async (nodeEnv) => {
      await submit(nodeEnv, { language: "es" });
      expect(request.current.sets).toHaveLength(1);
      const [cookie] = request.current.sets;
      expect(cookie).toMatchObject({
        name: "lang",
        value: "es",
        path: "/",
        maxAge: ONE_YEAR_SECONDS,
        sameSite: "lax",
        httpOnly: true,
      });
      expect(Boolean(cookie?.secure)).toBe(false);
    },
  );

  it("AC14: language=es sets a secure cookie when NODE_ENV is production", async () => {
    await submit("production", { language: "es" });
    expect(request.current.sets).toHaveLength(1);
    expect(request.current.sets[0]).toMatchObject({
      name: "lang",
      value: "es",
      path: "/",
      maxAge: ONE_YEAR_SECONDS,
      sameSite: "lax",
      httpOnly: true,
      secure: true,
    });
  });

  it("AC14: language=en sets lang=en", async () => {
    await submit("development", { language: "en" });
    expect(request.current.sets).toHaveLength(1);
    expect(request.current.sets[0]).toMatchObject({ name: "lang", value: "en" });
  });

  it.each([
    ["language=fr", { language: "fr" }],
    ["language=ES", { language: "ES" }],
    ["no language field", {}],
    ["only another field", { other: "es" }],
  ])("AC14: %s sets no cookie and does not throw", async (_what, fields) => {
    await submit("development", fields);
    expect(request.current.sets).toEqual([]);
  });
});

describe("AC3 (issue 130) — the switch never changes a member's saved language", () => {
  it("AC3: a member saved as en who presses Español is still saved as en", async () => {
    const id = await signIn("en");
    await submit("development", { language: "es" });
    expect((await services.repo.findMemberById(id))?.language).toBe("en");
  });
});
