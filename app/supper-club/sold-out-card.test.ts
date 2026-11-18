// Issue 57, AC9, AC15 and AC16: SoldOutCard, what stands in the Join card's place at the cap. It owns the
// notice that opens it under AC9, the "Questions?" line under AC16 and the back button; that the page shows
// it, and when, is app/supper-club/page.test.ts's. It has no hooks, so it is called directly and read
// through its props.
import { isValidElement } from "react";
import { describe, expect, it } from "vitest";
import { createTranslator } from "@core/i18n.js";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { Hint } from "../../components/ui/hint";
import { Notice } from "../../components/ui/notice";
import { findAll } from "../screen-test-helpers";
import { SoldOutCard } from "./sold-out-card";

const t = createTranslator("en");
const EMAIL = "farm@ohiocityfarm.com";

const render = (over: { notice?: boolean; email?: string } = {}) => SoldOutCard({ t, notice: over.notice ?? false, email: over.email });

describe("AC15, AC16 — the card's lines", () => {
  it('AC16: with an email, the "Questions?" line stands between the paragraph and the button, as a hint', () => {
    const card = render({ email: EMAIL });
    expect(findAll(card, Hint).map((hint) => hint.props.children)).toEqual([t("supperClub.soldOut.contact", { email: EMAIL })]);
    // The card's parts in order: the title line, the paragraph, the hint, the button.
    expect((card.props.children as unknown[]).filter((child) => isValidElement(child)).map((child) => child.type)).toEqual(["p", "p", Hint, Button]);
  });

  it("AC16: with no email there is no hint", () => {
    expect(findAll(render(), Hint)).toEqual([]);
  });

  it("AC9, AC15: with the notice it comes first, as an alert", () => {
    const card = render({ notice: true });
    expect(findAll(card, Notice).map((notice) => [notice.props.icon, notice.props.children])).toEqual([["alert", t("supperClub.soldOut.notice")]]);
    expect((card.props.children as unknown[])[0]).toMatchObject({ type: Notice });
  });

  it("AC9: without the notice it shows none", () => {
    expect(findAll(render(), Notice)).toEqual([]);
  });
});

describe("AC15 — the back button and the card", () => {
  it('AC15: "Back to ohiocityfarm.com" is a secondary button to the farm\'s site', () => {
    const buttons = findAll(render(), Button);
    expect(buttons.map(({ props }) => [props.kind, props.href])).toEqual([["secondary", "https://ohiocityfarm.com"]]);
  });

  it('AC17 (issue 55): it is a Card that fills the right column: width="fill"', () => {
    expect(findAll(render(), Card).map((card) => card.props.width)).toEqual(["fill"]);
  });
});
