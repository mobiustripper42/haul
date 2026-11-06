"use client";

import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "../../components/ui/button";
import { CardEntry, type CardEntryHandle } from "../../components/ui/card-entry";
import { Checkbox } from "../../components/ui/checkbox";
import { FieldError } from "../../components/ui/field-error";
import { Hint } from "../../components/ui/hint";
import { Notice } from "../../components/ui/notice";
import { PricePanel } from "../../components/ui/price-panel";
import { joinSupperClub } from "./actions";
import type { PaymentWording } from "./payment-wording";

/** The words the page has translated for this section, which a client component cannot get for itself. */
export type PaymentText = {
  legend: string;
  cardLabel: string;
  cardHint: string;
  testCard: string;
  cardFailed: string;
  todayLabel: string;
  weeklyLabel: string;
  consentError: string;
  declined: string;
  error: string;
  capHint: string;
};

const CONSENT_ERROR_ID = "consent-error";

/** Pay, disabled while the action runs, so a double-click sends one token. A child of the form, for `useFormStatus`. */
function PayButton({ children }: { children: string }) {
  const { pending } = useFormStatus();
  return (
    <Button kind="primary" type="submit" full disabled={pending}>
      {children}
    </Button>
  );
}

/**
 * Section 4, the pay form: its own POST form after the pickers' GET form, so Enter on a radio can never
 * submit a payment. It copies the picks into hidden fields named by option type id, and follows the
 * radios as they change: `wordings` holds the words for every price a pick can come to (made on the
 * server, so the words shown and the words stored are one), and the price panel, the checkbox sentence
 * and the button follow the sum. Pay is the form's action: it asks `CardEntry` for a token, adds it to what
 * the form holds, and only then calls `joinSupperClub`; it does not go on without the tick.
 */
export function PaymentSection({
  prices,
  choices: firstChoices,
  wordings,
  payError,
  text,
  card,
}: {
  /** Per option type, in order: the price of each option. */
  prices: { typeId: string; options: { id: string; priceCents: number }[] }[];
  choices: Record<string, string>;
  /** The words for each price a pick can come to, by cents. */
  wordings: Record<string, PaymentWording>;
  payError: "consent" | "declined" | "error" | undefined;
  text: PaymentText;
  card: {
    testMode: boolean;
    applicationId: string | undefined;
    locationId: string | undefined;
    billing: { email: string; givenName?: string; familyName?: string };
  };
}) {
  const [choices, setChoices] = useState(firstChoices);
  const [ticked, setTicked] = useState(false);
  const [refused, setRefused] = useState(false);
  const entry = useRef<CardEntryHandle>(null);

  useEffect(() => {
    const read = () => {
      const picked: Record<string, string> = {};
      for (const { typeId } of prices) {
        const radio = document.querySelector<HTMLInputElement>(`input[type="radio"][name="${CSS.escape(typeId)}"]:checked`);
        if (radio) picked[typeId] = radio.value;
      }
      setChoices((earlier) => ({ ...earlier, ...picked }));
    };
    read();
    document.addEventListener("change", read);
    return () => document.removeEventListener("change", read);
  }, [prices]);

  const cents = prices.reduce(
    (sum, { typeId, options }) => sum + (options.find((option) => option.id === choices[typeId])?.priceCents ?? 0),
    0,
  );
  const words = wordings[String(cents)] ?? Object.values(wordings)[0];
  if (!words) return null;

  async function pay(form: FormData) {
    if (form.get("consent") === null) {
      setRefused(true);
      return;
    }
    const token = await entry.current?.tokenize();
    // No token: Square's form is showing what is wrong with the card, or the card form says it failed.
    if (!token) return;
    form.set("sourceId", token);
    await joinSupperClub(form);
  }

  const consentShown = refused || (payError === "consent" && !ticked);

  return (
    <form action={pay} className="flex flex-col gap-5">
      {prices.map(({ typeId }) => (
        <input key={typeId} type="hidden" name={typeId} value={choices[typeId] ?? ""} />
      ))}
      <p className="font-display text-section text-teal">{text.legend}</p>
      <CardEntry
        ref={entry}
        label={text.cardLabel}
        hint={text.cardHint}
        testLabel={text.testCard}
        failedText={text.cardFailed}
        testMode={card.testMode}
        applicationId={card.applicationId}
        locationId={card.locationId}
        amountCents={cents}
        billing={card.billing}
      />
      <PricePanel
        rows={[
          { label: text.todayLabel, value: words.price },
          { label: text.weeklyLabel, value: words.price },
        ]}
        note={words.pickupLine}
      />
      <Checkbox
        name="consent"
        aria-describedby={consentShown ? CONSENT_ERROR_ID : undefined}
        onChange={(event) => {
          setTicked(event.currentTarget.checked);
          if (event.currentTarget.checked) setRefused(false);
        }}
      >
        {words.sentence}
      </Checkbox>
      {consentShown && <FieldError id={CONSENT_ERROR_ID}>{text.consentError}</FieldError>}
      {payError === "declined" && <Notice icon="alert">{text.declined}</Notice>}
      {payError === "error" && <Notice icon="alert">{text.error}</Notice>}
      <PayButton>{words.button}</PayButton>
      <Hint center>{text.capHint}</Hint>
    </form>
  );
}
