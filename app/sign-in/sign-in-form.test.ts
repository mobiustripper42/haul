// Issue 77, AC6, AC7 and AC10: what SignInForm takes that the /sign-in page's own test
// (app/sign-in/page.test.ts) cannot show: a link and a back link passed in, a card body in the Screen's order.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyRequest } from "../next-headers-fake";
import { attributesOf, findAll, textsOf } from "../screen-test-helpers";
import { SignInForm } from "./sign-in-form";

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
const FORM = ["Email", "Email me a code", "No account yet?", "Create an account"];
const EXPIRED = "That sign-in step expired. Enter your email to get a new code.";
const LIMITED = "Too many sign-in requests from this network. Try again in 5 min.";

beforeEach(() => {
  request.current = emptyRequest();
});

const render = async (props: { limited?: string; error?: string; back?: typeof BACK } = {}) => {
  const element = await SignInForm({ action, createHref: "/to-create", ...props });
  return { element, html: renderToStaticMarkup(element) };
};

describe("SignInForm", () => {
  it("AC7: its closing link goes to createHref", async () => {
    expect(attributesOf((await render()).html, "a").map((link) => link.href)).toEqual(["/to-create"]);
  });

  it("AC10: the closing line sits under the form", async () => {
    expect(textsOf((await render()).html)).toEqual(["Sign in", ...FORM]);
  });

  it("AC6: back sits above the heading, and the notices under it", async () => {
    const { html } = await render({ back: BACK, limited: "5", error: "expired" });
    expect(textsOf(html)).toEqual(["back here", "Sign in", LIMITED, EXPIRED, ...FORM]);
  });

  it("AC8: the form posts to the action it was given", async () => {
    expect(findAll((await render()).element, "form").map((form) => form.props.action)).toEqual([action]);
  });
});
