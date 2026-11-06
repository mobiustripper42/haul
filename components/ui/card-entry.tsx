"use client";

import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { FieldError } from "./field-error";
import { Hint } from "./hint";
import { Input } from "./input";

/**
 * What the form calls when pay is pressed: the card's token, or null when there is none. A mistyped card is
 * Square's form showing its own error; a form that did not load or threw shows `failedText` in its place.
 */
export type CardEntryHandle = { tokenize(): Promise<string | null> };

type SquareCard = {
  attach(target: HTMLElement): Promise<void>;
  tokenize(details: object): Promise<{ status: string; token?: string }>;
  destroy(): Promise<void>;
};
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
 * Square's card form, drawn as a 40px field, with its label and hint. It is the page's first client code:
 * it loads Square's script, and `ref.tokenize()` turns what was typed into a single-use token, for the
 * form to post as `sourceId`. The token is asked for as a card to store and charge
 * (`CHARGE_AND_STORE`, the customer present), with the amount and the member as the billing contact; no
 * verification token is sent, `verifyBuyer` being retired. `billing` goes to Square's card check, never to
 * the Square customer.
 *
 * Where Square's script cannot load (e2e), `testMode` draws a text field named `testLabel` in its place,
 * whose value is the token, and an empty one behaves as a throw (DEC-023); the page gates it as
 * `app/dev/outbox/route.ts` is. If Square's script fails to load or `tokenize` throws, `failedText` takes
 * the field's place and pay stops there; a `tokenize` status other than OK is a mistyped card, not a failure.
 */
export function CardEntry({
  label,
  hint,
  testLabel,
  failedText,
  testMode,
  applicationId,
  locationId,
  amountCents,
  billing,
  ref,
}: {
  label: string;
  hint: string;
  testLabel: string;
  failedText: string;
  testMode: boolean;
  applicationId: string | undefined;
  locationId: string | undefined;
  amountCents: number;
  billing: { email: string; givenName?: string; familyName?: string };
  ref?: Ref<CardEntryHandle>;
}) {
  const container = useRef<HTMLDivElement>(null);
  const card = useRef<SquareCard | null>(null);
  const [testValue, setTestValue] = useState("");
  const [failed, setFailed] = useState(false);
  // Read when pay is pressed, so a pick changed after the form loaded is the amount asked for.
  const latest = useRef({ amountCents, billing, testValue });
  latest.current = { amountCents, billing, testValue };

  useEffect(() => {
    if (testMode || !applicationId || !locationId || !container.current) return;
    const target = container.current;
    let gone = false;
    let attached: SquareCard | null = null;
    void (async () => {
      const square = await loadSquare(applicationId);
      const made = await (await square.payments(applicationId, locationId)).card();
      if (gone) return;
      await made.attach(target);
      attached = made;
      card.current = made;
    })().catch(() => {
      if (!gone) setFailed(true);
    });
    return () => {
      gone = true;
      card.current = null;
      void attached?.destroy();
    };
  }, [testMode, applicationId, locationId]);

  useImperativeHandle(ref, () => ({
    async tokenize() {
      const { amountCents: cents, billing: contact, testValue: typed } = latest.current;
      try {
        if (testMode) {
          if (typed === "") throw new Error("The test card field is empty");
          return typed;
        }
        if (!card.current) return null;
        const result = await card.current.tokenize({
          amount: (cents / 100).toFixed(2),
          currencyCode: "USD",
          intent: "CHARGE_AND_STORE",
          customerInitiated: true,
          sellerKeyedIn: false,
          billingContact: contact,
        });
        return result.status === "OK" && result.token ? result.token : null;
      } catch {
        setFailed(true);
        return null;
      }
    },
  }));

  return (
    <div className="flex flex-col gap-2">
      <span className="text-field-label">{label}</span>
      {failed ? (
        <FieldError id="card-failed">{failedText}</FieldError>
      ) : testMode ? (
        <Input name="sourceId" aria-label={testLabel} value={testValue} onChange={(event) => setTestValue(event.target.value)} />
      ) : (
        <div ref={container} className="field" />
      )}
      <Hint>{hint}</Hint>
    </div>
  );
}
