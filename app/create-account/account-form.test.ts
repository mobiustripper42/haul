// Issue 77, AC6, AC7 and AC8: what AccountForm takes that the /create-account page's own test
// (app/create-account/page.test.ts) cannot show: a link and a back link passed in, a card body in the
// Screen's order, the draft read by the form itself.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyRequest } from "../next-headers-fake";
import { attributesOf, findAll, textsOf } from "../screen-test-helpers";
import { AccountForm } from "./account-form";

const request = vi.hoisted(() => ({ current: { cookies: {}, headers: {}, sets: [] } as import("../next-headers-fake").RequestState }));
vi.mock("next/headers", async () => {
  const { fakeNextHeaders } = await import("../next-headers-fake");
  return {
    cookies: () => fakeNextHeaders(request.current).cookies(),
    headers: () => fakeNextHeaders(request.current).headers(),
  };
});

const action: (formData: FormData) => Promise<void> = async () => {};
const BACK = createElement("p", null, "back here");
const EXPIRED = "That sign-in step expired. Enter your email to get a new code.";
const LIMITED = "Too many sign-in requests from this network. Try again in 5 min.";

beforeEach(() => {
  request.current = emptyRequest();
});

const render = async (props: { limited?: string; error?: string; back?: typeof BACK } = {}) => {
  const element = await AccountForm({ action, signInHref: "/to-sign-in", ...props });
  return { element, html: renderToStaticMarkup(element) };
};

describe("AccountForm", () => {
  it("AC7: its closing link goes to signInHref", async () => {
    const { html } = await render();
    expect(textsOf(html).slice(-2)).toEqual(["Already have an account?", "Sign in"]);
    expect(attributesOf(html, "a").map((link) => link.href)).toEqual(["/to-sign-in"]);
  });

  it("AC6: back sits above the heading, and the notices above back", async () => {
    const texts = textsOf((await render({ back: BACK, limited: "5", error: "expired" })).html);
    expect(texts.slice(0, 4)).toEqual([LIMITED, EXPIRED, "back here", "Create your account"]);
  });

  it("AC8: the form posts to the action it was given", async () => {
    expect(findAll((await render()).element, "form").map((form) => form.props.action)).toEqual([action]);
  });

  it("AC8: after a failed request it reads the draft cookie itself, and refills the form", async () => {
    request.current.cookies = { ocf_account_draft: JSON.stringify({ firstName: "Ada", email: "ada@example" }) };
    const { html } = await render({ error: "email" });
    const refilled = Object.fromEntries(attributesOf(html, "input").map((input) => [input.name, input.value]));
    expect(refilled).toMatchObject({ firstName: "Ada", email: "ada@example" });
  });
});
