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
const FOOTER = "Terms: https://members.example.test/terms\nPrivacy: https://members.example.test/privacy";
const STAND_IN_FOOTER = "«email.legalTerms»\n«email.legalPrivacy»";

describe("AC5 (issue 9) — renderEmail", () => {
  it('AC5: signInCode in English returns exactly the subject and the body, a blank line, then the sign-off, a blank line and the footer', () => {
    expect(renderEmail("signInCode", "en", { code: "042517", minutes: 10 }, SITE_URL)).toEqual({
      subject: "Your OCF Member Portal sign-in code",
      text:
        "Your sign-in code is 042517.\n\n" +
        "It expires in 10 minutes. If you didn't ask for it, you can ignore this email.\n\n" +
        "— Ohio City Farm\n\n" +
        FOOTER,
    });
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

  it("AC15: signInLink in English returns exactly the subject and the body with the link and minutes, a blank line, then the sign-off, a blank line and the footer", () => {
    expect(renderEmail("signInLink", "en", { link: LINK, minutes: 10 }, SITE_URL)).toEqual({
      subject: "Your OCF Member Portal sign-in link",
      text:
        "Too many wrong codes were entered for your account, so sign-in by code is paused for up to 24 hours.\n\n" +
        "Use this link to sign in instead:\n" +
        `${LINK}\n\n` +
        "It works once and expires in 10 minutes. If you didn't try to sign in, you can ignore this email.\n\n" +
        "— Ohio City Farm\n\n" +
        FOOTER,
    });
  });

  it("AC15: signInLink in the stand-in Spanish catalog returns only catalog values — nothing the template wrote itself", () => {
    expect(renderEmail("signInLink", "es", { link: LINK, minutes: 10 }, SITE_URL)).toEqual({
      subject: "«email.signInLink.subject»",
      text: `«email.signInLink.body»\n\n«email.signOff»\n\n${STAND_IN_FOOTER}`,
    });
  });
});

describe("AC4 (issue 58) — withSignOff", () => {
  it("AC4: it gives the body, a blank line, then the sign-off", () => {
    expect(withSignOff(createTranslator("en"), "The body.\nIts second line.")).toBe("The body.\nIts second line.\n\n— Ohio City Farm");
  });

  it("AC4: the sign-off comes from the translator it is handed", () => {
    expect(withSignOff(createTranslator("es"), "The body.")).toBe("The body.\n\n«email.signOff»");
  });
});

describe("AC7 (issue 63) — legalFooter", () => {
  it.each([SITE_URL, `${SITE_URL}/`])("AC7: from a site address of %s it is the two lines, each link with one slash", (siteUrl) => {
    expect(legalFooter(createTranslator("en"), siteUrl)).toBe(FOOTER);
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
    expect(renderEmail(name, "en", values, "https://other.example.test/").text.endsWith(
      "\n\n— Ohio City Farm\n\nTerms: https://other.example.test/terms\nPrivacy: https://other.example.test/privacy",
    )).toBe(true);
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
  // Existing copy, read from the catalog rather than typed.
  const t = createTranslator("en");
  const CLOSE = `${t("email.signupConfirmation.questions")}\n\n${t("email.signOff")}\n\n${FOOTER}`;

  it("AC6: weekClosedCredit in English is exactly the subject and the body, a blank line, the questions line, a blank line, the sign-off, a blank line and the footer", () => {
    expect(renderEmail("weekClosedCredit", "en", { week: WEEK }, SITE_URL)).toEqual({
      subject: "No Supper Club pickup February 14 and 15",
      text: `The farm is closed February 14 and 15: there is no pickup. You already paid for this week, so you have a week credit.\n\n${CLOSE}`,
    });
  });

  it("AC6: weekClosedNoCharge in English has the same subject and its own body, then the same lines", () => {
    expect(renderEmail("weekClosedNoCharge", "en", { week: WEEK }, SITE_URL)).toEqual({
      subject: "No Supper Club pickup February 14 and 15",
      text: `The farm is closed February 14 and 15: there is no pickup, and you won't be charged for it.\n\n${CLOSE}`,
    });
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
// its body is its own, new copy typed here once. `{week}` is the week's title as the charge run builds it
// (src/charge-run.test.ts holds that).
describe("AC3 (issue 150) — renderEmail weekCreditReceipt", () => {
  const WEEK = "February 14 and 15";
  // Existing copy, read from the catalog rather than typed.
  const t = createTranslator("en");
  const CLOSE = `${t("email.signupConfirmation.questions")}\n\n${t("email.signOff")}\n\n${FOOTER}`;

  it("AC3: weekCreditReceipt in English is the receipt's subject, then the body saying the week credit was used and not charged, the questions line, the sign-off and the footer", () => {
    expect(renderEmail("weekCreditReceipt", "en", { week: WEEK }, SITE_URL)).toEqual({
      subject: t("email.receipt.subject", { week: WEEK }),
      text: `Your week credit was used for your Supper Club pickup February 14 and 15: not charged.\n\n${CLOSE}`,
    });
  });

  it("AC3: weekCreditReceipt in the stand-in Spanish catalog is only catalog values: the receipt's subject key, its own body, the questions line, the sign-off and the footer", () => {
    expect(renderEmail("weekCreditReceipt", "es", { week: WEEK }, SITE_URL)).toEqual({
      subject: "«email.receipt.subject»",
      text: `«email.weekCreditReceipt.body»\n\n«email.signupConfirmation.questions»\n\n«email.signOff»\n\n${STAND_IN_FOOTER}`,
    });
  });
});
