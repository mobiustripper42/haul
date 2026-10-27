// AC14: the switcher's server action, with `next/headers` faked. Each test re-imports the action
// after stubbing NODE_ENV, so it holds whether the action reads NODE_ENV per call or at load.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyRequest } from "./next-headers-fake";

const request = vi.hoisted(() => ({ current: { cookies: {}, headers: {}, sets: [] } as import("./next-headers-fake").RequestState }));
vi.mock("next/headers", async () => {
  const { fakeNextHeaders } = await import("./next-headers-fake");
  return {
    cookies: () => fakeNextHeaders(request.current).cookies(),
    headers: () => fakeNextHeaders(request.current).headers(),
  };
});

beforeEach(() => {
  request.current = emptyRequest();
  vi.resetModules();
});

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
