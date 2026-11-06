// Issue 38, AC10: the sign-in, code and link screens and the sign-in header render the same elements,
// apart from issue 77's AC10, the closing line /sign-in gains under its form,
// attributes and text as before the components (captured from main at 97c7925), attribute order
// aside, and leaving out the language switcher's button classes, which AC11 changes. Rendered
// through react-dom/server with `next/headers` faked, as each screen's own test renders it.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyRequest } from "./next-headers-fake";
import { normalMarkup } from "./screen-test-helpers";
import SignInLayout from "./sign-in/layout";
import SignInCode from "./sign-in/code/page";
import SignInLink from "./sign-in/link/page";
import SignIn from "./sign-in/page";

const request = vi.hoisted(() => ({ current: { cookies: {}, headers: {}, sets: [] } as import("./next-headers-fake").RequestState }));
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
  getRepository: () => {
    throw new Error("rendering a sign-in screen has no reason to read the repository");
  },
  getEmail: () => {
    throw new Error("rendering a sign-in screen has no reason to send email");
  },
  getSessionSecret: () => "test-session-secret-that-is-long-enough-0123456789",
}));

beforeEach(() => {
  request.current = emptyRequest();
});

/** The language switcher's buttons lose their class: AC11, not AC10, says what it is. */
const withoutSwitcherClasses = (tag: string, attributes: Record<string, string>): string[] =>
  tag === "button" && attributes.name === "language" ? ["class"] : [];

const same = (html: string, before: string): void => {
  expect(normalMarkup(html, withoutSwitcherClasses)).toBe(normalMarkup(before, withoutSwitcherClasses));
};

const ACTION = "javascript:throw new Error(&#x27;React form unexpectedly submitted.&#x27;)";

const SIGN_IN_FORM =
  `<form class="flex flex-col gap-6" action="${ACTION}"><p><label for="email" class="mb-2 block text-field-label">Email</label>` +
  '<input id="email" type="email" autoComplete="email" required="" class="field" name="email"/></p>' +
  '<button type="submit" class="btn-primary w-full">Email me a code</button></form>';
const signIn = (notices: string): string =>
  '<main class="page-narrow"><section class="card"><h1 class="font-display text-heading text-teal">Sign in</h1>' +
  `${notices}${SIGN_IN_FORM}` +
  '<span class="block border-t border-divider pt-4 text-small text-ink-muted">No account yet? <a href="/create-account" class="btn-quiet">Create an account</a></span>' +
  "</section></main>";

describe("AC10 — /sign-in renders as before", () => {
  it("AC10: with no notices", async () => {
    same(renderToStaticMarkup(await SignIn({ searchParams: Promise.resolve({}) })), signIn(""));
  });

  it("AC10: with the limited and expired notices", async () => {
    same(
      renderToStaticMarkup(await SignIn({ searchParams: Promise.resolve({ limited: "5", error: "expired" }) })),
      signIn(
        '<p role="alert" class="notice notice-lock">Too many sign-in requests from this network. Try again in 5 min.</p>' +
          '<p role="alert" class="notice notice-clock">That sign-in step expired. Enter your email to get a new code.</p>',
      ),
    );
  });

  it("AC10: with the link notice", async () => {
    same(
      renderToStaticMarkup(await SignIn({ searchParams: Promise.resolve({ error: "link" }) })),
      signIn(
        '<p role="alert" class="notice notice-clock">That sign-in link didn&#x27;t work. It may have expired or been used already. ' +
          "Enter your email to try again.</p>",
      ),
    );
  });
});

const code = (invalid: boolean): string =>
  '<main class="page-narrow"><section class="card">' +
  '<p><a href="/sign-in" class="btn-quiet back-link btn-flush">Use a different email</a></p>' +
  '<h1 class="font-display text-heading text-teal">Enter your code</h1>' +
  '<p class="text-ink-muted">If ada@example.com has an account, a 6-digit code is on its way. It expires in 10 minutes, and a new one can be sent after that.</p>' +
  (invalid
    ? '<p role="alert" class="notice notice-alert">That code didn&#x27;t match, or it has expired. Check it and try again, or ask for a new one. ' +
      "After 5 wrong tries, check your email for a sign-in link.</p>"
    : "") +
  `<form class="flex flex-col gap-6" action="${ACTION}"><p><label for="code" class="mb-2 block text-field-label">6-digit code</label>` +
  '<input id="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" maxLength="6" required="" autofocus=""' +
  `${invalid ? ' aria-invalid="true"' : ""} class="field field-code" name="code"/></p>` +
  '<button type="submit" class="btn-primary w-full">Sign in</button></form>' +
  `<form action="${ACTION}"><input type="hidden" name="email" value="ada@example.com"/>` +
  '<button type="submit" class="btn-quiet btn-flush">Send a new code</button></form></section></main>';

describe("AC10 — /sign-in/code renders as before", () => {
  beforeEach(() => {
    request.current.cookies = { ocf_sign_in_email: "ada@example.com" };
  });

  it("AC10: with no notice", async () => {
    same(renderToStaticMarkup(await SignInCode({ searchParams: Promise.resolve({}) })), code(false));
  });

  it("AC10: with the invalid notice", async () => {
    same(renderToStaticMarkup(await SignInCode({ searchParams: Promise.resolve({ error: "invalid" }) })), code(true));
  });
});

describe("AC10 — /sign-in/link renders as before", () => {
  it("AC10: with a token", async () => {
    same(
      renderToStaticMarkup(await SignInLink({ searchParams: Promise.resolve({ token: "tok" }) })),
      '<main class="page-narrow"><section class="card"><h1 class="font-display text-heading text-teal">Sign in</h1>' +
        '<p class="text-ink-muted">Press the button to finish signing in.</p>' +
        `<form action="${ACTION}"><input type="hidden" name="token" value="tok"/>` +
        '<button type="submit" class="btn-primary w-full">Sign in</button></form></section></main>',
    );
  });
});

const header = (legend: string, current: "en" | "es"): string =>
  '<header class="border-b border-divider bg-surface"><div class="mx-auto flex max-w-page flex-wrap items-center justify-between gap-3 px-4 py-3">' +
  '<a href="/" class="flex flex-col"><span class="font-display text-wordmark text-teal uppercase">Ohio City Farm</span>' +
  '<span class="text-byline text-ink-muted">by Re:Source Cleveland</span></a>' +
  `<form action="${ACTION}"><fieldset class="lang-switch"><legend class="sr-only">${legend}</legend>` +
  `<button type="submit" value="en" lang="en"${current === "en" ? ' aria-current="true"' : ""} name="language">English</button>` +
  `<button type="submit" value="es" lang="es"${current === "es" ? ' aria-current="true"' : ""} name="language">Español</button>` +
  "</fieldset></form></div></header><p>child</p>";

describe("AC10 — the sign-in header renders as before, but for the switcher's classes", () => {
  it.each([
    ["English", {}, "Language", "en"],
    ["Spanish", { lang: "es" }, "Idioma", "es"],
  ] as const)("AC10: in %s", async (_language, cookies, legend, current) => {
    request.current.cookies = { ...cookies };
    const element = await SignInLayout({ children: createElement("p", null, "child") });
    same(renderToStaticMarkup(element), header(legend, current));
  });
});
