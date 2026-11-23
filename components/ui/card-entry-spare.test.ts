// Issue 240, AC8: the card box is spared the page's lock while Pay or Save card is being sent. e2e draws the test field in
// Square's place (e2e/tap-feedback.spec.ts), so the box around Square's own form is read here, in every state: the
// attribute is on CardEntryBody's one outermost element.
import { createElement, createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { attributesOf } from "../../app/screen-test-helpers";
import { CardEntryBody } from "./card-entry";

const renderBody = (state: "loading" | "attached" | "failed" | "test") =>
  renderToStaticMarkup(
    createElement(CardEntryBody, {
      state,
      label: "Card",
      hint: "Secure card entry by Square.",
      testLabel: "Test card",
      failedText: "The card form didn't load.",
      loadingText: "Loading the card form.",
      refused: false,
      testValue: "",
      onTestValue: () => {},
      target: createRef<HTMLDivElement>(),
    }),
  );

describe("AC8 — the card box is spared the lock", () => {
  it.each(["loading", "attached", "failed", "test"] as const)("AC8: in state %s, CardEntryBody's outermost element carries data-page-lock-spare", (state) => {
    expect(attributesOf(renderBody(state), "[a-z]+")[0]).toHaveProperty("data-page-lock-spare");
  });
});
