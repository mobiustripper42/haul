"use client";

import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { FieldError } from "./field-error";
import { Hint } from "./hint";
import { Input } from "./input";
import { Spinner } from "./spinner";

/**
 * What the form calls when pay is pressed: the card's token, or null when there is none. A mistyped card is
 * Square's form showing its own error; a form that did not load or threw shows `failedText` in its place.
 */
export type CardEntryHandle = { tokenize(): Promise<string | null> };

export type SquareCard = {
  attach(target: HTMLElement): Promise<void>;
  tokenize(details: object): Promise<{ status: string; token?: string }>;
  destroy(): Promise<void>;
};

/**
 * The markup for each state of the card field (issue 222): `loading` draws Square's attach target, empty and at no height,
 * and the placeholder after it; `attached` the target alone; `failed` the error line; `test` the text field e2e types a
 * token into. The target sits in the same place in `loading` and `attached`, so it is the one element across the change
 * and Square's form is not lost to a remount.
 */
export function CardEntryBody({
  state,
  label,
  hint,
  testLabel,
  failedText,
  refusedText,
  loadingText,
  refused,
  testValue,
  onTestValue,
  target,
}: {
  state: "loading" | "attached" | "failed" | "test";
  label: string;
  hint: string;
  testLabel: string;
  failedText: string;
  /** The words under the field for a refused card; the page always passes them. Optional because components/ui/card-entry.test.ts renders the box without them. */
  refusedText?: string;
  loadingText: string;
  refused: boolean;
  testValue: string;
  onTestValue(value: string): void;
  target: Ref<HTMLDivElement>;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-field-label">{label}</span>
      {state === "failed" ? (
        <FieldError id="card-failed">{failedText}</FieldError>
      ) : state === "test" ? (
        <Input name="sourceId" aria-label={testLabel} value={testValue} onChange={(event) => onTestValue(event.target.value)} />
      ) : (
        <div>
          {/* No border or padding, and no height: Square's form draws its own box, and ours around it made two (issue 84). */}
          <div ref={target} className="w-full" />
          {state === "loading" && (
            // The placeholder holds Square's form's height so nothing below moves when it attaches (issue 222). Square's form
            // measured 97px in issue 56's hand walk (components/ui/card-entry.test.ts:1); h-24 is the spacing step nearest it,
            // since the theme takes no arbitrary value (app/theme.test.ts). Not measured again here; AC11 checks 375px and 1440px.
            <div role="status" className="field flex h-24 items-center justify-center gap-2">
              <span className="inline-flex text-teal">
                <Spinner />
              </span>
              <Hint center>{loadingText}</Hint>
            </div>
          )}
        </div>
      )}
      {refused && state !== "failed" && <FieldError id="card-refused">{refusedText}</FieldError>}
      <Hint>{hint}</Hint>
    </div>
  );
}

/**
 * The promise `tokenize` waits on (issue 222): it settles with the card when `attach` is called and rejects when `fail`
 * is, so a press before Square's form is there waits for it. A rejection nobody is waiting on is not an error.
 */
export function cardAttachment(): { attached: Promise<SquareCard>; attach(card: SquareCard): void; fail(): void } {
  let attach!: (card: SquareCard) => void;
  let fail!: () => void;
  const attached = new Promise<SquareCard>((resolve, reject) => {
    attach = resolve;
    fail = () => reject(new Error("The card form did not load"));
  });
  attached.catch(() => {});
  return { attached, attach, fail };
}

/** A throw named `TokenizationError` is Square refusing the card; any other throw is the form failing (issue 222). */
export function throwKind(error: unknown): "refused" | "failed" {
  return error instanceof Error && error.name === "TokenizationError" ? "refused" : "failed";
}

/**
 * The card's token once Square's form has attached (issue 222): waits on `attached`, then asks Square to tokenize with
 * `details`. A status other than OK is a mistyped card (`none`, Square's form shows what is wrong); a throw is `refused`
 * or `failed` (`throwKind`), and so is a form that failed to attach.
 */
export async function tokenizeWhenAttached(
  attached: Promise<SquareCard>,
  details: object,
): Promise<{ kind: "token"; token: string } | { kind: "none" } | { kind: "refused" } | { kind: "failed" }> {
  try {
    const result = await (await attached).tokenize(details);
    return result.status === "OK" && result.token ? { kind: "token", token: result.token } : { kind: "none" };
  } catch (error) {
    return { kind: throwKind(error) };
  }
}

/** What the card box asks Square for: a card to charge and store (a payment is made from the token), or to store alone (issue 254). */
export type CardIntent = "CHARGE_AND_STORE" | "STORE";

/**
 * What `tokenize` is sent (issue 254): the customer present and not keyed in by the seller, with the member as the billing
 * contact. `CHARGE_AND_STORE` adds the amount in dollars and cents and the currency; `STORE` has neither, as Square's
 * "Store card details" sample has it. No verification token is sent, `verifyBuyer` being retired. `billing` goes to
 * Square's card check, never to the Square customer.
 */
export function cardDetails({
  intent,
  amountCents,
  billing,
}: {
  intent: CardIntent;
  amountCents: number;
  billing: { email: string; givenName?: string; familyName?: string };
}): object {
  const common = { intent, customerInitiated: true, sellerKeyedIn: false, billingContact: billing };
  return intent === "CHARGE_AND_STORE" ? { amount: (amountCents / 100).toFixed(2), currencyCode: "USD", ...common } : common;
}

type SquarePayments = { card(): Promise<SquareCard> };
type SquareGlobal = { payments(applicationId: string, locationId: string): SquarePayments | Promise<SquarePayments> };

declare global {
  interface Window {
    Square?: SquareGlobal;
  }
}

/** Square's Web Payments SDK. A sandbox application id starts with "sandbox-". */
const SDK_URLS = { sandbox: "https://sandbox.web.squarecdn.com/v1/square.js", production: "https://web.squarecdn.com/v1/square.js" };

function loadSquare(applicationId: string): Promise<SquareGlobal> {
  return new Promise((resolve, reject) => {
    if (window.Square) {
      resolve(window.Square);
      return;
    }
    const script = document.createElement("script");
    script.src = applicationId.startsWith("sandbox-") ? SDK_URLS.sandbox : SDK_URLS.production;
    script.async = true;
    script.onload = () => (window.Square ? resolve(window.Square) : reject(new Error("Square did not load")));
    script.onerror = () => reject(new Error("Square did not load"));
    document.head.append(script);
  });
}

/**
 * Square's card form, which draws its own box, in a plain block that grows to fit it (Square's form is
 * taller than a 40px field), with its label and hint. It is the page's first client code:
 * it loads Square's script, and `ref.tokenize()` turns what was typed into a single-use token, for the
 * form to post as `sourceId`. The token is asked for by the page's `intent` (`cardDetails`): a card to charge and store
 * (`CHARGE_AND_STORE`, the customer present) or to store alone (`STORE`), with the member as the billing contact.
 *
 * Until Square's form attaches, a placeholder holds its height with a spinner and `loadingText` (issue 222); a press
 * of pay before then waits for the form (`tokenizeWhenAttached`). `CardEntryBody` draws every state.
 *
 * Where Square's script cannot load (e2e), `testMode` draws a text field named `testLabel` in its place,
 * whose value is the token, and an empty one behaves as a throw (DEC-023); the page gates it as
 * `app/dev/outbox/route.ts` is. If Square's script fails to load or `tokenize` throws, `failedText` takes
 * the field's place and pay stops there; a `tokenize` status other than OK is a mistyped card, not a failure.
 * A throw named `TokenizationError` is Square refusing the card: the field stays and `refusedText` shows under
 * it until the next pay. In `testMode` the value `refused` throws one.
 */
export function CardEntry({
  label,
  hint,
  testLabel,
  failedText,
  refusedText,
  loadingText,
  testMode,
  applicationId,
  locationId,
  amountCents,
  intent,
  billing,
  ref,
}: {
  label: string;
  hint: string;
  testLabel: string;
  failedText: string;
  /** The words under the field for a refused card; the page always passes them. Optional because components/ui/card-entry.test.ts renders the box without them. */
  refusedText?: string;
  /** The waiting line in the placeholder, until Square's form attaches. */
  loadingText: string;
  testMode: boolean;
  applicationId: string | undefined;
  locationId: string | undefined;
  amountCents: number;
  /** What the page does with the token: charge it and store the card, or store the card alone. Chosen by the page. */
  intent: CardIntent;
  billing: { email: string; givenName?: string; familyName?: string };
  ref?: Ref<CardEntryHandle>;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [testValue, setTestValue] = useState("");
  const [attached, setAttached] = useState(false);
  const [failed, setFailed] = useState(false);
  // Square refused the card: the field stays and `refusedText` shows under it until the next pay.
  const [refused, setRefused] = useState(false);
  // What `tokenize` waits on: made once, settled by the effect below.
  const [attachment] = useState(cardAttachment);
  // Read when pay is pressed, so a pick changed after the form loaded is the amount asked for.
  const latest = useRef({ amountCents, intent, billing, testValue });
  latest.current = { amountCents, intent, billing, testValue };

  useEffect(() => {
    if (testMode || !applicationId || !locationId || !container.current) return;
    const target = container.current;
    let gone = false;
    let made: SquareCard | null = null;
    void (async () => {
      const square = await loadSquare(applicationId);
      const card = await (await square.payments(applicationId, locationId)).card();
      if (gone) return;
      made = card;
      await card.attach(target);
      if (gone) return;
      attachment.attach(card);
      setAttached(true);
    })().catch(() => {
      if (gone) return;
      attachment.fail();
      setFailed(true);
    });
    return () => {
      gone = true;
      void made?.destroy();
    };
  }, [testMode, applicationId, locationId, attachment]);

  useImperativeHandle(ref, () => ({
    async tokenize() {
      const { amountCents: cents, intent: asked, billing: contact, testValue: typed } = latest.current;
      setRefused(false);
      let outcome: Awaited<ReturnType<typeof tokenizeWhenAttached>>;
      if (testMode) {
        if (typed !== "" && typed !== "refused") return typed;
        const thrown = typed === "" ? new Error("The test card field is empty") : Object.assign(new Error("The test card was refused"), { name: "TokenizationError" });
        outcome = { kind: throwKind(thrown) };
      } else {
        outcome = await tokenizeWhenAttached(attachment.attached, cardDetails({ intent: asked, amountCents: cents, billing: contact }));
      }
      if (outcome.kind === "token") return outcome.token;
      if (outcome.kind === "refused") setRefused(true);
      else if (outcome.kind === "failed") setFailed(true);
      return null;
    },
  }));

  return (
    <CardEntryBody
      state={failed ? "failed" : testMode ? "test" : attached ? "attached" : "loading"}
      label={label}
      hint={hint}
      testLabel={testLabel}
      failedText={failedText}
      refusedText={refusedText}
      loadingText={loadingText}
      refused={refused}
      testValue={testValue}
      onTestValue={setTestValue}
      target={container}
    />
  );
}
