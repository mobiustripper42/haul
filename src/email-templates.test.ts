// Issue 9, AC5: renderEmail. The Spanish catalog is replaced for this whole file by a stand-in
// whose every value is its own key in guillemets, so a Spanish render shows exactly which keys
// the template reads, and any English the template wrote itself shows up beside them. The bare-
// string lint rule covers .tsx only; this is the check for .ts templates.
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { legalFooter, renderEmail, siteLink, withSignOff } from "./email-templates.js";
import { createTranslator } from "./i18n.js";

vi.mock("./messages/es.js", async () => {
  const { en } = await import("./messages/en.js");
  return { es: Object.fromEntries(Object.keys(en).map((key) => [key, `«${key}»`])) };
});

const SITE_URL = "https://members.example.test";
const STAND_IN_FOOTER = "«email.legalTerms»\n«email.legalPrivacy»";
const en = createTranslator("en");

describe("AC5 (issue 9) — renderEmail", () => {
  it("AC5: signInCode in English fills its body with the code and the minutes, and carries the footer's links", () => {
    const values = { code: "042517", minutes: 10 };
    const { text } = renderEmail("signInCode", "en", values, SITE_URL);
    expect(text).toContain(en("email.signInCode.body", values));
    expect(text).toContain(`${SITE_URL}/terms`);
    expect(text).toContain(`${SITE_URL}/privacy`);
  });

  it("AC5: signInCode in the stand-in Spanish catalog returns only catalog values — nothing the template wrote itself", () => {
    expect(renderEmail("signInCode", "es", { code: "042517", minutes: 10 }, SITE_URL)).toEqual({
      subject: "«email.signInCode.subject»",
      text: `«email.signInCode.body»\n\n«email.signOff»\n\n${STAND_IN_FOOTER}`,
    });
  });
});

describe("AC15 (issue 22) — renderEmail signInLink", () => {
  const LINK = "https://members.ohiocityfarm.com/sign-in/link?token=AbC_-123";

  it("AC15: signInLink in English fills its body with the link and the minutes, and carries the footer's links", () => {
    const values = { link: LINK, minutes: 10 };
    const { text } = renderEmail("signInLink", "en", values, SITE_URL);
    expect(text).toContain(en("email.signInLink.body", values));
    expect(text).toContain(LINK);
    expect(text).toContain(`${SITE_URL}/terms`);
    expect(text).toContain(`${SITE_URL}/privacy`);
  });

  it("AC15: signInLink in the stand-in Spanish catalog returns only catalog values — nothing the template wrote itself", () => {
    expect(renderEmail("signInLink", "es", { link: LINK, minutes: 10 }, SITE_URL)).toEqual({
      subject: "«email.signInLink.subject»",
      text: `«email.signInLink.body»\n\n«email.signOff»\n\n${STAND_IN_FOOTER}`,
    });
  });
});

describe("AC4 (issue 58) — withSignOff", () => {
  it("AC4: the sign-off comes from the translator it is handed", () => {
    expect(withSignOff(createTranslator("es"), "The body.")).toBe("The body.\n\n«email.signOff»");
  });
});

describe("AC7 (issue 63) — legalFooter", () => {
  it.each([SITE_URL, `${SITE_URL}/`])("AC7: from a site address of %s it carries the two links, each with one slash", (siteUrl) => {
    const footer = legalFooter(en, siteUrl);
    expect(footer).toContain("https://members.example.test/terms");
    expect(footer).toContain("https://members.example.test/privacy");
    expect(footer).not.toContain("test//");
  });

  it("AC7: its words come from the translator it is handed", () => {
    expect(legalFooter(createTranslator("es"), SITE_URL)).toBe(STAND_IN_FOOTER);
  });

  it("AC7: it is the one place the two lines are built", () => {
    const uses = ["./email-templates.ts", "./sign-in-email.ts", "./signup-email.ts"].map((file) => {
      const source = readFileSync(new URL(file, import.meta.url), "utf8");
      return [file, source.split("email.legalTerms").length - 1, source.split("email.legalPrivacy").length - 1];
    });
    expect(uses).toEqual([
      ["./email-templates.ts", 1, 1],
      ["./sign-in-email.ts", 0, 0],
      ["./signup-email.ts", 0, 0],
    ]);
  });

  it.each(["signInCode", "signInLink"] as const)("AC7: %s takes the footer's links from the site address it is given", (name) => {
    const values = { code: "042517", link: "https://elsewhere.example.test/l", minutes: 10 };
    const { text } = renderEmail(name, "en", values, "https://other.example.test/");
    expect(text).toContain("https://other.example.test/terms");
    expect(text).toContain("https://other.example.test/privacy");
  });
});

describe("AC7 (issue 63) — siteLink, moved here so the footer can use it", () => {
  it.each([
    ["https://members.ohiocityfarm.com", "/", "https://members.ohiocityfarm.com/"],
    ["https://members.ohiocityfarm.com/", "/", "https://members.ohiocityfarm.com/"],
    ["https://members.ohiocityfarm.com", "/account", "https://members.ohiocityfarm.com/account"],
    ["https://members.ohiocityfarm.com/", "/account", "https://members.ohiocityfarm.com/account"],
  ])("AC7: siteLink(%j, %j) has one slash between the two", (siteUrl, path, link) => {
    expect(siteLink(siteUrl, path)).toBe(link);
  });
});

// Issue 151: the two emails closing a week sends, one subject key between them. `{week}` is the week's title as the
// caller builds it (the close action's test holds that, app/admin/weeks/actions.test.ts). Their questions line is the
// signup confirmation's key, rendered through a template's `closing` after the body; the templates above, with none,
// render as their tests hold.
describe("AC6 (issue 151) — renderEmail weekClosedCredit and weekClosedNoCharge", () => {
  const WEEK = "February 14 and 15";

  it.each(["weekClosedCredit", "weekClosedNoCharge"] as const)("AC6: %s in English carries the week in its subject and its body", (name) => {
    const { subject, text } = renderEmail(name, "en", { week: WEEK }, SITE_URL);
    expect(subject).toContain(WEEK);
    expect(text).toContain(WEEK);
  });

  it.each([
    ["weekClosedCredit", "email.weekClosedCredit.body"],
    ["weekClosedNoCharge", "email.weekClosedNoCharge.body"],
  ] as const)(
    "AC6: %s in the stand-in Spanish catalog is only catalog values: the shared subject key, its body, the signup confirmation's questions line, the sign-off and the footer",
    (name, body) => {
      expect(renderEmail(name, "es", { week: WEEK }, SITE_URL)).toEqual({
        subject: "«email.weekClosed.subject»",
        text: `«${body}»\n\n«email.signupConfirmation.questions»\n\n«email.signOff»\n\n${STAND_IN_FOOTER}`,
      });
    },
  );
});

// Issue 150: the receipt for a week a week credit paid. Its subject is the receipt's, its closing the receipt's; only
// its body is its own. `{week}` is the week's title as the charge run builds it (src/charge-run.test.ts holds that).
describe("AC3 (issue 150) — renderEmail weekCreditReceipt", () => {
  const WEEK = "February 14 and 15";

  it("AC3: weekCreditReceipt in English carries the week in its body", () => {
    expect(renderEmail("weekCreditReceipt", "en", { week: WEEK }, SITE_URL).text).toContain(WEEK);
  });

  it("AC3: weekCreditReceipt in the stand-in Spanish catalog is only catalog values: the receipt's subject key, its own body, the questions line, the sign-off and the footer", () => {
    expect(renderEmail("weekCreditReceipt", "es", { week: WEEK }, SITE_URL)).toEqual({
      subject: "«email.receipt.subject»",
      text: `«email.weekCreditReceipt.body»\n\n«email.signupConfirmation.questions»\n\n«email.signOff»\n\n${STAND_IN_FOOTER}`,
    });
  });
});

// Issue 135: the email a decline sends; src/charge-run.test.ts holds that the run sends it as rendered. Here, which keys
// the template reads.
describe("AC3 (issue 135) — renderEmail cardDeclined", () => {
  it("AC3: cardDeclined in the stand-in Spanish catalog is only catalog values: its own subject and body, the signup confirmation's questions line, the sign-off and the footer", () => {
    expect(renderEmail("cardDeclined", "es", { week: "February 14 and 15", amount: "$50", link: "https://members.example.test/account" }, SITE_URL)).toEqual({
      subject: "«email.cardDeclined.subject»",
      text: `«email.cardDeclined.body»\n\n«email.signupConfirmation.questions»\n\n«email.signOff»\n\n${STAND_IN_FOOTER}`,
    });
  });
});

// Issue 196: the email a locked week sends; src/charge-run.test.ts holds that the run sends it as rendered. Here, which
// keys the template reads.
describe("AC3 (issue 196) — renderEmail cardLocked", () => {
  it("AC3: cardLocked in the stand-in Spanish catalog is only catalog values: its own subject and body, the signup confirmation's questions line, the sign-off and the footer", () => {
    expect(renderEmail("cardLocked", "es", { week: "February 14 and 15", link: "https://members.example.test/account" }, SITE_URL)).toEqual({
      subject: "«email.cardLocked.subject»",
      text: `«email.cardLocked.body»\n\n«email.signupConfirmation.questions»\n\n«email.signOff»\n\n${STAND_IN_FOOTER}`,
    });
  });
});

// Issue 141: the menu email and the missing-menu email; src/menu-run.test.ts holds that the run sends them as rendered.
// Here, that each is only catalog values, and the line the menu email alone puts between the sign-off and the footer.
describe("AC5, AC6 (issue 141) — renderEmail menuEmail and missingMenu", () => {
  /** Every value a stand-in of its own, so a render that writes a word itself shows it beside them. */
  const MENU_VALUES = {
    heading: "⟦heading⟧",
    menus: "⟦menus⟧",
    meals: "⟦meals⟧",
    pickupLine: "⟦pickupLine⟧",
    date: "⟦date⟧",
    link: "⟦link⟧",
    offLink: "⟦offLink⟧",
  };
  const MISSING_VALUES = { weeks: "⟦weeks⟧", weekday: "⟦weekday⟧", link: "⟦link⟧" };

  /** What is left of a stand-in Spanish render once its catalog values and the values given are taken out: nothing but space. */
  const leftOver = (text: string, values: Record<string, string>): string =>
    Object.values(values)
      .reduce((rest, value) => rest.split(value).join(""), text)
      .replace(/«[\w.]+»/g, "")
      .trim();

  it("AC5: menuEmail in the stand-in Spanish catalog is only catalog values and the values given: its subject a key, nothing written by the template", () => {
    const { subject, text } = renderEmail("menuEmail", "es", MENU_VALUES, SITE_URL);
    expect(subject).toMatch(/^«[\w.]+»$/);
    expect(leftOver(text, MENU_VALUES)).toBe("");
  });

  it("AC5: menuEmail puts one line of its own between the sign-off and the legal footer", () => {
    const { text } = renderEmail("menuEmail", "es", MENU_VALUES, SITE_URL);
    expect(text).toMatch(/«email\.signOff»\n+«[\w.]+»\n+«email\.legalTerms»\n«email\.legalPrivacy»$/);
  });

  it("AC6: missingMenu in the stand-in Spanish catalog is only catalog values and the values given: its subject a key, nothing written by the template", () => {
    const { subject, text } = renderEmail("missingMenu", "es", MISSING_VALUES, SITE_URL);
    expect(subject).toMatch(/^«[\w.]+»$/);
    expect(leftOver(text, MISSING_VALUES)).toBe("");
    expect(text.endsWith(`«email.signOff»\n\n${STAND_IN_FOOTER}`)).toBe(true);
  });
});
