// Issue 55, AC4, AC10 and AC12: /create-account, `await CreateAccount(props)` rendered through
// react-dom/server with `next/headers` faked. Wording and order come from the markup; the form's
// action from the element tree the page returns.
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyRequest } from "../next-headers-fake";
import { attributesOf, blocksInsideParagraphs, escapeRegExp, findAll, screenMarkup, textsOf } from "../screen-test-helpers";
import { requestAccountCode } from "./actions";
import CreateAccount from "./page";

const request = vi.hoisted(() => ({ current: { cookies: {}, headers: {}, sets: [] } as import("../next-headers-fake").RequestState }));

vi.mock("next/headers", async () => {
  const { fakeNextHeaders } = await import("../next-headers-fake");
  return {
    cookies: () => fakeNextHeaders(request.current).cookies(),
    headers: () => fakeNextHeaders(request.current).headers(),
  };
});
vi.mock("next/navigation", async () => ({ redirect: (await import("../screen-test-helpers")).throwingRedirect }));
vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("../services", () => ({
  getRepository: () => {
    throw new Error("/create-account has no reason to read the repository");
  },
  getEmail: () => {
    throw new Error("/create-account has no reason to send email");
  },
  getSessionSecret: () => "test-session-secret-that-is-long-enough-0123456789",
  getSiteUrl: () => "https://members.example.test",
}));

const DRAFT = "ocf_account_draft";
const ENTERED = { firstName: "Ada", lastName: "Lovelace", email: "ada@example", phone: "216-555-0100", language: "es" };

const EMAIL_HELP = "This is how you sign in: we email you a 6-digit code, no password.";
const PHONE_HELP = "So the farm can reach you.";
const QUIET = ["Already have an account?", "Sign in"];
const FORM = [
  "First name",
  "Last name",
  "Email",
  EMAIL_HELP,
  "Phone",
  PHONE_HELP,
  "Language for emails",
  "English",
  "Español",
  "Email me a code",
];
const LIMITED = (minutes: string) => `Too many sign-in requests from this network. Try again in ${minutes} min.`;
const EXPIRED = "That sign-in step expired. Enter your email to get a new code.";

const FIELD_ERRORS = {
  firstName: "Enter your first name.",
  lastName: "Enter your last name.",
  email: "Enter a full email address, like name@example.com.",
  phone: "Enter your phone number.",
} as const;
type Field = keyof typeof FIELD_ERRORS;

/** A field's label, and the next field's: its error line sits between them. */
const LABELS: Record<Field, [string, string]> = {
  firstName: ["First name", "Last name"],
  lastName: ["Last name", "Email"],
  email: ["Email", "Phone"],
  phone: ["Phone", "Language for emails"],
};

beforeEach(() => {
  request.current = emptyRequest();
});

async function render(searchParams: { limited?: string; error?: string } = {}) {
  const element = await CreateAccount({ searchParams: Promise.resolve(searchParams) });
  return { element, html: renderToStaticMarkup(element) };
}

const alerts = (html: string) => attributesOf(html, "p").filter((p) => p.role === "alert");
const inputNamed = (html: string, name: string) => attributesOf(html, "input").find((input) => input.name === name);

describe("AC4 — the details form", () => {
  it("AC4: it reads, in order, the heading, the fields with their help, the button and the quiet line", async () => {
    const { html } = await render();
    expect(textsOf(html)).toEqual(["Create your account", ...FORM, ...QUIET]);
  });

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
    expect(attributesOf(html, "option").map((option) => option.value)).toEqual(["en", "es"]);
  });

  it("AC4: the form's action is requestAccountCode", async () => {
    const { element, html } = await render();
    expect(textsOf(html)).toContain("Email me a code");
    expect(findAll(element, "form").map((form) => form.props.action)).toEqual([requestAccountCode]);
  });

  it('AC4: "Email me a code" is the submit, and "Sign in" a link to /sign-in', async () => {
    const { html } = await render();
    expect(attributesOf(html, "button")).toEqual([expect.objectContaining({ type: "submit" })]);
    expect(attributesOf(html, "a").map((link) => link.href)).toEqual(["/sign-in"]);
    expect(screenMarkup(html)).toMatch(/<a\b[^>]*>Sign in<\/a>/);
  });

  it.each([
    ["email", "email-help"],
    ["phone", "phone-help"],
  ])("AC4: the %s input is described by its help line", async (name, help) => {
    const { html } = await render();
    expect((inputNamed(html, name)?.["aria-describedby"] ?? "").split(/\s+/)).toContain(help);
  });

  it("AC4: no line sits as a block inside a Field's <p>, with every error showing", async () => {
    const { html } = await render({ error: "firstName,lastName,email,phone" });
    expect(textsOf(html)).toContain(FIELD_ERRORS.phone);
    expect(blocksInsideParagraphs(html)).toEqual([]);
  });
});

describe("AC4 — the field errors", () => {
  it.each(Object.entries(FIELD_ERRORS) as Array<[Field, string]>)("AC4: error=%s shows its line under its field, and only that line", async (field, line) => {
    const { html } = await render({ error: field });
    const texts = textsOf(html);
    const [label, next] = LABELS[field];
    expect(texts.filter((text) => (Object.values(FIELD_ERRORS) as string[]).includes(text))).toEqual([line]);
    expect(texts.indexOf(line)).toBeGreaterThan(texts.indexOf(label));
    expect(texts.indexOf(line)).toBeLessThan(texts.indexOf(next));
  });

  it.each(Object.entries(FIELD_ERRORS) as Array<[Field, string]>)("AC4: the %s input is described by its error line", async (field, line) => {
    const { html } = await render({ error: field });
    const id = new RegExp(`<\\w+\\b[^>]*\\bid="([^"]+)"[^>]*>${escapeRegExp(line)}</\\w+>`).exec(screenMarkup(html))?.[1];
    expect(id, `no element with an id holds "${line}"`).toBeDefined();
    expect((inputNamed(html, field)?.["aria-describedby"] ?? "").split(/\s+/)).toContain(id);
  });

  it("AC4: error=firstName,phone shows those two lines, in form order", async () => {
    const { html } = await render({ error: "firstName,phone" });
    expect(textsOf(html).filter((text) => (Object.values(FIELD_ERRORS) as string[]).includes(text))).toEqual([FIELD_ERRORS.firstName, FIELD_ERRORS.phone]);
  });

  it("AC4: an error naming no field shows no line and still the whole form", async () => {
    const { html } = await render({ error: "nonsense" });
    expect(textsOf(html)).toEqual(["Create your account", ...FORM, ...QUIET]);
  });
});

describe("AC4 — the fields refill from the draft cookie only when error is present", () => {
  beforeEach(() => {
    request.current.cookies = { [DRAFT]: JSON.stringify(ENTERED) };
  });

  it("AC4: with error present every input refills, and the failing one too", async () => {
    const { html } = await render({ error: "email" });
    const refilled = Object.fromEntries(attributesOf(html, "input").map((input) => [input.name, input.value]));
    expect(refilled).toEqual({ firstName: "Ada", lastName: "Lovelace", email: "ada@example", phone: "216-555-0100" });
  });

  it("AC4: with error present the language select refills", async () => {
    const { html } = await render({ error: "email" });
    expect(attributesOf(html, "option").filter((option) => "selected" in option).map((option) => option.value)).toEqual(["es"]);
  });

  it("AC4: with error=expired it refills too: error is present", async () => {
    const { html } = await render({ error: "expired" });
    expect(inputNamed(html, "firstName")?.value).toBe("Ada");
  });

  it("AC4: with no error the cookie is ignored", async () => {
    const { html } = await render();
    expect(textsOf(html)).toContain("First name");
    for (const input of attributesOf(html, "input")) expect(input.value ?? "").toBe("");
    expect(attributesOf(html, "option").filter((option) => "selected" in option).map((option) => option.value)).not.toContain("es");
  });

  it("AC4: with limited alone the cookie is ignored", async () => {
    const { html } = await render({ limited: "5" });
    expect(textsOf(html)).toContain("First name");
    for (const input of attributesOf(html, "input")) expect(input.value ?? "").toBe("");
  });

  it("AC4: with an error and no cookie the form renders empty, the cookie having lapsed", async () => {
    request.current.cookies = {};
    const { html } = await render({ error: "firstName" });
    expect(textsOf(html)).toContain(FIELD_ERRORS.firstName);
    for (const input of attributesOf(html, "input")) expect(input.value ?? "").toBe("");
  });
});

describe("AC10 — error=expired", () => {
  it("AC10: it shows signIn.stepExpired in a Notice, above the heading", async () => {
    const { html } = await render({ error: "expired" });
    expect(textsOf(html)).toEqual([EXPIRED, "Create your account", ...FORM, ...QUIET]);
    expect(alerts(html)).toHaveLength(1);
    expect(alerts(html)[0]?.class ?? "").toContain("notice");
  });
});

describe("AC12 — limited", () => {
  it.each(["1", "30", "60"])("AC12: limited=%s shows signIn.limited in a Notice, above the heading", async (minutes) => {
    const { html } = await render({ limited: minutes });
    expect(textsOf(html)).toEqual([LIMITED(minutes), "Create your account", ...FORM, ...QUIET]);
    expect(alerts(html)).toHaveLength(1);
  });

  it.each(["0", "61", "1.5", "-1", "abc", ""])("AC12: limited=%j, which sign-in's parse refuses, shows no notice", async (value) => {
    const { html } = await render({ limited: value });
    expect(textsOf(html)).toEqual(["Create your account", ...FORM, ...QUIET]);
  });
});
