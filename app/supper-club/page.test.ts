// Issue 55, AC1–AC3 and AC14: /supper-club, `await SupperClub(props)` rendered through react-dom/server
// with `next/headers` faked and the composition root handing out an InMemoryRepository. The left
// column's copy is AC15's, by hand; these read the pickers and section 3.
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryRepository } from "@core/adapters/in-memory-repository.js";
import type { ProductInput, ProductWithOptions } from "@core/products.js";
import { signSession } from "@core/sign-in/session.js";
import { emptyRequest } from "../next-headers-fake";
import { attributesOf, screenMarkup, textsOf, utilitiesOf } from "../screen-test-helpers";
import SupperClub from "./page";

const request = vi.hoisted(() => ({ current: { cookies: {}, headers: {}, sets: [] } as import("../next-headers-fake").RequestState }));
const services = vi.hoisted(() => ({
  repo: undefined as unknown as import("@core/adapters/in-memory-repository.js").InMemoryRepository,
  secret: "test-session-secret-that-is-long-enough-0123456789",
}));
vi.mock("next/headers", async () => {
  const { fakeNextHeaders } = await import("../next-headers-fake");
  return {
    cookies: () => fakeNextHeaders(request.current).cookies(),
    headers: () => fakeNextHeaders(request.current).headers(),
  };
});
vi.mock("next/navigation", async () => ({ redirect: (await import("../screen-test-helpers")).throwingRedirect }));
vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("../services", () => ({ getRepository: () => services.repo, getSessionSecret: () => services.secret }));

const SIZE = {
  name: "Size",
  position: 1,
  options: [
    { name: "2 person", priceCents: 5000, position: 1 },
    { name: "3–4 person", priceCents: 8000, position: 2 },
  ],
};
const PREFERENCE = {
  name: "Preference",
  position: 2,
  options: [
    { name: "Standard", priceCents: 0, position: 1 },
    { name: "Vegan", priceCents: 0, position: 2 },
  ],
};
const productOf = (optionTypes: ProductInput["optionTypes"]): ProductInput => ({
  name: "Supper Club",
  cap: 50,
  firstPickupDate: "2027-01-03",
  cutoffWeekday: 1,
  cutoffTime: "24:00:00",
  optionTypes,
});

let product: ProductWithOptions;

/** A fresh repository holding only this product. */
const stock = (optionTypes: ProductInput["optionTypes"]) => {
  services.repo = new InMemoryRepository();
  product = services.repo.addProduct(productOf(optionTypes));
};

// An id the product lacks reads as a string that matches nothing, so a test fails on what it asserts.
const typeId = (type: number) => product.optionTypes[type]?.id ?? "no such option type";
const optionId = (type: number, option: number) => product.optionTypes[type]?.options[option]?.id ?? "no such option";

beforeEach(() => {
  request.current = emptyRequest();
  stock([SIZE, PREFERENCE]);
});

const signIn = async (email = "ada@example.com") => {
  const member = await services.repo.createMember({ email });
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  request.current.cookies = { ocf_session: signSession({ subjectId: member.id, expiresAt }, services.secret) };
};

const render = async (query: Record<string, string | string[] | undefined> = {}) =>
  renderToStaticMarkup(await SupperClub({ searchParams: Promise.resolve(query) }));

const legendsOf = (html: string) => [...screenMarkup(html).matchAll(/<legend\b[^>]*>([^<]*)<\/legend>/g)].map((m) => m[1]);
const radiosOf = (html: string) => attributesOf(html, "input").filter((input) => input.type === "radio");
const checkedOf = (html: string) => radiosOf(html).filter((radio) => "checked" in radio).map((radio) => radio.value);

/** The words from the right card on, so the marketing column's copy stays AC15's. */
const joinCard = (html: string) => {
  const texts = textsOf(html);
  return texts.slice(texts.indexOf("Join the Supper Club"));
};

describe("AC1 — one picker per option type, in stored order", () => {
  it('AC1: each picker\'s legend is "{n}. {option type name}", n counting from 1 in stored order', async () => {
    expect(legendsOf(await render())).toEqual(["1. Size", "2. Preference"]);
  });

  it("AC1: order is position, then name", async () => {
    stock([
      { name: "Zebra", position: 1, options: [{ name: "One", priceCents: 0, position: 1 }] },
      { name: "Apple", position: 2, options: [{ name: "One", priceCents: 0, position: 1 }] },
      { name: "Mango", position: 1, options: [{ name: "One", priceCents: 0, position: 1 }] },
    ]);
    expect(legendsOf(await render())).toEqual(["1. Mango", "2. Zebra", "3. Apple"]);
  });

  it("AC1: an option type added in data adds a picker, with no code change", async () => {
    stock([SIZE, PREFERENCE, { name: "Spice", position: 3, options: [{ name: "Mild", priceCents: 0, position: 1 }] }]);
    const html = await render();
    expect(legendsOf(html)).toEqual(["1. Size", "2. Preference", "3. Spice"]);
    expect(textsOf(html)).toContain("Mild");
    expect(attributesOf(html, "fieldset").length).toBeGreaterThanOrEqual(3);
  });

  it('AC1: "Your account" is numbered one past the last type: 3. with two types', async () => {
    expect(joinCard(await render())).toContain("3. Your account");
  });

  it('AC1: "Your account" is numbered one past the last type: 4. with three types', async () => {
    stock([SIZE, PREFERENCE, { name: "Spice", position: 3, options: [{ name: "Mild", priceCents: 0, position: 1 }] }]);
    const card = joinCard(await render());
    expect(card).toContain("4. Your account");
    expect(card).not.toContain("3. Your account");
  });

  it('AC1: an option above $0 shows its name and "{price} a week", in whole dollars when it is whole', async () => {
    const card = joinCard(await render());
    expect(card.slice(card.indexOf("2 person"), card.indexOf("2 person") + 2)).toEqual(["2 person", "$50 a week"]);
    expect(card.slice(card.indexOf("3–4 person"), card.indexOf("3–4 person") + 2)).toEqual(["3–4 person", "$80 a week"]);
  });

  it("AC1: an option's cents are kept when it is not whole dollars", async () => {
    stock([{ name: "Size", position: 1, options: [{ name: "Small", priceCents: 1125, position: 1 }] }]);
    expect(joinCard(await render())).toContain("$11.25 a week");
  });

  it("AC1: an option priced $0 shows its name and no price", async () => {
    const card = joinCard(await render());
    expect(card.slice(card.indexOf("Standard"), card.indexOf("Standard") + 2)).toEqual(["Standard", "Vegan"]);
    expect(card.join(" ")).not.toContain("$0");
  });
});

describe("AC2 — signed out, the pickers and both buttons are one GET form", () => {
  it("AC2: the page holds one form, method get, to /supper-club/continue", async () => {
    expect(attributesOf(await render(), "form")).toEqual([expect.objectContaining({ method: "get", action: "/supper-club/continue" })]);
  });

  it("AC2: each option is a radio named for its option type's id, valued with its own id", async () => {
    expect(radiosOf(await render()).map(({ name, value }) => ({ name, value }))).toEqual([
      { name: typeId(0), value: optionId(0, 0) },
      { name: typeId(0), value: optionId(0, 1) },
      { name: typeId(1), value: optionId(1, 0) },
      { name: typeId(1), value: optionId(1, 1) },
    ]);
  });

  it("AC2: the right card reads, in order, its title, the pickers, the help line, section 3 and the two buttons", async () => {
    expect(joinCard(await render())).toEqual([
      "Join the Supper Club",
      "1. Size",
      "2 person",
      "$50 a week",
      "3–4 person",
      "$80 a week",
      "2. Preference",
      "Standard",
      "Vegan",
      "You can switch size or menu any week before the cutoff.",
      "3. Your account",
      "Sign in or create an account to join.",
      "Create an account",
      "Sign in",
    ]);
  });

  it('AC2: the buttons are submits named next, valued create-account and sign-in, "Create an account" primary and "Sign in" secondary', async () => {
    const buttons = attributesOf(await render(), "button");
    expect(buttons.map(({ type, name, value }) => ({ type, name, value }))).toEqual([
      { type: "submit", name: "next", value: "create-account" },
      { type: "submit", name: "next", value: "sign-in" },
    ]);
    expect(utilitiesOf(buttons[0]?.class)).toContain("btn-primary");
    expect(utilitiesOf(buttons[1]?.class)).toContain("btn-secondary");
  });

  it("AC2: the pickers and both buttons sit inside the form", async () => {
    expect(screenMarkup(await render())).toMatch(/<form\b[\s\S]*type="radio"[\s\S]*Create an account[\s\S]*Sign in<\/button>[\s\S]*<\/form>/);
  });

  it("AC2: a return path's choices are picked when the page loads", async () => {
    const html = await render({ [typeId(0)]: optionId(0, 1), [typeId(1)]: optionId(1, 1) });
    expect(checkedOf(html)).toEqual([optionId(0, 1), optionId(1, 1)]);
  });
});

describe("AC3 — signed in", () => {
  beforeEach(async () => {
    await signIn();
  });

  it('AC3: section 3 reads "Signed in as {email}." with its period, then "Continue to payment"', async () => {
    const card = joinCard(await render());
    expect(card.slice(card.indexOf("3. Your account"))).toEqual(["3. Your account", "Signed in as ada@example.com.", "Continue to payment"]);
  });

  it('AC3: "Continue to payment" is the one button: primary, type="button", with no name, value or form action', async () => {
    const buttons = attributesOf(await render(), "button");
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toMatchObject({ type: "button" });
    expect(utilitiesOf(buttons[0]?.class)).toContain("btn-primary");
    for (const absent of ["name", "value", "formaction", "href"]) expect(buttons[0]).not.toHaveProperty(absent);
  });

  it('AC3: it is a button and no link', async () => {
    const html = await render();
    expect(textsOf(html)).toContain("Continue to payment");
    expect(attributesOf(html, "a").filter((link) => link.href?.includes("payment"))).toEqual([]);
    expect(screenMarkup(html)).toMatch(/<button\b[^>]*>Continue to payment<\/button>/);
  });

  it("AC3: the pickers stay, in the AC2 form, with the button inside it", async () => {
    const html = await render();
    expect(legendsOf(html)).toEqual(["1. Size", "2. Preference"]);
    expect(attributesOf(html, "form")).toEqual([expect.objectContaining({ method: "get", action: "/supper-club/continue" })]);
    expect(screenMarkup(html)).toMatch(/<form\b[\s\S]*Continue to payment[\s\S]*<\/form>/);
  });
});

describe("AC14 — a choice that is missing or not an option", () => {
  it("AC14: with no query each picker has its first option checked", async () => {
    expect(checkedOf(await render())).toEqual([optionId(0, 0), optionId(1, 0)]);
  });

  it("AC14: a choice that is not one of the type's options leaves the first checked, and the other type's choice stands", async () => {
    const html = await render({ [typeId(0)]: "not-an-option", [typeId(1)]: optionId(1, 1) });
    expect(checkedOf(html)).toEqual([optionId(0, 0), optionId(1, 1)]);
  });

  it("AC14: the first option is by position, then name", async () => {
    stock([
      {
        name: "Size",
        position: 1,
        options: [
          { name: "Large", priceCents: 0, position: 2 },
          { name: "Medium", priceCents: 0, position: 1 },
          { name: "Bigger", priceCents: 0, position: 1 },
        ],
      },
    ]);
    expect(checkedOf(await render())).toEqual([optionId(0, 0)]);
    expect(textsOf(await render()).filter((text) => ["Large", "Medium", "Bigger"].includes(text))).toEqual(["Bigger", "Medium", "Large"]);
  });

  it("AC14: of an array value the first entry is what counts", async () => {
    expect(checkedOf(await render({ [typeId(0)]: [optionId(0, 1), optionId(0, 0)] }))).toEqual([optionId(0, 1), optionId(1, 0)]);
  });
});
