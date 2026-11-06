// Issue 55, AC1–AC3 and AC14: /supper-club, `await SupperClub(props)` rendered through react-dom/server
// with `next/headers` faked and the composition root handing out an InMemoryRepository. The left
// column's copy is AC15's, by hand; these read the pickers and section 3. Issue 77: the page calls
// JoinPage, which adds the header and its language switch, so the form, legend and button helpers here
// read the Join card's and leave the switch's out. Issue 56: section 4, the retry state and the redirect
// of a member who already has a box. A changed pick updating the words is a browser's, in
// e2e/supper-club.spec.ts; these read what the server renders first.
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryRepository } from "@core/adapters/in-memory-repository.js";
import { en } from "@core/messages/en.js";
import type { PendingSignupInput } from "@core/ports/repository.js";
import type { ProductInput, ProductWithOptions } from "@core/products.js";
import { signSession } from "@core/sign-in/session.js";
import { emptyRequest } from "../next-headers-fake";
import { attributesOf, findAll, redirectOf, screenMarkup, textsOf, utilitiesOf } from "../screen-test-helpers";
import { Card } from "../../components/ui/card";
import { Shell } from "../../components/ui/shell";
import SupperClub from "./page";

const request = vi.hoisted(() => ({ current: { cookies: {}, headers: {}, sets: [] } as import("../next-headers-fake").RequestState }));
const services = vi.hoisted(() => ({
  repo: undefined as unknown as import("@core/adapters/in-memory-repository.js").InMemoryRepository,
  secret: "test-session-secret-that-is-long-enough-0123456789",
  farmEmail: undefined as string | undefined,
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
vi.mock("../services", () => ({
  getRepository: () => services.repo,
  getSessionSecret: () => services.secret,
  isProduction: () => process.env.NODE_ENV === "production",
  getFarmContactEmail: () => services.farmEmail,
}));
// A plain function renders as a form with no action or method; what Next gives a server action renders
// them, so a test can read which action a form posts to.
vi.mock("./actions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./actions")>()),
  retrySupperClubPayment: Object.assign(async () => {}, {
    $$FORM_ACTION: () => ({ action: "/test/retry", method: "POST", encType: null, name: null, target: null, data: null }),
  }),
}));

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
  await services.repo.confirmMemberEmail(member.id, new Date());
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  request.current.cookies = { ocf_session: signSession({ subjectId: member.id, expiresAt }, services.secret) };
  return member;
};

const render = async (query: Record<string, string | string[] | undefined> = {}) =>
  renderToStaticMarkup(await SupperClub({ searchParams: Promise.resolve(query) }));

const legendsOf = (html: string) =>
  [...screenMarkup(html).matchAll(/<legend\b[^>]*>([^<]*)<\/legend>/g)].map((m) => m[1]).filter((legend) => legend !== "Language");
const joinForms = (html: string) => attributesOf(html, "form").filter((form) => form.method === "get");
const joinButtons = (html: string) => attributesOf(html, "button").filter((button) => button.name !== "language");
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
    expect(joinForms(await render())).toEqual([expect.objectContaining({ method: "get", action: "/supper-club/continue" })]);
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
    const buttons = joinButtons(await render());
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

  it('AC3: section 3 reads "Signed in as {email}." with its period, then section 4', async () => {
    const card = joinCard(await render());
    expect(card.slice(card.indexOf("3. Your account"), card.indexOf("3. Your account") + 3)).toEqual([
      "3. Your account",
      "Signed in as ada@example.com.",
      "4. Payment",
    ]);
  });

  it("AC3: the pickers stay, in the AC2 form", async () => {
    const html = await render();
    expect(legendsOf(html)).toEqual(["1. Size", "2. Preference"]);
    expect(joinForms(html)).toEqual([expect.objectContaining({ method: "get", action: "/supper-club" })]);
  });
});

describe("AC3 — the form's target follows the session", () => {
  it('AC3: signed out the form stays method="get" to /supper-club/continue; signed in it is method="get" to /supper-club', async () => {
    expect(joinForms(await render())).toEqual([expect.objectContaining({ method: "get", action: "/supper-club/continue" })]);
    await signIn();
    expect(joinForms(await render())).toEqual([expect.objectContaining({ method: "get", action: "/supper-club" })]);
  });
});

// Friday 2026-11-06, 10:00 in Cleveland: before the first cutoff, whenever this suite runs.
const SIGNUP_DAY = new Date("2026-11-06T15:00:00.000Z");

describe("issue 56 — the payment section", () => {
  const TODAY = "Today, for your first week";
  const WEEKLY = "Then every week, at the cutoff";
  const DECLINED = "Your card was declined. Nothing was charged. Check the card details or try another card.";
  const ERROR = "Something went wrong and nothing was charged. Try again.";
  const CHECK_THE_BOX = "Check the box to agree to the weekly charge.";
  const RETRY_NOTICE = "We couldn't confirm your payment. Try again and you won't be charged twice.";

  const sentence = (price: string) => `I agree to a weekly charge of ${price} until I cancel, and to the Terms and Privacy Policy.`;
  const pickupLine = (date: string, price: string) =>
    `First pickup: ${date}. After that, your card is charged ${price} at the end of each Monday for the following week's pickup, until you cancel.`;

  /** The words from section 4 on. */
  const section4 = (html: string) => {
    const card = joinCard(html);
    return card.slice(Math.max(card.indexOf("4. Payment"), 0));
  };

  const hidden = (html: string) => attributesOf(html, "input").filter((input) => input.type === "hidden");
  const checkbox = (html: string) => attributesOf(html, "input").filter((input) => input.type === "checkbox");
  const formsHolding = (html: string, words: string) => [...screenMarkup(html).matchAll(/<form\b[\s\S]*?<\/form>/g)].map((form) => form[0]).filter((form) => form.includes(words));
  const buttonNamed = (html: string, name: string) => new RegExp(`<button\\b([^>]*)>\\s*${name}\\s*</button>`).exec(screenMarkup(html))?.[1] ?? "";

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"], now: SIGNUP_DAY });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  describe("AC1 — what a signed-in member sees", () => {
    beforeEach(async () => {
      await signIn();
    });

    it("AC1: section 4 reads, in order, the card field, the price panel, the checkbox, the button and the hint", async () => {
      expect(section4(await render())).toEqual([
        "4. Payment",
        "Card",
        "Secure card entry by Square. Your card is saved for the weekly charge.",
        TODAY,
        "$50",
        WEEKLY,
        "$50",
        pickupLine("Sunday, January 3", "$50"),
        sentence("$50"),
        "Join and pay $50",
        "Limited to 50 subscriptions. No sales tax.",
      ]);
    });

    it("AC1: its number is one past Your account's", async () => {
      stock([SIZE, PREFERENCE, { name: "Spice", position: 3, options: [{ name: "Mild", priceCents: 0, position: 1 }] }]);
      await signIn();
      expect(joinCard(await render())).toContain("5. Payment");
    });

    it("AC1: the hint names the product's cap", async () => {
      services.repo = new InMemoryRepository();
      services.repo.addProduct({ ...productOf([SIZE, PREFERENCE]), cap: 30 });
      await signIn();
      expect(section4(await render())).toContain("Limited to 30 subscriptions. No sales tax.");
    });

    it('AC1: the inert "Continue to payment" is gone', async () => {
      const html = await render();
      expect(joinCard(html)).toContain("4. Payment");
      expect(joinCard(html)).not.toContain("Continue to payment");
    });

    it("AC1: the consent checkbox is named consent, and unticked", async () => {
      const boxes = checkbox(await render());
      expect(boxes).toHaveLength(1);
      expect(boxes[0]?.name).toBe("consent");
      expect(boxes[0]).not.toHaveProperty("checked");
    });

    it("AC1: the checkbox's sentence is its label", async () => {
      expect(screenMarkup(await render())).toMatch(/<label\b[^>]*>(?:(?!<\/label>)[\s\S])*I agree to a weekly charge of \$50/);
    });

    it("AC1: the card entry is drawn as a field", async () => {
      expect(screenMarkup(await render())).toMatch(/<\w+\b[^>]*class="(?:[^"]*\s)?field(?:\s[^"]*)?"/);
    });

    it("AC1: the price panel is the grey one, with no title", async () => {
      const markup = screenMarkup(await render());
      expect(markup).toMatch(new RegExp(`class="[^"]*(?<![\\w-])bg-surface-alt(?![\\w-])[^"]*"[^>]*>\\s*(<[^>]*>\\s*)*${TODAY}`));
    });

    it('AC1: "Join and pay" is the primary button', async () => {
      expect(utilitiesOf(/class="([^"]*)"/.exec(buttonNamed(await render(), "Join and pay \\$50"))?.[1])).toContain("btn-primary");
    });

    it("AC1: pay is its own form after the pickers' GET form, so Enter on a radio can never pay", async () => {
      const html = await render();
      const [pay, ...others] = formsHolding(html, "Join and pay");
      expect(others).toEqual([]);
      expect(pay).toBeDefined();
      expect(pay).not.toMatch(/<form\b[^>]*method="get"/);
      expect(pay).not.toContain('type="radio"');
      const [pickers] = formsHolding(html, 'type="radio"');
      expect(pickers).not.toContain("Join and pay");
      const markup = screenMarkup(html);
      expect(markup.indexOf(pickers ?? "no form")).toBeLessThan(markup.indexOf(pay ?? ""));
    });

    it("AC1: the pay form carries the picks in hidden fields named by option type id", async () => {
      const html = await render({ [typeId(0)]: optionId(0, 1), [typeId(1)]: optionId(1, 1) });
      const fields = hidden(formsHolding(html, "Join and pay")[0] ?? "").filter((input) => input.name === typeId(0) || input.name === typeId(1));
      expect(fields.map(({ name, value }) => ({ name, value }))).toEqual([
        { name: typeId(0), value: optionId(0, 1) },
        { name: typeId(1), value: optionId(1, 1) },
      ]);
    });
  });

  it("AC1: a signed-out visitor does not see it, which guards the signed-in section above", async () => {
    const html = await render();
    expect(joinCard(html)).not.toContain("4. Payment");
    expect(joinCard(html).join(" ")).not.toContain("Join and pay");
    expect(checkbox(html)).toEqual([]);
  });

  describe("AC2 — the price follows the pick", () => {
    it("AC2: the panel, the sentence and the button all carry the sum of the picks in the query", async () => {
      await signIn();
      expect(section4(await render({ [typeId(0)]: optionId(0, 1) }))).toEqual(expect.arrayContaining([pickupLine("Sunday, January 3", "$80"), sentence("$80"), "Join and pay $80"]));
    });

    it("AC2: a price with cents keeps them", async () => {
      stock([{ name: "Size", position: 1, options: [{ name: "Small", priceCents: 1125, position: 1 }] }]);
      await signIn();
      expect(section4(await render())).toEqual(expect.arrayContaining([sentence("$11.25"), "Join and pay $11.25"]));
    });
  });

  describe("AC3 — the first pickup on the page", () => {
    it("AC3: at 23:59 on Monday 2026-12-28, Cleveland time, the panel says January 3", async () => {
      vi.setSystemTime(new Date("2026-12-29T04:59:00.000Z"));
      await signIn();
      expect(section4(await render())).toContain(pickupLine("Sunday, January 3", "$50"));
    });

    it("AC3: a minute later it says January 10", async () => {
      vi.setSystemTime(new Date("2026-12-29T05:00:00.000Z"));
      await signIn();
      expect(section4(await render())).toContain(pickupLine("Sunday, January 10", "$50"));
    });
  });

  describe("AC4, AC9, AC10a — what a failed pay shows", () => {
    beforeEach(async () => {
      await signIn();
    });

    it("AC4: ?payError=consent shows the field error after the checkbox, before the button", async () => {
      const words = section4(await render({ payError: "consent" }));
      expect(words.indexOf(CHECK_THE_BOX)).toBeGreaterThan(words.indexOf(sentence("$50")));
      expect(words.indexOf(CHECK_THE_BOX)).toBeLessThan(words.indexOf("Join and pay $50"));
      expect(words.indexOf(sentence("$50"))).toBeGreaterThan(-1);
    });

    it("AC9: ?payError=declined shows the notice above the button, and the picks stay", async () => {
      const html = await render({ payError: "declined", [typeId(0)]: optionId(0, 1) });
      const words = section4(html);
      expect(words.indexOf(DECLINED)).toBeGreaterThan(words.indexOf(sentence("$80")));
      expect(words.indexOf(DECLINED)).toBeLessThan(words.indexOf("Join and pay $80"));
      expect(checkedOf(html)).toEqual([optionId(0, 1), optionId(1, 0)]);
    });

    it("AC9: the notice has the alert icon", async () => {
      const html = await render({ payError: "declined" });
      expect(attributesOf(html, "p").find((p) => p.role === "alert")?.class).toContain("notice-alert");
    });

    it("AC10a: ?payError=error shows its notice above the button, on the normal form", async () => {
      const words = section4(await render({ payError: "error" }));
      expect(words.indexOf(ERROR)).toBeGreaterThan(words.indexOf(sentence("$50")));
      expect(words.indexOf(ERROR)).toBeLessThan(words.indexOf("Join and pay $50"));
    });

    it("AC4: with no payError it shows none of them, which guards the three above", async () => {
      const words = section4(await render());
      expect(words).toContain("4. Payment");
      for (const notice of [CHECK_THE_BOX, DECLINED, ERROR]) expect(words).not.toContain(notice);
    });
  });

  describe("AC5 — a member who already has a box", () => {
    const paidUp = async () => {
      const member = await signIn();
      const [size, menu] = product.optionTypes;
      const { ledgerId, amountCents } = await services.repo.savePendingSignup({
        memberId: member.id,
        productId: product.id,
        choices: { [size?.id ?? ""]: size?.options[0]?.id ?? "", [menu?.id ?? ""]: menu?.options[0]?.id ?? "" },
        firstChargeCents: 5000,
        weeklyCents: 5000,
        pickupDate: "2027-01-03",
        consentText: "I agree.",
        consentAt: SIGNUP_DAY,
      });
      await services.repo.confirmSignupRows(ledgerId, "PAYMENT_1", amountCents, SIGNUP_DAY);
    };

    it("AC5: opening the page redirects to /supper-club/already", async () => {
      await paidUp();
      expect(await redirectOf(SupperClub({ searchParams: Promise.resolve({}) }))).toBe("/supper-club/already");
    });

    it("AC5: straight after a code, with picks in the query, the picks are discarded", async () => {
      await paidUp();
      const query = { [typeId(0)]: optionId(0, 1) };
      expect(await redirectOf(SupperClub({ searchParams: Promise.resolve(query) }))).toBe("/supper-club/already");
    });

    it("AC5: viewing writes no event", async () => {
      await paidUp();
      expect(await redirectOf(SupperClub({ searchParams: Promise.resolve({}) }))).toBe("/supper-club/already");
      expect(services.repo.events()).toEqual([]);
    });
  });

  describe("AC10 — the retry state", () => {
    /** A signup that charged and heard nothing: the ledger row pending, the card stored. */
    const stranded = async (over: { card?: boolean; declined?: boolean } = {}) => {
      const member = await signIn();
      const choices = { [typeId(0)]: optionId(0, 1), [typeId(1)]: optionId(1, 1) };
      const signup = await services.repo.savePendingSignup({
        memberId: member.id,
        productId: product.id,
        choices,
        firstChargeCents: 8000,
        weeklyCents: 8000,
        pickupDate: "2027-01-03",
        consentText: "I agree.",
        consentAt: SIGNUP_DAY,
      });
      if (over.card !== false) await services.repo.saveSubscriptionCard(signup.subscriptionId, "ccof:card-1");
      if (over.declined) await services.repo.recordSignupDecline(signup.ledgerId);
    };

    /** The words after "Signed in as…": the part the retry state replaces. */
    const afterAccount = (html: string) => {
      const words = textsOf(html);
      return words.slice(words.indexOf("Signed in as ada@example.com.") + 1);
    };

    it("AC10: a pending row with a card shows the notice, the box and amount from the row, and Try again, in order, with no query", async () => {
      await stranded();
      const words = afterAccount(await render());
      expect(words[0]).toBe(RETRY_NOTICE);
      const joined = words.join(" ");
      expect(joined.indexOf("3–4 person")).toBeGreaterThan(-1);
      expect(joined.indexOf("Vegan")).toBeGreaterThan(-1);
      expect(words.indexOf(TODAY)).toBeGreaterThan(0);
      expect(words[words.indexOf(TODAY) + 1]).toBe("$80");
      expect(words.at(-1)).toBe("Try again");
    });

    it("AC10: it replaces the pickers and the payment section: no card form, picks or checkbox", async () => {
      await stranded();
      const html = await render();
      expect(textsOf(html)).toContain(RETRY_NOTICE);
      expect(radiosOf(html)).toEqual([]);
      expect(checkbox(html)).toEqual([]);
      expect(textsOf(html)).not.toContain("4. Payment");
      expect(textsOf(html)).not.toContain("Card");
      expect(textsOf(html).join(" ")).not.toContain("Join and pay");
    });

    it('AC10: when "Try again" comes back error, the error notice shows above the price panel, and only then', async () => {
      await stranded();
      const html = await render({ payError: "error" });
      const words = afterAccount(html);
      expect(words).toContain(ERROR);
      expect(words.indexOf(ERROR)).toBeLessThan(words.findIndex((word) => word.includes("3–4 person")));
      expect(attributesOf(html, "p").filter((p) => p.role === "alert" && p.class?.includes("notice-alert"))).toHaveLength(2);
      expect(afterAccount(await render())).not.toContain(ERROR);
    });

    it("AC10: it shows when they come back later with other picks in the query: the row decides, not the URL", async () => {
      await stranded();
      const words = afterAccount(await render({ [typeId(0)]: optionId(0, 0) }));
      expect(words[0]).toBe(RETRY_NOTICE);
      expect(words[words.indexOf(TODAY) + 1]).toBe("$80");
    });

    it('AC10: "Try again" is the primary button of a form posting to retrySupperClubPayment', async () => {
      await stranded();
      const html = await render();
      expect(utilitiesOf(/class="([^"]*)"/.exec(buttonNamed(html, "Try again"))?.[1])).toContain("btn-primary");
      const [form] = formsHolding(html, "Try again");
      expect(attributesOf(form ?? "", "form")[0]).toMatchObject({ action: "/test/retry", method: "POST" });
    });

    it("AC10: ?payError=unknown with no pending row is the normal form: the URL alone shows nothing", async () => {
      await signIn();
      const words = section4(await render({ payError: "unknown" }));
      expect(words).toContain("4. Payment");
      expect(words).not.toContain(RETRY_NOTICE);
    });

    it("AC10: a pending row with no card is the normal form, so a failed saveCard never shows the retry state", async () => {
      await stranded({ card: false });
      const words = textsOf(await render());
      expect(words).toContain("4. Payment");
      expect(words).not.toContain(RETRY_NOTICE);
    });

    it("AC10: a declined row is the normal form, even with its card still stored", async () => {
      await stranded({ declined: true });
      const words = textsOf(await render());
      expect(words).toContain("4. Payment");
      expect(words).not.toContain(RETRY_NOTICE);
    });
  });

  describe("AC1 — CardEntry's test field, for e2e", () => {
    const textInputs = (html: string) => attributesOf(html, "input").filter((input) => input.type === "text" || input.type === undefined);

    it('AC1: on the e2e server it renders a text input named "Test card"', async () => {
      vi.stubEnv("E2E", "1");
      await signIn();
      const html = await render();
      expect(textInputs(html)).toHaveLength(1);
      expect(html).toContain("Test card");
    });

    it("AC1: anywhere else it does not, which guards the e2e field above", async () => {
      vi.stubEnv("E2E", "");
      await signIn();
      const html = await render();
      expect(joinCard(html)).toContain("4. Payment");
      expect(html).not.toContain("Test card");
    });

    it("AC1: in production it does not, even with E2E set", async () => {
      vi.stubEnv("E2E", "1");
      vi.stubEnv("NODE_ENV", "production");
      await signIn();
      const html = await render();
      expect(joinCard(html)).toContain("4. Payment");
      expect(html).not.toContain("Test card");
    });
  });
});

describe("issue 57 — the sold-out card", () => {
  const NOTICE = "The Supper Club sold out before your payment went through. Nothing was charged.";
  const TITLE = "The Supper Club is sold out";
  const BODY = "All the subscriptions are taken right now. A subscription will open when a member cancels, so check back.";
  const BACK = "Back to ohiocityfarm.com";
  const FARM_EMAIL = "farm@ohiocityfarm.com";
  const QUESTIONS = `Questions? Email the farm at ${FARM_EMAIL}.`;
  const JOIN_TITLE = "Join the Supper Club";
  const TRY_AGAIN = "Try again";
  const RETRY_NOTICE = "We couldn't confirm your payment. Try again and you won't be charged twice.";
  const DAY = new Date("2026-11-06T15:00:00.000Z");

  /** A fresh repository holding only this product, at `cap`. */
  const stockAt = (cap: number) => {
    services.repo = new InMemoryRepository();
    product = services.repo.addProduct({ ...productOf([SIZE, PREFERENCE]), cap });
  };

  const rowsFor = (memberId: string): PendingSignupInput => ({
    memberId,
    productId: product.id,
    choices: { [typeId(0)]: optionId(0, 1), [typeId(1)]: optionId(1, 0) },
    firstChargeCents: 8000,
    weeklyCents: 8000,
    pickupDate: "2027-01-03",
    consentText: "I agree.",
    consentAt: DAY,
  });

  /** A member's rows with a card on them and the charge unanswered: a held spot, and for that member the retry state. */
  const holdASpot = async (memberId: string) => {
    const row = await services.repo.savePendingSignup(rowsFor(memberId));
    await services.repo.saveSubscriptionCard(row.subscriptionId, `ccof:${memberId}`);
    return row;
  };

  /** The Supper Club at a cap of one, with another member holding that spot. */
  const soldOut = async () => {
    stockAt(1);
    await holdASpot((await services.repo.createMember({ email: "grace@example.com" })).id);
  };

  /** The sold-out card's words, the notice with them when it shows; nothing when the card does not. */
  const cardWords = (html: string) => {
    const words = textsOf(html);
    const title = words.indexOf(TITLE);
    if (title === -1) return [];
    return words.slice(words[title - 1] === NOTICE ? title - 1 : title);
  };

  beforeEach(() => {
    services.farmEmail = undefined;
  });

  describe("AC3 — at the cap the card stands in place of the form", () => {
    it("AC3 (issue 57): a visitor sees the card, and no form, picker or Join card", async () => {
      await soldOut();
      const html = await render();
      expect(cardWords(html)).toEqual([TITLE, BODY, BACK]);
      expect(joinForms(html)).toEqual([]);
      expect(radiosOf(html)).toEqual([]);
      expect(textsOf(html)).not.toContain(JOIN_TITLE);
    });

    it("AC3 (issue 57): a signed-in member who holds no spot sees the card, and no payment section", async () => {
      await soldOut();
      await signIn();
      const html = await render();
      expect(cardWords(html)).toEqual([TITLE, BODY, BACK]);
      expect(textsOf(html)).not.toContain(JOIN_TITLE);
      expect(textsOf(html).join(" ")).not.toContain("Join and pay");
    });

    it.each([
      ["with no card", false],
      ["declined", true],
    ])("AC3 (issue 57): a member whose own pending row is %s holds no spot, and sees the card", async (_what, declined) => {
      await soldOut();
      const member = await signIn();
      const row = await services.repo.savePendingSignup(rowsFor(member.id));
      if (declined) await services.repo.recordSignupDecline(row.ledgerId);
      expect(cardWords(await render())).toEqual([TITLE, BODY, BACK]);
    });

    it("AC3 (issue 57): the card is a Card that fills the right column, on the page's shell, the farm's copy before it", async () => {
      await soldOut();
      const element = await SupperClub({ searchParams: Promise.resolve({}) });
      const html = renderToStaticMarkup(element);
      expect(findAll(element, Shell).map((shell) => shell.props.width)).toEqual(["page"]);
      expect(screenMarkup(html)).toMatch(new RegExp(`<section class="card-fill">(?:(?!</section>)[\\s\\S])*${TITLE}`));
      const words = textsOf(html);
      expect(words.indexOf(TITLE)).toBeGreaterThan(words.indexOf("Weekly meals from the farm kitchen"));
    });

    it("AC3 (issue 57): the header's Sign in stays, so a member with a stranded payment can reach Try again", async () => {
      await soldOut();
      const html = await render();
      expect(cardWords(html)).toContain(TITLE);
      expect(screenMarkup(html)).toMatch(/<header\b[\s\S]*<a\b[^>]*href="\/supper-club\/sign-in"[^>]*>Sign in<\/a>[\s\S]*<\/header>/);
    });

    it("AC3 (issue 57): one spot short of the cap the form stands, which guards the card above", async () => {
      stockAt(2);
      await holdASpot((await services.repo.createMember({ email: "grace@example.com" })).id);
      const html = await render();
      expect(textsOf(html)).toContain(JOIN_TITLE);
      expect(cardWords(html)).toEqual([]);
    });
  });

  describe("AC4 — a member the cap does not stop", () => {
    it("AC4 (issue 57): a member with an active subscription still goes to the already page at the cap", async () => {
      stockAt(1);
      const member = await signIn();
      const { ledgerId, amountCents } = await services.repo.savePendingSignup(rowsFor(member.id));
      await services.repo.confirmSignupRows(ledgerId, "PAYMENT_1", amountCents, DAY);
      expect(await redirectOf(SupperClub({ searchParams: Promise.resolve({}) }))).toBe("/supper-club/already");
    });

    it('AC4 (issue 57): a member with a stranded payment still sees "Try again" at the cap, and no sold-out card', async () => {
      stockAt(1);
      await holdASpot((await signIn()).id);
      const html = await render();
      expect(textsOf(html)).toEqual(expect.arrayContaining([RETRY_NOTICE, TRY_AGAIN]));
      expect(cardWords(html)).toEqual([]);
    });
  });

  describe("AC5 — the state comes from the count, never the URL", () => {
    it("AC5 (issue 57): payError=soldout with spots open is the normal form for a visitor, with no notice", async () => {
      const html = await render({ payError: "soldout" });
      expect(textsOf(html)).toContain(JOIN_TITLE);
      expect(textsOf(html)).not.toContain(NOTICE);
      expect(cardWords(html)).toEqual([]);
    });

    it("AC5 (issue 57): payError=soldout with spots open is the normal form for a member, with no notice", async () => {
      await signIn();
      const words = textsOf(await render({ payError: "soldout" }));
      expect(words).toContain("4. Payment");
      expect(words).not.toContain(NOTICE);
      expect(words).not.toContain(TITLE);
    });

    it('AC5 (issue 57): payError=soldout on a stranded payment is "Try again", with no notice', async () => {
      stockAt(1);
      await holdASpot((await signIn()).id);
      const words = textsOf(await render({ payError: "soldout" }));
      expect(words).toContain(TRY_AGAIN);
      expect(words).not.toContain(NOTICE);
    });
  });

  describe("AC9, AC15 — the notice", () => {
    it("AC9, AC15 (issue 57): payError=soldout at the cap puts the notice first on the card, with the alert icon", async () => {
      await soldOut();
      await signIn();
      const html = await render({ payError: "soldout" });
      expect(cardWords(html)).toEqual([NOTICE, TITLE, BODY, BACK]);
      expect(attributesOf(html, "p").find((p) => p.role === "alert")?.class).toContain("notice-alert");
    });

    it("AC9, AC15 (issue 57): the notice shows on PAY_ERROR_SOLD_OUT's value alone: another payError shows the card without it", async () => {
      await soldOut();
      expect(cardWords(await render({ payError: "declined" }))).toEqual([TITLE, BODY, BACK]);
    });
  });

  describe("AC15, AC16 — the card's words and looks", () => {
    it("AC15 (issue 57): the words are the four new messages, the Back line reusing supperClub.done.back", () => {
      expect(en).toMatchObject({
        "supperClub.soldOut.title": TITLE,
        "supperClub.soldOut.body": BODY,
        "supperClub.soldOut.contact": "Questions? Email the farm at {email}.",
        "supperClub.soldOut.notice": NOTICE,
        "supperClub.done.back": BACK,
      });
    });

    it("AC15 (issue 57): the title has the already page's look", async () => {
      await soldOut();
      const classes = new RegExp(`<p\\b[^>]*class="([^"]*)"[^>]*>${TITLE}</p>`).exec(screenMarkup(await render()))?.[1];
      expect(utilitiesOf(classes)).toEqual(expect.arrayContaining(["font-display", "text-heading", "text-teal"]));
    });

    it('AC15 (issue 57): "Back to ohiocityfarm.com" is a secondary button to the farm\'s site', async () => {
      await soldOut();
      const link = attributesOf(await render(), "a").find((a) => a.href === "https://ohiocityfarm.com");
      expect(utilitiesOf(link?.class)).toContain("btn-secondary");
    });

    it('AC16 (issue 57): with an email set, the "Questions?" line stands between the paragraph and the button, as a hint', async () => {
      await soldOut();
      services.farmEmail = FARM_EMAIL;
      const html = await render();
      expect(cardWords(html)).toEqual([TITLE, BODY, QUESTIONS, BACK]);
      expect(utilitiesOf(new RegExp(`<span\\b[^>]*class="([^"]*)"[^>]*>${QUESTIONS.replace("?", "\\?")}</span>`).exec(screenMarkup(html))?.[1])).toContain("text-ink-muted");
    });

    it("AC16 (issue 57): with the notice and an email, all five read in order", async () => {
      await soldOut();
      services.farmEmail = FARM_EMAIL;
      expect(cardWords(await render({ payError: "soldout" }))).toEqual([NOTICE, TITLE, BODY, QUESTIONS, BACK]);
    });
  });

  describe("AC17 — the four strings say subscription", () => {
    it("AC17 (issue 57): capHint, box.title, next.change and already.title do, and consentError keeps its box, which is the checkbox", () => {
      expect(en).toMatchObject({
        "supperClub.capHint": "Limited to {cap} subscriptions. No sales tax.",
        "supperClub.box.title": "Your subscription",
        "supperClub.next.change": "To skip a week, change your subscription or cancel, sign in to your account before the end of Monday.",
        "supperClub.already.title": "You already have a Supper Club subscription",
        "supperClub.consentError": "Check the box to agree to the weekly charge.",
      });
    });
  });
});

describe("AC17 — the page's cards fill their columns", () => {
  it('AC17: both cards use width="fill"', async () => {
    const element = await SupperClub({ searchParams: Promise.resolve({}) });
    expect(findAll(element, Card).map((card) => card.props.width)).toEqual(["fill", "fill"]);
  });
});

describe("issue 77 — the page opens on JoinPage's frame", () => {
  it('AC4: signed out, its header is the one header, and "Sign in" there goes to /supper-club/sign-in', async () => {
    const html = await render();
    expect(attributesOf(html, "header")).toHaveLength(1);
    expect(screenMarkup(html)).toMatch(/<header\b[\s\S]*<a\b[^>]*href="\/supper-club\/sign-in"[^>]*>Sign in<\/a>[\s\S]*<\/header>/);
  });

  it('AC3: it stays on the page shell, its left column first and its "Join the Supper Club" card second', async () => {
    const element = await SupperClub({ searchParams: Promise.resolve({}) });
    expect(findAll(element, Shell).map((shell) => shell.props.width)).toEqual(["page"]);
    const texts = textsOf(renderToStaticMarkup(element));
    expect(texts.indexOf("Weekly meals from the farm kitchen")).toBeLessThan(texts.indexOf("Join the Supper Club"));
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
