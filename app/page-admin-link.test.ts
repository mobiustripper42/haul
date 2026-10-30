// Issue 10, AC7: the home page's "Admin Page" link. A file of its own so issue 9's
// app/page-sign-in.test.ts, whose AC35 text lists prove a member and a signed-out visitor see no
// link, runs unchanged. `next/headers` is faked and the composition root mocked, as there.
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryRepository } from "@core/adapters/in-memory-repository.js";
import { signSession } from "@core/sign-in/session.js";
import { emptyRequest } from "./next-headers-fake";
import Home from "./page";
import { attributesOf, screenMarkup, textsOf } from "./screen-test-helpers";

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
vi.mock("./services", () => ({
  getRepository: () => services.repo,
  getEmail: () => {
    throw new Error("the home page has no reason to send email");
  },
  getSessionSecret: () => services.secret,
}));

beforeEach(() => {
  request.current = emptyRequest();
  services.repo = new InMemoryRepository();
});

async function signInAsAdmin(): Promise<void> {
  const member = await services.repo.createMember({ email: "lenny@ocf.xx", role: "admin" });
  const expiresAt = new Date(Date.now() + 24 * 60 * 60_000).toISOString();
  request.current.cookies.ocf_session = signSession({ subjectId: member.id, expiresAt }, services.secret);
}

const render = async () => renderToStaticMarkup(await Home());

describe("AC7 (issue 10) — the home page, signed in as an admin", () => {
  it('AC7: shows the texts in order — "Signed in as …", then "Admin Page", then "Sign out"', async () => {
    await signInAsAdmin();
    expect(textsOf(await render())).toEqual([
      "OCF Member Portal",
      "Core check: $12.34",
      "Signed in as lenny@ocf.xx",
      "Admin Page",
      "Sign out",
      "Language",
      "English",
      "Español",
    ]);
  });

  it('AC7: the "Admin Page" link to /admin sits in its own <p>, after the signed-in line and before the sign-out form', async () => {
    await signInAsAdmin();
    const html = await render();
    expect(screenMarkup(html)).toMatch(
      new RegExp(
        "<p\\b[^>]*>Signed in as lenny@ocf\\.xx</p>\\s*" +
          '<p\\b[^>]*>\\s*<a\\b[^>]*\\bhref="/admin"[^>]*>Admin Page</a>\\s*</p>\\s*' +
          '<form\\b[^>]*>\\s*<button\\b(?=[^>]*\\btype="submit")[^>]*>Sign out</button>\\s*</form>',
      ),
    );
    expect(attributesOf(html, "a").filter((a) => a.href === "/admin")).toHaveLength(1);
  });
});
