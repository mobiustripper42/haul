"use client";

import { useRef } from "react";
import { Button } from "../../../components/ui/button";
import { CardEntry, type CardEntryHandle } from "../../../components/ui/card-entry";
import type { cardEntrySettings } from "../../card-entry-settings";
import { saveCard } from "./actions";

/** Issue 145: the words the card page has translated for the form, which a client component cannot get for itself. */
export type CardFormText = { cardLabel: string; cardHint: string; testCard: string; cardFailed: string; cardRefused: string; cardLoading: string; save: string };

/**
 * Issue 145: the new card's entry and Save card. Save is the form's action: it asks `CardEntry` for a token, adds it to
 * what the form holds, and only then calls `saveCard`; with no token Square's form is showing what is wrong, or the card
 * form says it failed, and nothing is sent. The tokenize-then-submit steps are the signup's (app/supper-club/payment-section.tsx), written again here.
 */
export function CardForm({ amountCents, card, text }: { amountCents: number; card: ReturnType<typeof cardEntrySettings>; text: CardFormText }) {
  const entry = useRef<CardEntryHandle>(null);

  async function save(form: FormData) {
    const token = await entry.current?.tokenize();
    if (!token) return;
    form.set("sourceId", token);
    await saveCard(form);
  }

  return (
    <form action={save} className="flex flex-col gap-5">
      <CardEntry
        ref={entry}
        label={text.cardLabel}
        hint={text.cardHint}
        testLabel={text.testCard}
        failedText={text.cardFailed}
        refusedText={text.cardRefused}
        loadingText={text.cardLoading}
        testMode={card.testMode}
        applicationId={card.applicationId}
        locationId={card.locationId}
        amountCents={amountCents}
        billing={card.billing}
      />
      <Button kind="primary" type="submit" full>
        {text.save}
      </Button>
    </form>
  );
}
