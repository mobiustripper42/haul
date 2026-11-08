// Issue 57, AC9, AC15 and AC16: SoldOutCard, what stands in the Join card's place at the cap. It owns the
// card's words and their order, the notice that opens it under AC9, and the "Questions?" line under AC16;
// that the page shows it, and when, is app/supper-club/page.test.ts's. It has no hooks, so it is called
// directly and read through its props.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createTranslator } from "@core/i18n.js";
import { en } from "@core/messages/en.js";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { Hint } from "../../components/ui/hint";
import { Notice } from "../../components/ui/notice";
import { findAll, textsOf } from "../screen-test-helpers";
import { SoldOutCard } from "./sold-out-card";

const t = createTranslator("en");
const EMAIL = "farm@ohiocityfarm.com";

const render = (over: { notice?: boolean; email?: string } = {}) => {
  const element = SoldOutCard({ t, notice: over.notice ?? false, email: over.email });
  return { element, html: renderToStaticMarkup(element) };
};

describe("AC15, AC16 — the card's words", () => {
  it("AC15: it reads the title, the paragraph and the back button, in that order", () => {
    expect(textsOf(render().html)).toEqual([en["supperClub.soldOut.title"], en["supperClub.soldOut.body"], en["supperClub.done.back"]]);
  });

  it('AC16: with an email, the "Questions?" line stands between the paragraph and the button, as a hint', () => {
    const { element, html } = render({ email: EMAIL });
    const contact = t("supperClub.soldOut.contact", { email: EMAIL });
    expect(textsOf(html)).toEqual([en["supperClub.soldOut.title"], en["supperClub.soldOut.body"], contact, en["supperClub.done.back"]]);
    expect(findAll(element, Hint).map((hint) => hint.props.children)).toEqual([contact]);
  });

  it("AC16: with no email there is no hint", () => {
    expect(findAll(render().element, Hint)).toEqual([]);
  });

  it("AC9, AC15: with the notice it comes first, as an alert", () => {
    const { element, html } = render({ notice: true });
    expect(textsOf(html)[0]).toBe(en["supperClub.soldOut.notice"]);
    expect(findAll(element, Notice).map((notice) => [notice.props.icon, notice.props.children])).toEqual([
      ["alert", en["supperClub.soldOut.notice"]],
    ]);
  });

  it("AC9: without the notice it shows none", () => {
    expect(findAll(render().element, Notice)).toEqual([]);
  });

  it("AC15, AC16: with the notice and an email, all five read in order", () => {
    expect(textsOf(render({ notice: true, email: EMAIL }).html)).toEqual([
      en["supperClub.soldOut.notice"],
      en["supperClub.soldOut.title"],
      en["supperClub.soldOut.body"],
      t("supperClub.soldOut.contact", { email: EMAIL }),
      en["supperClub.done.back"],
    ]);
  });
});

describe("AC15 — the back button and the card", () => {
  it('AC15: "Back to ohiocityfarm.com" is a secondary button to the farm\'s site', () => {
    const buttons = findAll(render().element, Button);
    expect(buttons.map(({ props }) => [props.kind, props.href, props.children])).toEqual([
      ["secondary", "https://ohiocityfarm.com", en["supperClub.done.back"]],
    ]);
  });

  it('AC17 (issue 55): it is a Card that fills the right column: width="fill"', () => {
    expect(findAll(render().element, Card).map((card) => card.props.width)).toEqual(["fill"]);
  });
});

describe("AC15, AC17 — the card's wording", () => {
  it("AC15 (issue 57): the words are the four new messages, the Back line reusing supperClub.done.back", () => {
    expect(en).toMatchObject({
      "supperClub.soldOut.title": "The Supper Club is sold out",
      "supperClub.soldOut.body": "All the subscriptions are taken right now. A subscription will open when a member cancels, so check back.",
      "supperClub.soldOut.contact": "Questions? Email the farm at {email}.",
      "supperClub.soldOut.notice": "The Supper Club sold out before your payment went through. Nothing was charged.",
      "supperClub.done.back": "Back to ohiocityfarm.com",
    });
  });

  it("AC17 (issue 57): capHint, box.title, next.change and already.title say subscription, and consentError keeps its box, which is the checkbox", () => {
    expect(en).toMatchObject({
      "supperClub.capHint": "Limited to {cap} subscriptions. No sales tax.",
      "supperClub.box.title": "Your subscription",
      "supperClub.next.change": "To skip a week, change your subscription or cancel, sign in to your account before the end of Monday.",
      "supperClub.already.title": "You already have a Supper Club subscription",
      "supperClub.consentError": "Check the box to agree to the weekly charge.",
    });
  });
});
