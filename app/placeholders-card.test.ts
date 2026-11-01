// Issue 38, AC12: the two developer placeholders, home and admin, put their existing contents, in
// order, in Shell and Card, their title a Heading. `next/headers` is faked and the composition root
// mocked, as app/page-admin-link.test.ts renders them. The switcher's button classes are left out:
// AC11 says what they are.
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryRepository } from "@core/adapters/in-memory-repository.js";
import type { Role } from "@core/members.js";
import { signSession } from "@core/sign-in/session.js";
import { Card } from "../components/ui/card";
import { Heading } from "../components/ui/heading";
import { Shell } from "../components/ui/shell";
import Admin from "./admin/page";
import { emptyRequest } from "./next-headers-fake";
import Home from "./page";
import { findAll, normalMarkup } from "./screen-test-helpers";

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
    throw new Error("the placeholders have no reason to send email");
  },
  getSessionSecret: () => services.secret,
}));

beforeEach(() => {
  request.current = emptyRequest();
  services.repo = new InMemoryRepository();
});

async function signInAs(role: Role): Promise<void> {
  const member = await services.repo.createMember({ email: "lenny@ocf.xx", role });
  const expiresAt = new Date(Date.now() + 24 * 60 * 60_000).toISOString();
  request.current.cookies.ocf_session = signSession({ subjectId: member.id, expiresAt }, services.secret);
}

const withoutSwitcherClasses = (tag: string, attributes: Record<string, string>): string[] =>
  tag === "button" && attributes.name === "language" ? ["class"] : [];
const same = (html: string, expected: string): void => {
  expect(normalMarkup(html, withoutSwitcherClasses)).toBe(normalMarkup(expected, withoutSwitcherClasses));
};

const ACTION = "javascript:throw new Error(&#x27;React form unexpectedly submitted.&#x27;)";
const framed = (title: string, rest: string): string =>
  `<main class="page-narrow"><section class="card"><h1 class="font-display text-heading text-teal">${title}</h1>${rest}</section></main>`;
const SWITCHER =
  `<form action="${ACTION}"><fieldset class="lang-switch"><legend class="sr-only">Language</legend>` +
  '<button type="submit" value="en" lang="en" aria-current="true" name="language">English</button>' +
  '<button type="submit" value="es" lang="es" name="language">Español</button></fieldset></form>';

describe("AC12 — home in Shell and Card, its title a Heading", () => {
  it("AC12: signed out, the title, the core check, the sign-in link and the switcher sit in the card, in order", async () => {
    same(
      renderToStaticMarkup(await Home()),
      framed("OCF Member Portal", '<p>Core check: $12.34</p><p><a href="/sign-in">Sign in</a></p>' + SWITCHER),
    );
  });

  it("AC12: signed in as an admin, the title, the core check, the signed-in line, the admin link, sign-out and the switcher sit in the card, in order", async () => {
    await signInAs("admin");
    same(
      renderToStaticMarkup(await Home()),
      framed(
        "OCF Member Portal",
        "<p>Core check: $12.34</p><p>Signed in as lenny@ocf.xx</p>" +
          '<p><a href="/admin">Admin Page</a></p>' +
          `<form action="${ACTION}"><button type="submit" class="btn-secondary">Sign out</button></form>` +
          SWITCHER,
      ),
    );
  });

  it("AC12: the page's tree holds one Shell, one Card and one Heading", async () => {
    const tree = await Home();
    expect(findAll(tree, Shell)).toHaveLength(1);
    expect(findAll(tree, Card)).toHaveLength(1);
    expect(findAll(tree, Heading)).toHaveLength(1);
  });
});

describe("AC12 — admin in Shell and Card, its title a Heading", () => {
  it("AC12: the title and the member-page link sit in the card, in order", async () => {
    await signInAs("admin");
    same(renderToStaticMarkup(await Admin()), framed("Admin Page", '<p><a href="/">Member Page</a></p>'));
  });

  it("AC12: the page's tree holds one Shell, one Card and one Heading", async () => {
    await signInAs("admin");
    const tree = await Admin();
    expect(findAll(tree, Shell)).toHaveLength(1);
    expect(findAll(tree, Card)).toHaveLength(1);
    expect(findAll(tree, Heading)).toHaveLength(1);
  });
});
