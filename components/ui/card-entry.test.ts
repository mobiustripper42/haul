// Issue 56, AC1 (hand walk, 2026-11-06): Square's card form measures 97px at this width, so the box around
// it grows to fit it and never covers the hint below. Square's form exists only with Square's script in a
// browser, and e2e draws the test field in its place (DEC-023), so this reads the box's classes, as
// components/ui/card.test.ts does. The box drawn around the real form is AC15, by hand.
// Issue 84: Square's form draws its own box, so ours draws none — no border, no padding — and Square's shows alone.
import { createElement, createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { attributesOf, screenMarkup, utilitiesOf } from "../../app/screen-test-helpers";
import { CardEntry, CardEntryBody, cardAttachment, cardDetails, tokenizeWhenAttached, type SquareCard } from "./card-entry";

const render = (testMode: boolean) =>
  renderToStaticMarkup(
    createElement(CardEntry, {
      label: "Card",
      hint: "Secure card entry by Square.",
      testLabel: "Test card",
      failedText: "The card form didn't load.",
      loadingText: "Loading the card form.",
      testMode,
      applicationId: "sandbox-application",
      locationId: "LOCATION",
      amountCents: 5000,
      intent: "CHARGE_AND_STORE",
      billing: { email: "member@example.com" },
    }),
  );

/** The class of the box Square attaches its form to: the one element with nothing in it. */
function cardBoxClass(): string | undefined {
  return /<div\b[^>]*\bclass="([^"]*)"[^>]*><\/div>/.exec(screenMarkup(render(false)))?.[1];
}

describe("AC1 (issue 56) — CardEntry's box", () => {
  it("AC1: the box around Square's form has no fixed height, and the text fields stay 40px", () => {
    const utilities = utilitiesOf(cardBoxClass());
    expect(utilitiesOf("field")).toContain("h-field");

    // The last height named is the one that holds, whether a class replaces `.field`'s or leaves it out.
    expect(utilities.filter((utility) => utility.startsWith("h-")).at(-1) ?? "h-auto").toBe("h-auto");
  });

  it("AC1 (issue 84): the box draws no border and no padding of its own, so Square's box is the only one", () => {
    const utilities = utilitiesOf(cardBoxClass());
    expect(utilities.filter((utility) => /^border(-|$)/.test(utility) || /^p[xytrbl]?-/.test(utility))).toEqual([]);
  });
});

describe("AC1 (issue 56) — CardEntry's test field, for e2e", () => {
  it("AC1: with testMode it draws one text input named by testLabel, and no box for Square's form", () => {
    const html = render(true);
    expect(attributesOf(html, "input").map((input) => input["aria-label"])).toEqual(["Test card"]);
    expect(screenMarkup(html)).not.toMatch(/<div\b[^>]*><\/div>/);
  });

  it("AC1: without testMode it draws no input", () => {
    expect(attributesOf(render(false), "input")).toEqual([]);
  });
});

// Issue 222, AC9: Vitest has no DOM, so no effect runs: CardEntryBody is each state's markup, rendered statically, and
// CardEntry's first render is what a page sends before Square's script has run. The words are stand-ins.
const BODY = {
  label: "Card",
  hint: "Secure card entry by Square.",
  testLabel: "Test card",
  failedText: "The card form didn't load.",
  loadingText: "Loading the card form.",
  refused: false,
  testValue: "",
  onTestValue: () => {},
};

type BodyState = "loading" | "attached" | "failed" | "test";
const renderBody = (state: BodyState) => renderToStaticMarkup(createElement(CardEntryBody, { ...BODY, state, target: createRef<HTMLDivElement>() }));

/** Where Square's attach target, the one empty <div>, stands in the markup; -1 when there is none. */
const targetAt = (html: string): number => screenMarkup(html).search(/<div\b[^>]*><\/div>/);

/** The `role="status"` elements: the placeholder. */
const statuses = (html: string) => attributesOf(html, "[a-z]+").filter((attributes) => attributes.role === "status");

describe("AC9 (issue 222) — CardEntryBody, one branch per state", () => {
  it("AC9: loading draws the attach target, then the role=status placeholder holding the waiting line", () => {
    const html = screenMarkup(renderBody("loading"));
    expect(statuses(html)).toHaveLength(1);
    expect(targetAt(html)).toBeGreaterThan(-1);
    expect(targetAt(html)).toBeLessThan(html.indexOf('role="status"'));
    expect(html.slice(html.indexOf('role="status"'))).toContain(BODY.loadingText);
  });

  it("AC9: attached draws the attach target and no placeholder", () => {
    const html = renderBody("attached");
    expect(targetAt(html)).toBeGreaterThan(-1);
    expect(statuses(html)).toEqual([]);
  });

  it("AC9: failed draws the card-failed error line and no placeholder", () => {
    const html = renderBody("failed");
    expect(attributesOf(html, "[a-z]+").filter((attributes) => attributes.id === "card-failed")).toHaveLength(1);
    expect(statuses(html)).toEqual([]);
  });

  it("AC9: test draws the test input named by testLabel and no placeholder", () => {
    const html = renderBody("test");
    expect(attributesOf(html, "input").map((input) => input["aria-label"])).toEqual([BODY.testLabel]);
    expect(statuses(html)).toEqual([]);
  });

  it("AC9: CardEntry's first render, not in testMode, is the loading branch", () => {
    expect(render(false)).toBe(renderBody("loading"));
  });

  it("AC9: CardEntry's first render, in testMode, is the test branch", () => {
    expect(render(true)).toBe(renderBody("test"));
  });
});

// Issue 222, AC10: the wait, as plain promises. `card` stands in for Square's form; its tokenize answers as given.
describe("AC10 (issue 222) — tokenizeWhenAttached", () => {
  const DETAILS = { amount: "50.00", currencyCode: "USD" };

  const squareCard = (tokenize: SquareCard["tokenize"]): SquareCard & { tokenize: ReturnType<typeof vi.fn> } => ({
    attach: async () => {},
    tokenize: vi.fn(tokenize),
    destroy: async () => {},
  });

  /** Whether `pending` has settled once every task queued so far has run. */
  const hasSettled = async (pending: Promise<unknown>): Promise<boolean> => {
    let settled = false;
    void pending.then(
      () => (settled = true),
      () => (settled = true),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    return settled;
  };

  it("AC10: called before attach it waits, then resolves the token Square's tokenize returned", async () => {
    const card = squareCard(async () => ({ status: "OK", token: "cnon:card-token" }));
    const { attached, attach } = cardAttachment();
    const result = tokenizeWhenAttached(attached, DETAILS);
    expect(await hasSettled(result)).toBe(false);
    expect(card.tokenize).not.toHaveBeenCalled();
    attach(card);
    await expect(result).resolves.toEqual({ kind: "token", token: "cnon:card-token" });
    expect(card.tokenize).toHaveBeenCalledWith(DETAILS);
  });

  it("AC10: called before fail it waits, then resolves failed", async () => {
    const { attached, fail } = cardAttachment();
    const result = tokenizeWhenAttached(attached, DETAILS);
    expect(await hasSettled(result)).toBe(false);
    fail();
    await expect(result).resolves.toEqual({ kind: "failed" });
  });

  it("AC10: a Square status other than OK resolves none", async () => {
    const card = squareCard(async () => ({ status: "Invalid" }));
    await expect(tokenizeWhenAttached(Promise.resolve(card), DETAILS)).resolves.toEqual({ kind: "none" });
  });

  it("AC10: a throw named TokenizationError resolves refused", async () => {
    const card = squareCard(async () => {
      throw Object.assign(new Error("Square refused the card"), { name: "TokenizationError" });
    });
    await expect(tokenizeWhenAttached(Promise.resolve(card), DETAILS)).resolves.toEqual({ kind: "refused" });
  });

  it("AC10: any other throw resolves failed", async () => {
    const card = squareCard(async () => {
      throw new Error("Square's form fell over");
    });
    await expect(tokenizeWhenAttached(Promise.resolve(card), DETAILS)).resolves.toEqual({ kind: "failed" });
  });
});

// Issue 254: what Square's tokenize is sent. Which intent a page picks is the page's (app/account/card/page.test.ts) and
// app/card-intent.test.ts's.
describe("AC14 (issue 254) — cardDetails", () => {
  const billing = { email: "member@example.com", givenName: "Ada", familyName: "Lovelace" };

  it("AC14: CHARGE_AND_STORE is the amount in dollars and cents, USD, the buyer present, and the member as billing contact", () => {
    expect(cardDetails({ intent: "CHARGE_AND_STORE", amountCents: 5000, billing })).toStrictEqual({
      amount: "50.00",
      currencyCode: "USD",
      intent: "CHARGE_AND_STORE",
      customerInitiated: true,
      sellerKeyedIn: false,
      billingContact: billing,
    });
  });

  it("AC14: STORE has no amount and no currency", () => {
    expect(cardDetails({ intent: "STORE", amountCents: 5000, billing })).toStrictEqual({
      intent: "STORE",
      customerInitiated: true,
      sellerKeyedIn: false,
      billingContact: billing,
    });
  });
});
