// Issue 156: Your details, `await YourDetails({ searchParams })` with `next/headers` faked and the composition root
// mocked, as app/account/cancel/page.test.ts renders its page. The form and the code step share one address: the code
// step shows while the member has a pending change that has not expired. Who is let in is requireSubscriber's; what the
// forms do is ./actions.test.ts's; the code step's own parts are app/sign-in/code-step.test.ts's, and the header's
// links app/site-header.test.ts's. Here each of the page's branches goes through once. The words this task adds are
// typed once here; the words it reuses are read from the catalog.
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryRepository } from "@core/adapters/in-memory-repository.js";
import { createTranslator, type Language } from "@core/i18n.js";
import type { Member } from "@core/members.js";
import { en } from "@core/messages/en.js";
import type { ProductWithOptions } from "@core/products.js";
import { hashCode } from "@core/sign-in/code.js";
import { signSession } from "@core/sign-in/session.js";
import { Button } from "../../../components/ui/button";
import { Notice } from "../../../components/ui/notice";
import { addSupperClub } from "../../admin/subscribers-fixture";
import { emptyRequest } from "../../next-headers-fake";
import { alertTexts, attributesOf, findAll, inOrder, redirectOf, textsOf } from "../../screen-test-helpers";
import { SiteHeader } from "../../site-header";
import { confirmEmailChange, keepOldEmail, resendEmailChange, saveDetails } from "./actions";
import YourDetails from "./page";

const request = vi.hoisted(() => ({ current: { cookies: {}, headers: {}, sets: [] } as import("../../next-headers-fake").RequestState }));
const services = vi.hoisted(() => ({
  repo: undefined as unknown as import("@core/adapters/in-memory-repository.js").InMemoryRepository,
  secret: "test-session-secret-that-is-long-enough-0123456789",
}));

vi.mock("next/headers", async () => {
  const { fakeNextHeaders } = await import("../../next-headers-fake");
  return {
    cookies: () => fakeNextHeaders(request.current).cookies(),
    headers: () => fakeNextHeaders(request.current).headers(),
  };
});
vi.mock("next/navigation", async () => ({ redirect: (await import("../../screen-test-helpers")).throwingRedirect }));
vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("../../services", () => ({
  getRepository: () => services.repo,
  getEmail: () => {
    throw new Error("/account/details has no reason to send email");
  },
  getPayments: () => {
    throw new Error("/account/details has no reason to reach Square");
  },
  getSessionSecret: () => services.secret,
}));
vi.mock("../../site-header", () => ({ SiteHeader: vi.fn(async () => createElement("header", null, "the header")) }));
vi.mock("./actions", () => ({
  saveDetails: async () => {},
  confirmEmailChange: async () => {},
  resendEmailChange: async () => {},
  keepOldEmail: async () => {},
}));

// Wednesday, February 3, 2027, noon in Cleveland.
const NOW = new Date("2027-02-03T17:00:00.000Z");
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const OLD = "ada@example.com";
const NEW = "ada.new@example.com";
const DRAFT = "ocf_account_draft";

const t = createTranslator("en");

// This task's words.
const CODE_TITLE = "Check your new email";
const CODE_SENT = `We sent a 6-digit code to ${NEW}. Enter it to confirm the change. Until then you sign in with the old address.`;
const KEEP_OLD = "Keep the old email";
const SAVED = "Saved. Your details are up to date.";
const INVALID = "That code didn't match, or it has expired. Check it and try again, or send a new code.";
const SQUARE = "We couldn't update your email just now. Try the code again in a minute.";

let product: ProductWithOptions;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  request.current = emptyRequest();
  services.repo = new InMemoryRepository();
  product = addSupperClub(services.repo);
  vi.mocked(SiteHeader).mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

/** Ada, through Create Account, with an active Supper Club subscription and signed in; her email language is `language`. */
const ada = async (language: Language = "en"): Promise<Member> => {
  const repo = services.repo;
  const member = await repo.saveAccount({ email: OLD, firstName: "Ada", lastName: "Lovelace", phone: "(216) 555-0134", language });
  await repo.confirmMemberEmail(member.id, new Date("2026-12-01T17:00:00.000Z"));
  const signup = await repo.savePendingSignup({
    memberId: member.id,
    productId: product.id,
    choices: Object.fromEntries(product.optionTypes.map((type) => [type.id, type.options[0]?.id ?? "no such option"])),
    firstChargeCents: 8000,
    weeklyCents: 8000,
    pickupDate: "2027-01-03",
    consentText: "I agree to a weekly charge of $80.",
    consentAt: new Date("2026-12-01T17:00:00.000Z"),
  });
  await repo.confirmSignupRows(signup.ledgerId, `PAYMENT_${signup.ledgerId}`, signup.amountCents, new Date("2026-12-01T17:00:05.000Z"));
  request.current.cookies.ocf_session = signSession({ subjectId: member.id, expiresAt: new Date(NOW.getTime() + DAY).toISOString() }, services.secret);
  return member;
};

/** A change to `NEW` pending for the member, requested `ago` ms before now. */
const pending = (member: Member, ago = MINUTE) =>
  services.repo.startEmailChange({ memberId: member.id, newEmail: NEW, codeHash: hashCode("123456"), now: new Date(NOW.getTime() - ago) });

type Query = { saved?: string; error?: string; sent?: string; limited?: string };

const render = async (query: Query = {}): Promise<{ element: ReactElement; html: string }> => {
  const element = (await YourDetails({ searchParams: Promise.resolve(query) })) as ReactElement;
  return { element, html: renderToStaticMarkup(element) };
};

/** Each input's value, by name. */
const valuesOf = (html: string): Record<string, string | undefined> =>
  Object.fromEntries(attributesOf(html, "input").map((input) => [input.name ?? "", input.value]));
const selectedLanguages = (html: string) => attributesOf(html, "option").filter((option) => "selected" in option).map((option) => option.value);
const actionsOf = (element: ReactElement) => findAll(element, "form").map((form) => form.props.action);
const noticeIcons = (element: ReactElement) => findAll(element, Notice).map((notice) => notice.props.icon);

describe("AC1 (issue 156) — reaching /account/details", () => {
  it("AC1: a signed-out visitor is sent to /sign-in", async () => {
    await expect(redirectOf(YourDetails({ searchParams: Promise.resolve({}) }))).resolves.toBe("/sign-in");
  });

  it('AC1: the header marks Your details as the page showing', async () => {
    await ada();
    await render();
    expect(SiteHeader).toHaveBeenCalledWith(expect.objectContaining({ current: "details" }));
  });
});

describe("AC2 (issue 156) — the form opens filled", () => {
  it("AC2: first name, last name, email and phone hold the member's, and language for emails is theirs", async () => {
    await ada("es");
    const { html } = await render();
    expect(valuesOf(html)).toMatchObject({ firstName: "Ada", lastName: "Lovelace", email: OLD, phone: "(216) 555-0134" });
    expect(selectedLanguages(html)).toEqual(["es"]);
  });

  it("AC2, AC3: the form posts to saveDetails", async () => {
    await ada();
    expect(actionsOf((await render()).element)).toEqual([saveDetails]);
  });
});

describe("AC3 (issue 156) — the Saved notice", () => {
  it(`AC3: with saved=1 the page shows "${SAVED}" in a check Notice, above the form`, async () => {
    await ada();
    const { element, html } = await render({ saved: "1" });
    expect(alertTexts(html)).toEqual([SAVED]);
    expect(noticeIcons(element)).toEqual(["check"]);
    expect(inOrder(html, [en["account.details"], SAVED, en["createAccount.firstName"]])).toEqual([en["account.details"], SAVED, en["createAccount.firstName"]]);
  });

  it("AC3: without saved there is no notice, which guards the one above", async () => {
    await ada();
    const { html } = await render();
    expect(textsOf(html)).toContain(en["account.details"]);
    expect(alertTexts(html)).toEqual([]);
  });
});

describe("AC4 (issue 156) — a save that broke a rule", () => {
  it("AC4: with error=firstName the field shows Create Account's error line and is marked invalid, and the form holds what was typed", async () => {
    await ada();
    request.current.cookies[DRAFT] = JSON.stringify({ firstName: "", lastName: "Byron", email: OLD, phone: "216-555-0199", language: "en" });
    const { html } = await render({ error: "firstName" });
    expect(textsOf(html)).toContain(en["createAccount.error.firstName"]);
    expect(attributesOf(html, "input").find((input) => input.name === "firstName")).toMatchObject({ "aria-invalid": "true" });
    expect(valuesOf(html)).toMatchObject({ firstName: "", lastName: "Byron", phone: "216-555-0199" });
  });

  // Review of commit f65a2b3: the draft cookie lives ten minutes, so a member can come back to an error with none.
  it("AC4: with error=firstName and no draft cookie (expired), the form holds the member's stored details, not blank fields", async () => {
    await ada("es");
    const { html } = await render({ error: "firstName" });
    expect(valuesOf(html)).toMatchObject({ firstName: "Ada", lastName: "Lovelace", email: OLD, phone: "(216) 555-0134" });
    expect(selectedLanguages(html)).toEqual(["es"]);
  });
});

describe("AC5 (issue 156) — the page's language", () => {
  it("AC5: a member whose emails are in Español sees the page in the request's language, English", async () => {
    await ada("es");
    const { html } = await render();
    expect(textsOf(html)).toEqual(expect.arrayContaining([en["account.details"], en["createAccount.firstName"]]));
  });
});

describe("AC7 (issue 156) — the code step", () => {
  it("AC7: with a change pending, the step reads Keep the old email, the heading, the sentence naming the new address, the code field, Confirm email, the spam hint and Send a new code", async () => {
    const member = await ada();
    await pending(member);
    const { html } = await render();
    const order = [KEEP_OLD, CODE_TITLE, CODE_SENT, en["signIn.codeLabel"], en["createAccount.confirm"], en["createAccount.spam"], en["signIn.resend"]];
    expect(inOrder(html, order)).toEqual(order);
  });

  it("AC7: the code step stands in place of the form: no field holds the member's details", async () => {
    const member = await ada();
    await pending(member);
    const { html } = await render();
    expect(textsOf(html)).toContain(CODE_TITLE);
    expect(Object.keys(valuesOf(html)).filter((name) => ["firstName", "lastName", "email", "phone"].includes(name))).toEqual([]);
  });
});

describe("AC10 (issue 156) — confirming", () => {
  it("AC10: the code form posts to confirmEmailChange", async () => {
    const member = await ada();
    await pending(member);
    expect(actionsOf((await render()).element)).toContain(confirmEmailChange);
  });
});

describe("AC11 (issue 156) — Square refused", () => {
  it(`AC11: with error=square the code step shows "${SQUARE}" in an alert Notice`, async () => {
    const member = await ada();
    await pending(member);
    const { element, html } = await render({ error: "square" });
    expect(alertTexts(html)).toEqual([SQUARE]);
    expect(noticeIcons(element)).toEqual(["alert"]);
    expect(textsOf(html)).toContain(CODE_TITLE);
  });
});

describe("AC12 (issue 156) — a wrong or expired code", () => {
  it("AC12: with error=invalid the code step shows its own wrong-code line, never sign-in's", async () => {
    const member = await ada();
    await pending(member);
    expect(alertTexts((await render({ error: "invalid" })).html)).toEqual([INVALID]);
  });
});

describe("AC13 (issue 156) — Send a new code and the wait notice", () => {
  it("AC13: Send a new code posts to resendEmailChange", async () => {
    const member = await ada();
    await pending(member);
    expect(actionsOf((await render()).element)).toContain(resendEmailChange);
  });

  it("AC13: with sent=1 the code step says a new code is on its way", async () => {
    const member = await ada();
    await pending(member);
    expect(alertTexts((await render({ sent: "1" })).html)).toEqual([en["signIn.resent"]]);
  });

  it("AC13: with limited=5 and a change pending, the code step shows sign-in's wait notice in a lock Notice", async () => {
    const member = await ada();
    await pending(member);
    const { element, html } = await render({ limited: "5" });
    expect(alertTexts(html)).toEqual([t("signIn.limited.other", { minutes: 5 })]);
    expect(noticeIcons(element)).toEqual(["lock"]);
    expect(textsOf(html)).toContain(CODE_TITLE);
  });

  it("AC13: with limited=5 and no change pending, the form shows sign-in's wait notice in a lock Notice", async () => {
    await ada();
    const { element, html } = await render({ limited: "5" });
    expect(alertTexts(html)).toEqual([t("signIn.limited.other", { minutes: 5 })]);
    expect(noticeIcons(element)).toEqual(["lock"]);
    expect(valuesOf(html)).toMatchObject({ email: OLD });
  });
});

describe("AC14 (issue 156) — Keep the old email", () => {
  it("AC14: it is a quiet submit Button with the back arrow, alone in a form posting to keepOldEmail, before the heading", async () => {
    const member = await ada();
    await pending(member);
    const { element, html } = await render();
    const keep = findAll(element, "form").find((form) => form.props.action === keepOldEmail);
    const buttons = findAll(keep, Button);
    expect(buttons.map((button) => button.props)).toEqual([expect.objectContaining({ kind: "quiet", back: true, type: "submit", children: KEEP_OLD })]);
    expect(inOrder(html, [KEEP_OLD, CODE_TITLE])).toEqual([KEEP_OLD, CODE_TITLE]);
    expect(attributesOf(html, "a")).toEqual([]);
  });
});

// Issue 141: the menu email checkbox. Its words are new copy, typed once here; the Language field's label and Save are
// read from the catalog. What Save stores is ./actions.test.ts's.
describe("AC9 (issue 141) — Email me the weekly menu", () => {
  const LABEL = "Email me the weekly menu";
  const HINT = "Sign-in codes, receipts and card notices always send.";

  /** The form's menuEmails field: whether it is there, a checkbox, and ticked. */
  const menuBox = (html: string) => {
    const input = attributesOf(html, "input").find((candidate) => candidate.name === "menuEmails");
    return { present: input !== undefined, type: input?.type, checked: input !== undefined && "checked" in input };
  };

  it("AC9: after the Language field and before Save, the form has the checkbox with its hint, ticked for a member whose menu emails are on", async () => {
    await ada();
    const { html } = await render();
    const order = [en["createAccount.language"], LABEL, HINT, en["details.save"]];
    expect(inOrder(html, order)).toEqual(order);
    expect(menuBox(html)).toEqual({ present: true, type: "checkbox", checked: true });
  });

  it("AC9: for a member whose menu emails are off it is not ticked", async () => {
    const member = await ada();
    await services.repo.setMenuEmails(member.id, false);
    expect(menuBox((await render()).html)).toEqual({ present: true, type: "checkbox", checked: false });
  });

  it("AC9: the checkbox is in the form that posts to saveDetails", async () => {
    await ada();
    const { element } = await render();
    const save = findAll(element, "form").find((form) => form.props.action === saveDetails);
    expect(menuBox(renderToStaticMarkup(createElement("div", null, save))).present).toBe(true);
  });
});

describe("AC20 (issue 156) — a pending change is stored", () => {
  it("AC20: a member who comes back nine minutes after asking sees the code step again", async () => {
    const member = await ada();
    await pending(member, 9 * MINUTE);
    expect(textsOf((await render()).html)).toEqual(expect.arrayContaining([CODE_TITLE, CODE_SENT]));
  });

  it("AC20: after the code has expired they see the form with the old address", async () => {
    const member = await ada();
    await pending(member, 11 * MINUTE);
    const { html } = await render();
    expect(textsOf(html)).not.toContain(CODE_TITLE);
    expect(valuesOf(html)).toMatchObject({ email: OLD });
  });
});
