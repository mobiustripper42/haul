// Issue 55, AC18: the sign-in layout is SiteHeader with no account link, then the page. SiteHeader's own
// markup is the header's tests'; here it is faked, so what is read is the one thing the layout decides.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { textsOf } from "../screen-test-helpers";
import { SiteHeader } from "../site-header";
import SignInLayout from "./layout";

vi.mock("../site-header", () => ({ SiteHeader: vi.fn(async () => createElement("header", null, "the header")) }));

describe('AC18 — the sign-in layout uses SiteHeader with account "none"', () => {
  it("AC18: it renders the header, then its children", async () => {
    const element = await SignInLayout({ children: createElement("p", null, "child") });
    expect(textsOf(renderToStaticMarkup(element))).toEqual(["the header", "child"]);
  });

  it('AC18: the header is asked for with account "none"', async () => {
    await SignInLayout({ children: null });
    expect(SiteHeader).toHaveBeenCalledWith({ account: "none" });
  });
});
