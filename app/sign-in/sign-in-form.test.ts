// Issue 77, AC6 to AC10, and issue 9's AC33 and issue 22's AC22 for the notices: SignInForm, the card body
// of sign-in's email step on /sign-in and in the Supper Club's sign-in pane. It decides which notices show,
// so their tests live here; `limitedMinutes`'s edge cases are app/sign-in/shared.test.ts's.
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTranslator } from "@core/i18n.js";
import { en } from "@core/messages/en.js";
import { Button } from "../../components/ui/button";
import { Hint } from "../../components/ui/hint";
import { Input } from "../../components/ui/input";
import { Notice } from "../../components/ui/notice";
import { emptyRequest } from "../next-headers-fake";
import { alertTexts, attributesOf, findAll, inOrder } from "../screen-test-helpers";
import { SignInForm } from "./sign-in-form";

const request = vi.hoisted(() => ({ current: { cookies: {}, headers: {}, sets: [] } as import("../next-headers-fake").RequestState }));
vi.mock("next/headers", async () => {
  const { fakeNextHeaders } = await import("../next-headers-fake");
  return {
    cookies: () => fakeNextHeaders(request.current).cookies(),
    headers: () => fakeNextHeaders(request.current).headers(),
  };
});

const t = createTranslator("en");
const action: (formData: FormData) => Promise<void> = async () => {};
const BACK = "back here";
const limited = (minutes: number) => t("signIn.limited", { minutes });

beforeEach(() => {
  request.current = emptyRequest();
});

const render = async (props: { limited?: string; error?: string; back?: boolean } = {}) => {
  const { back, ...rest } = props;
  const element = await SignInForm({
    action,
    createHref: "/to-create",
    ...rest,
    ...(back ? { back: createElement("p", null, BACK) } : {}),
  });
  return { element, html: renderToStaticMarkup(element) };
};

describe("SignInForm", () => {
  it("AC7: its closing link goes to createHref", async () => {
    expect(attributesOf((await render()).html, "a").map((link) => link.href)).toEqual(["/to-create"]);
  });

  it("AC10: the closing line sits under the form", async () => {
    const order = [en["signIn.sendCode"], en["signIn.noAccount"]];
    expect(inOrder((await render()).html, order)).toEqual(order);
  });

  it("AC6: back sits above the heading, and the notices under it", async () => {
    const { html } = await render({ back: true, limited: "5", error: "expired" });
    const order = [BACK, en["signIn.title"], limited(5), en["signIn.stepExpired"], en["signIn.emailLabel"]];
    expect(inOrder(html, order)).toEqual(order);
  });

  it("AC8: the form posts to the action it was given", async () => {
    expect(findAll((await render()).element, "form").map((form) => form.props.action)).toEqual([action]);
  });

  it("AC33 (issue 9): the label is for the input, and the input is a required email field named email", async () => {
    const { html } = await render();
    expect(attributesOf(html, "label")).toEqual([expect.objectContaining({ for: "email" })]);
    const inputs = attributesOf(html, "input");
    expect(inputs).toHaveLength(1);
    expect(inputs[0]).toMatchObject({ id: "email", name: "email", type: "email", autocomplete: "email" });
    expect(inputs[0]).toHaveProperty("required");
    expect(inputs[0]).not.toHaveProperty("placeholder");
    expect(attributesOf(html, "button")).toEqual([expect.objectContaining({ type: "submit" })]);
  });

  it("AC7 (issue 19): the email field is an Input and the submit a full-width primary Button", async () => {
    const { element } = await render();
    expect(findAll(element, Input).map((input) => input.props.code)).toEqual([undefined]);
    const submit = findAll(element, Button).filter((button) => button.props.type === "submit");
    expect(submit.map(({ props }) => [props.kind, props.full])).toEqual([["primary", true]]);
  });

  it("AC10, AC7 (issue 77): the closing line is a ruled Hint, its link a quiet Button", async () => {
    const { element } = await render();
    const hints = findAll(element, Hint);
    expect(hints.map((hint) => hint.props.rule)).toEqual([true]);
    expect(findAll(hints[0]?.props.children as ReactNode, Button).map((button) => button.props.kind)).toEqual(["quiet"]);
  });
});

describe("the notices (issue 9, AC33; issue 22, AC22)", () => {
  it("AC33: with no notices it shows no alert", async () => {
    expect(alertTexts((await render()).html)).toEqual([]);
  });

  it("AC33: limited=30 shows the limited notice with that many minutes, a lock notice", async () => {
    const { element, html } = await render({ limited: "30" });
    expect(alertTexts(html)).toEqual([limited(30)]);
    expect(findAll(element, Notice).map((notice) => notice.props.icon)).toEqual(["lock"]);
  });

  it("AC33: a limited value the rule refuses shows no notice", async () => {
    expect(alertTexts((await render({ limited: "61" })).html)).toEqual([]);
  });

  it("AC33: error=expired shows the expired notice, a clock notice", async () => {
    const { element, html } = await render({ error: "expired" });
    expect(alertTexts(html)).toEqual([en["signIn.stepExpired"]]);
    expect(findAll(element, Notice).map((notice) => notice.props.icon)).toEqual(["clock"]);
  });

  it("AC22 (issue 22): error=link shows the link notice, a clock notice as the expired one is", async () => {
    const { element, html } = await render({ error: "link" });
    expect(alertTexts(html)).toEqual([en["signIn.linkFailed"]]);
    expect(findAll(element, Notice).map((notice) => notice.props.icon)).toEqual(["clock"]);
  });

  it.each(["invalid", "Expired", ""])("AC33: error=%j shows no notice", async (error) => {
    expect(alertTexts((await render({ error })).html)).toEqual([]);
  });

  it("AC33: with both, the limited notice comes before the expired one", async () => {
    expect(alertTexts((await render({ limited: "5", error: "expired" })).html)).toEqual([limited(5), en["signIn.stepExpired"]]);
  });
});
