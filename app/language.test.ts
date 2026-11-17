// Issue 187, AC1: every screen is English. getLanguage is the one place every screen asks, so the rule's cases
// are here: neither the lang cookie, the Accept-Language header nor a member's saved language moves it.
// Issue 187, AC4: getEmailLanguageDefault, the default of "Language for emails", is the browser's preferred
// language if the app has it, else English, and takes no cookie. The header's own edge cases are
// preferredLanguage's (src/i18n.test.ts); here one accepted and one refused case go through it.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryRepository } from "@core/adapters/in-memory-repository.js";
import type { Language } from "@core/i18n.js";
import { signSession } from "@core/sign-in/session.js";
import { getEmailLanguageDefault, getLanguage } from "./language";
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

describe("AC1 (issue 130) — a signed-in member's screens", () => {
  it("AC1: a member saved as en, with a lang cookie of es, gets en", async () => {
    await signIn("en");
    request.current.cookies.lang = "es";
    expect(await getLanguage()).toBe("en");
  });
});

describe("AC2 (issue 130) — a signed-in member's saved language does not pick the screen", () => {
  it("AC2: a member saved as es, with no lang cookie and an Accept-Language of es, gets en", async () => {
    await signIn("es");
    request.current.headers = { "accept-language": "es-MX,es;q=0.9" };
    expect(await getLanguage()).toBe("en");
  });
});

describe("AC1 (issue 187) — every screen renders in English, whatever the request says", () => {
  it.each([
    ["a lang cookie of es", { lang: "es" }, {}],
    ["an Accept-Language of es", {}, { "accept-language": "es-MX,es;q=0.9" }],
    ["a lang cookie of es and an Accept-Language of es", { lang: "es" }, { "accept-language": "es" }],
    ["a lang cookie of fr", { lang: "fr" }, {}],
    ["an Accept-Language of fr", {}, { "accept-language": "fr-FR,fr;q=0.9" }],
  ] as const)("AC1: with %s, getLanguage resolves en", async (_case, cookies, headers) => {
    request.current.cookies = { ...cookies };
    request.current.headers = { ...headers };
    expect(await getLanguage()).toBe("en");
  });
});

describe("AC4 (issue 187) — getEmailLanguageDefault", () => {
  it("AC4: an Accept-Language whose preferred language the app has gives that language: es-MX gives es", async () => {
    request.current.headers = { "accept-language": "es-MX,es;q=0.9" };
    expect(await getEmailLanguageDefault()).toBe("es");
  });

  it("AC4: an Accept-Language the app has no language for gives en", async () => {
    request.current.headers = { "accept-language": "fr-FR,fr;q=0.9" };
    expect(await getEmailLanguageDefault()).toBe("en");
  });

  it("AC4: no Accept-Language gives en", async () => {
    expect(await getEmailLanguageDefault()).toBe("en");
  });

  it("AC4: the lang cookie has no effect: lang=es with no Accept-Language gives en", async () => {
    request.current.cookies = { lang: "es" };
    expect(await getEmailLanguageDefault()).toBe("en");
  });

  it("AC4: the lang cookie has no effect: lang=en with an Accept-Language of es gives es", async () => {
    request.current.cookies = { lang: "en" };
    request.current.headers = { "accept-language": "es" };
    expect(await getEmailLanguageDefault()).toBe("es");
  });
});
