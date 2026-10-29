// Issue 9, AC35: the home page's sign-in line. A file of its own so app/page.test.ts, issue 7's,
// runs unchanged. `next/headers` is faked and the composition root mocked, so a signed-in request
// is an ocf_session cookie for a member in an InMemoryRepository.
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryRepository } from "@core/adapters/in-memory-repository.js";
import { signSession } from "@core/sign-in/session.js";
import { setLanguage } from "./language-actions";
import { emptyRequest } from "./next-headers-fake";
import Home from "./page";
import { findAll, screenMarkup, textsOf } from "./screen-test-helpers";
import { signOut } from "./sign-in/actions";

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

async function signIn(): Promise<void> {
  const member = await services.repo.createMember({ email: "ada@example.com" });
  const expiresAt = new Date(Date.now() + 24 * 60 * 60_000).toISOString();
  request.current.cookies.ocf_session = signSession({ subjectId: member.id, expiresAt }, services.secret);
}

const render = async () => {
  const element = await Home();
  return { element, html: renderToStaticMarkup(element) };
};

const HEADING = "<h1\\b[^>]*>OCF Member Portal</h1>\\s*<p\\b[^>]*>Core check: \\$12\\.34</p>";
const SWITCHER =
  "<form\\b[^>]*>\\s*<fieldset\\b[^>]*>\\s*<legend\\b[^>]*>Language</legend>\\s*" +
  "<button\\b[^>]*>English</button>\\s*<button\\b[^>]*>Español</button>\\s*</fieldset>\\s*</form>";

describe("AC35 (issue 9) — the home page, signed out", () => {
  it('AC35: shows a "Sign in" link to /sign-in in its own <p>, after the core-check paragraph and before the switcher', async () => {
    const { html } = await render();
    expect(textsOf(html)).toEqual(["OCF Member Portal", "Core check: $12.34", "Sign in", "Language", "English", "Español"]);
    expect(screenMarkup(html)).toMatch(
      new RegExp(`${HEADING}\\s*<p\\b[^>]*>\\s*<a\\b[^>]*\\bhref="/sign-in"[^>]*>Sign in</a>\\s*</p>\\s*${SWITCHER}`),
    );
  });
});

describe("AC35 (issue 9) — the home page, signed in", () => {
  it('AC35: shows "Signed in as {email}", then a form with a "Sign out" button, after the core-check paragraph and before the switcher', async () => {
    await signIn();
    const { html } = await render();
    expect(textsOf(html)).toEqual([
      "OCF Member Portal",
      "Core check: $12.34",
      "Signed in as ada@example.com",
      "Sign out",
      "Language",
      "English",
      "Español",
    ]);
    expect(screenMarkup(html)).toMatch(
      new RegExp(
        `${HEADING}\\s*<p\\b[^>]*>Signed in as ada@example\\.com</p>\\s*` +
          `<form\\b[^>]*>\\s*<button\\b(?=[^>]*\\btype="submit")[^>]*>Sign out</button>\\s*</form>\\s*${SWITCHER}`,
      ),
    );
    expect(html).not.toContain('href="/sign-in"');
  });

  it("AC35: the sign-out form's action is signOut, and the switcher's is still setLanguage", async () => {
    await signIn();
    const { element } = await render();
    const forms = findAll(element, "form");
    expect(forms.map((f) => f.props.action)).toEqual([signOut, setLanguage]);
  });
});
