// Issue 22, AC21: /sign-in/link, `await SignInLink(props)` rendered through react-dom/server with
// `next/headers` faked and `redirect` throwing, as the code page's test renders it. The repository
// and the email port throw if touched: rendering the page reads and writes nothing in the store.
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { en } from "@core/messages/en.js";
import { Button } from "../../../components/ui/button";
import { Card } from "../../../components/ui/card";
import { Heading } from "../../../components/ui/heading";
import { Shell } from "../../../components/ui/shell";
import { emptyRequest } from "../../next-headers-fake";
import { attributesOf, findAll, inOrder, redirectOf } from "../../screen-test-helpers";
import { signInWithLink } from "../actions";
import SignInLink from "./page";

const request = vi.hoisted(() => ({ current: { cookies: {}, headers: {}, sets: [] } as import("../../next-headers-fake").RequestState }));
const touched = vi.hoisted(() => ({ repository: 0, email: 0 }));

vi.mock("next/headers", async () => {
  const { fakeNextHeaders } = await import("../../next-headers-fake");
  return {
    cookies: () => fakeNextHeaders(request.current).cookies(),
    headers: () => fakeNextHeaders(request.current).headers(),
  };
});
vi.mock("next/navigation", async () => ({ redirect: (await import("../../screen-test-helpers")).throwingRedirect }));
vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("../../services", () => ({
  getRepository: () => {
    touched.repository++;
    throw new Error("/sign-in/link has no reason to read the repository");
  },
  getEmail: () => {
    touched.email++;
    throw new Error("/sign-in/link has no reason to send email");
  },
  getSessionSecret: () => "test-session-secret-that-is-long-enough-0123456789",
  getSiteUrl: () => "https://members.example.test",
}));

const TOKEN = "Lk3vQ9_xR2-mN8pT4wY6zA1bC5dE7fG0hJ2kL4nP6qS";

beforeEach(() => {
  request.current = emptyRequest();
  touched.repository = 0;
  touched.email = 0;
});

async function render(searchParams: { token?: string }) {
  const element = await SignInLink({ searchParams: Promise.resolve(searchParams) });
  return { element, html: renderToStaticMarkup(element) };
}

describe("AC21 (issue 22) — /sign-in/link", () => {
  it("AC21: with a token it reads, in order, the heading, the line, then the one button", async () => {
    const { element, html } = await render({ token: TOKEN });
    const order = [en["signIn.title"], en["signIn.linkPrompt"], en["signIn.submitCode"]];
    expect(inOrder(html, order)).toEqual(order);
    expect(findAll(element, Heading).map((heading) => heading.props.children)).toEqual([en["signIn.title"]]);
  });

  it("AC21: the form's action is signInWithLink, and it holds the token in its one input, a hidden field named token", async () => {
    const { element, html } = await render({ token: TOKEN });
    expect(findAll(element, "form").map((form) => form.props.action)).toEqual([signInWithLink]);
    expect(attributesOf(html, "input")).toEqual([expect.objectContaining({ type: "hidden", name: "token", value: TOKEN })]);
  });

  it("AC21: its one button is a full-width primary Button that submits", async () => {
    const buttons = findAll((await render({ token: TOKEN })).element, Button);
    expect(buttons.map(({ props }) => [props.kind, props.full, props.type])).toEqual([["primary", true, "submit"]]);
  });

  it("AC21: it is one Card in the Shell, as the code page is", async () => {
    const { element } = await render({ token: TOKEN });
    expect(findAll(element, Shell)).toHaveLength(1);
    expect(findAll(element, Card)).toHaveLength(1);
  });

  it("AC21: rendering it touches neither the repository nor the email port", async () => {
    await render({ token: TOKEN });
    expect(touched).toEqual({ repository: 0, email: 0 });
  });

  it.each([
    ["no token", {}],
    ["an empty token", { token: "" }],
  ])("AC21: with %s it redirects to /sign-in?error=link", async (_what, searchParams: { token?: string }) => {
    await expect(redirectOf(SignInLink({ searchParams: Promise.resolve(searchParams) }))).resolves.toBe(
      "/sign-in?error=link",
    );
  });
});
