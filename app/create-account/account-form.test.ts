// Issue 55, AC4, AC10 and AC12, and issue 77, AC6, AC7 and AC8: AccountForm, the card body of Create Account's
// details step on /create-account and in the Supper Club's Create Account pane. It owns the words, the
// fields, the errors, the refill from the draft cookie and the notices, so their tests live here;
// `limitedMinutes`'s edge cases are app/sign-in/shared.test.ts's, and what /create-account passes in is
// app/create-account/page.test.ts's.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_LIMITS } from "@core/create-account.js";
import { LANGUAGES } from "@core/i18n.js";
import { en, type MessageKey } from "@core/messages/en.js";
import { Button } from "../../components/ui/button";
import { Notice } from "../../components/ui/notice";
import { emptyRequest } from "../next-headers-fake";
import { ACCOUNT_DRAFT_COOKIE } from "../session";
import { alertTexts, attributesOf, blocksInsideParagraphs, findAll, inOrder, screenMarkup } from "../screen-test-helpers";
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
const BACK = "back here";
const ENTERED = { firstName: "Ada", lastName: "Lovelace", email: "ada@example", phone: "216-555-0100", language: "es" };

const FIELD_ERROR_KEYS = {
  firstName: "createAccount.error.firstName",
  lastName: "createAccount.error.lastName",
  email: "createAccount.error.email",
  phone: "createAccount.error.phone",
} as const satisfies Record<string, MessageKey>;
type Field = keyof typeof FIELD_ERROR_KEYS;
const FIELDS = Object.keys(FIELD_ERROR_KEYS) as Field[];

/** The field after each one, by its label's `for`: a field's error line sits between their labels. */
const NEXT_FIELD: Record<Field, string> = { firstName: "lastName", lastName: "email", email: "phone", phone: "language" };

/** Where `marker` first stands in the rendered markup; it must be there. */
const at = (html: string, marker: string): number => {
  const index = screenMarkup(html).indexOf(marker);
  expect(index, marker).toBeGreaterThan(-1);
  return index;
};

/** Each input's error line, by name: the ids in its aria-describedby, past its help line, that an element holds. */
const errorIds = (html: string): Record<string, string[]> => {
  const ids = new Set(attributesOf(html, "[a-z]+").map((attributes) => attributes.id));
  return Object.fromEntries(
    attributesOf(html, "input").map((input) => [
      input.name,
      (input["aria-describedby"] ?? "").split(/\s+/).filter((id) => id !== "" && !id.endsWith("-help") && ids.has(id)),
    ]),
  );
};
const withErrors = (html: string) => Object.entries(errorIds(html)).filter(([, ids]) => ids.length > 0).map(([name]) => name);

beforeEach(() => {
  request.current = emptyRequest();
});

const render = async (props: { limited?: string; error?: string; back?: boolean } = {}) => {
  const { back, ...rest } = props;
  const element = await AccountForm({
    action,
    signInHref: "/to-sign-in",
    ...rest,
    ...(back ? { back: createElement("p", null, BACK) } : {}),
  });
  return { element, html: renderToStaticMarkup(element) };
};

const inputNamed = (html: string, name: string) => attributesOf(html, "input").find((input) => input.name === name);
const selectedLanguages = (html: string) => attributesOf(html, "option").filter((option) => "selected" in option).map((option) => option.value);

describe("AccountForm", () => {
  it("AC7: its closing link goes to signInHref", async () => {
    expect(attributesOf((await render()).html, "a").map((link) => link.href)).toEqual(["/to-sign-in"]);
  });

  it("AC4, AC7: the closing line sits under the form, its link a quiet Button", async () => {
    const { element, html } = await render();
    expect(at(html, "</form>")).toBeLessThan(at(html, 'href="/to-sign-in"'));
    const link = findAll(element, Button).find((button) => button.props.href === "/to-sign-in");
    expect(link?.props).toMatchObject({ kind: "quiet" });
  });

  it("AC6: back sits above the heading, and the notices above back", async () => {
    const { element, html } = await render({ back: true, limited: "5", error: "expired" });
    expect(findAll(element, Notice).map((notice) => notice.props.icon)).toEqual(["lock", "clock"]);
    expect(screenMarkup(html).lastIndexOf('role="alert"')).toBeLessThan(at(html, BACK));
    expect(at(html, BACK)).toBeLessThan(at(html, "<h1"));
  });

  it("AC8: the form posts to the action it was given", async () => {
    expect(findAll((await render()).element, "form").map((form) => form.props.action)).toEqual([action]);
  });
});

describe("AC4 — the details form", () => {
  it("AC4: the form's fields are the AccountField names plus language, in form order", async () => {
    const { html } = await render();
    expect(attributesOf(html, "input").map((input) => input.name)).toEqual(["firstName", "lastName", "email", "phone"]);
    expect(attributesOf(html, "select").map((select) => select.name)).toEqual(["language"]);
  });

  it("AC4: each field's label is for its input, and the language select's for the select", async () => {
    const { html } = await render();
    const inputs = attributesOf(html, "input").map((input) => input.id);
    const select = attributesOf(html, "select").map((field) => field.id);
    expect(inputs).toHaveLength(4);
    expect(select).toHaveLength(1);
    expect(inputs.every(Boolean)).toBe(true);
    expect(attributesOf(html, "label").map((label) => label.for)).toEqual([...inputs, ...select]);
  });

  it("AC4: the language select offers every language, each named in itself", async () => {
    const { html } = await render();
    expect(attributesOf(html, "option").map((option) => option.value)).toEqual(Object.keys(LANGUAGES));
    const names = Object.values(LANGUAGES).map((language) => language.name);
    expect(inOrder(html, names)).toEqual(names);
  });

  it("AC4: the button is the form's one submit, a full-width primary Button", async () => {
    const submit = findAll((await render()).element, Button).filter((button) => button.props.type === "submit");
    expect(submit.map(({ props }) => [props.kind, props.full])).toEqual([["primary", true]]);
  });

  it.each([
    ["email", "email-help"],
    ["phone", "phone-help"],
  ])("AC4: the %s input is described by its help line", async (name, help) => {
    const { html } = await render();
    expect((inputNamed(html, name)?.["aria-describedby"] ?? "").split(/\s+/)).toContain(help);
  });

  it.each(FIELDS)("AC4: the %s input carries its field's maxLength", async (name) => {
    const { html } = await render();
    expect(inputNamed(html, name)?.maxlength).toBe(String(ACCOUNT_LIMITS[name]));
  });

  it("AC4: no line sits as a block inside a Field's <p>, with every error showing", async () => {
    const { html } = await render({ error: FIELDS.join(",") });
    expect(withErrors(html)).toEqual(FIELDS);
    expect(blocksInsideParagraphs(html)).toEqual([]);
  });
});

describe("AC4 — the field errors", () => {
  it.each(FIELDS)("AC4: error=%s shows its line under its field, and only that line", async (field) => {
    const { html } = await render({ error: field });
    expect(withErrors(html)).toEqual([field]);
    const [id] = errorIds(html)[field] ?? [];
    expect(at(html, `for="${field}"`)).toBeLessThan(at(html, `id="${id}"`));
    expect(at(html, `id="${id}"`)).toBeLessThan(at(html, `for="${NEXT_FIELD[field]}"`));
  });

  it.each(FIELDS)("AC4: the %s input is described by its error line", async (field) => {
    const { html } = await render({ error: field });
    const [id] = errorIds(html)[field] ?? [];
    expect(id, `no element holds ${field}'s error line`).toBeDefined();
    const line = new RegExp(`<(\\w+)\\b[^>]*\\bid="${id}"[^>]*>([\\s\\S]*?)</\\1>`).exec(screenMarkup(html))?.[2];
    expect(line).toBe(en[FIELD_ERROR_KEYS[field]]);
  });

  it("AC4: error=firstName,phone shows those two lines, in form order", async () => {
    const { html } = await render({ error: "firstName,phone" });
    expect(withErrors(html)).toEqual(["firstName", "phone"]);
  });

  it.each(["nonsense", "invalid", "Expired"])("AC4, AC10: error=%j names no field and is not expired: no line, no notice", async (error) => {
    const { html } = await render({ error });
    expect(withErrors(html)).toEqual([]);
    expect(alertTexts(html)).toEqual([]);
  });
});

describe("AC4 — the fields refill from the draft cookie only when error is present", () => {
  beforeEach(() => {
    request.current.cookies = { [ACCOUNT_DRAFT_COOKIE]: JSON.stringify(ENTERED) };
  });

  it("AC4: with error present every input refills, and the failing one too", async () => {
    const { html } = await render({ error: "email" });
    const refilled = Object.fromEntries(attributesOf(html, "input").map((input) => [input.name, input.value]));
    expect(refilled).toEqual({ firstName: "Ada", lastName: "Lovelace", email: "ada@example", phone: "(216) 555-0100" });
  });

  it("AC4: with error present the language select refills", async () => {
    expect(selectedLanguages((await render({ error: "email" })).html)).toEqual(["es"]);
  });

  it("AC4: with error=expired it refills too: error is present", async () => {
    expect(inputNamed((await render({ error: "expired" })).html, "firstName")?.value).toBe("Ada");
  });

  it("AC4: with no error the cookie is ignored", async () => {
    const { html } = await render();
    expect(attributesOf(html, "input")).toHaveLength(4);
    for (const input of attributesOf(html, "input")) expect(input.value ?? "").toBe("");
    expect(selectedLanguages(html)).not.toContain("es");
  });

  it("AC4: with an error and no cookie the form renders empty, the cookie having lapsed", async () => {
    request.current.cookies = {};
    const { html } = await render({ error: "firstName" });
    expect(attributesOf(html, "input")).toHaveLength(4);
    for (const input of attributesOf(html, "input")) expect(input.value ?? "").toBe("");
  });
});

// Issue 187: "Language for emails" starts from the browser's language, not the screen's, which is always
// English. Its cases are getEmailLanguageDefault's (app/language.test.ts); here one accepted and one
// refused case go through the form, and the refill after an error is seen to win over it.
describe("AC4 (issue 187) — the language select's starting option", () => {
  it("AC4: with an Accept-Language of es and no lang cookie, the select starts on Spanish", async () => {
    request.current.headers = { "accept-language": "es-MX,es;q=0.9" };
    expect(selectedLanguages((await render()).html)).toEqual(["es"]);
  });

  it("AC4: with a lang cookie of es and no Accept-Language, the select starts on English: the cookie has no effect", async () => {
    request.current.cookies = { lang: "es" };
    expect(selectedLanguages((await render()).html)).toEqual(["en"]);
  });
});

describe("AC5 (issue 187) — after a validation error the select keeps the chosen language", () => {
  it("AC5: with English chosen and an Accept-Language of es, the redisplayed select is on English", async () => {
    request.current.cookies = { [ACCOUNT_DRAFT_COOKIE]: JSON.stringify({ ...ENTERED, language: "en" }) };
    request.current.headers = { "accept-language": "es-MX,es;q=0.9" };
    expect(selectedLanguages((await render({ error: "email" })).html)).toEqual(["en"]);
  });
});

describe("AC10, AC12 — the notices", () => {
  const icons = (element: unknown) => findAll(element as never, Notice).map((notice) => notice.props.icon);

  it("AC10, AC12: with no notices it shows no alert", async () => {
    expect(alertTexts((await render()).html)).toEqual([]);
  });

  it("AC12: limited=30 shows the limited notice with that many minutes, a lock notice, above the heading", async () => {
    const { element, html } = await render({ limited: "30" });
    const alerts = alertTexts(html);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatch(/\b30\b/);
    expect(icons(element)).toEqual(["lock"]);
    expect(at(html, 'role="alert"')).toBeLessThan(at(html, "<h1"));
  });

  it("AC12: a limited value the rule refuses shows no notice", async () => {
    expect(alertTexts((await render({ limited: "61" })).html)).toEqual([]);
  });

  it("AC10: error=expired shows the expired notice, a clock notice, above the heading", async () => {
    const { element, html } = await render({ error: "expired" });
    expect(icons(element)).toEqual(["clock"]);
    expect(at(html, 'role="alert"')).toBeLessThan(at(html, "<h1"));
  });

  it("AC10, AC12: with both, the limited notice comes before the expired one", async () => {
    expect(icons((await render({ limited: "5", error: "expired" })).element)).toEqual(["lock", "clock"]);
  });
});
