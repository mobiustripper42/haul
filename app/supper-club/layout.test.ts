// Issue 55, AC2 and AC3: the Supper Club layout picks the header's account link by who is signed in.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryRepository } from "@core/adapters/in-memory-repository.js";
import { signSession } from "@core/sign-in/session.js";
import { emptyRequest } from "../next-headers-fake";
import { normalMarkup, textsOf } from "../screen-test-helpers";
import { SiteHeader } from "../site-header";
import SupperClubLayout from "./layout";

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
vi.mock("../services", () => ({ getRepository: () => services.repo, getSessionSecret: () => services.secret }));

const CHILD = createElement("p", null, "child");

beforeEach(() => {
  request.current = emptyRequest();
  services.repo = new InMemoryRepository();
});

const signIn = async () => {
  const member = await services.repo.createMember({ email: "ada@example.com" });
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  request.current.cookies = { ocf_session: signSession({ subjectId: member.id, expiresAt }, services.secret) };
};

const expectLayoutWith = async (account: "sign-in" | "your-account", text: string) => {
  const html = renderToStaticMarkup(await SupperClubLayout({ children: CHILD }));
  expect(textsOf(html)).toContain(text);
  const header = renderToStaticMarkup(await SiteHeader({ account }));
  expect(normalMarkup(html)).toBe(normalMarkup(`${header}<p>child</p>`));
};

describe("AC2 — the header signed out", () => {
  it('AC2: signed out it renders SiteHeader\'s "sign-in" header, then its children', async () => {
    await expectLayoutWith("sign-in", "Sign in");
  });
});

describe("AC3 — the header signed in", () => {
  it('AC3: signed in it renders SiteHeader\'s "your-account" header, then its children', async () => {
    await signIn();
    await expectLayoutWith("your-account", "Your account");
  });
});
