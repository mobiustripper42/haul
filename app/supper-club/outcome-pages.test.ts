// Issue 56, AC5 and AC13: /supper-club/done and /supper-club/already, each `await Page()` rendered through
// react-dom/server with `next/headers` faked and the composition root handing out an InMemoryRepository.
// A width's effect is measured in e2e/supper-club.spec.ts; these hold what each page says and who reaches it.
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryRepository } from "@core/adapters/in-memory-repository.js";
import type { Member } from "@core/members.js";
import type { ProductWithOptions } from "@core/products.js";
import { signSession } from "@core/sign-in/session.js";
import { Card } from "../../components/ui/card";
import { Shell } from "../../components/ui/shell";
import { emptyRequest } from "../next-headers-fake";
import { ACCOUNT_PATH } from "../paths";
import { attributesOf, findAll, redirectOf, screenMarkup, utilitiesOf } from "../screen-test-helpers";
import SupperClubAlready from "./already/page";
import SupperClubDone from "./done/page";
import { SUPPER_CLUB_ALREADY_PATH, SUPPER_CLUB_DONE_PATH, SUPPER_CLUB_PATH } from "./paths";

const request = vi.hoisted(() => ({ current: { cookies: {}, headers: {}, sets: [] } as import("../next-headers-fake").RequestState }));
const services = vi.hoisted(() => ({
  repo: undefined as unknown as import("@core/adapters/in-memory-repository.js").InMemoryRepository,
  secret: "test-session-secret-that-is-long-enough-0123456789",
}));
vi.mock("next/headers", async () => {
  const { fakeNextHeaders } = await import("../next-headers-fake");
  return {
    cookies: () => fakeNextHeaders(request.current).cookies(),
    headers: () => fakeNextHeaders(request.current).headers(),
  };
});
vi.mock("next/navigation", async () => ({ redirect: (await import("../screen-test-helpers")).throwingRedirect }));
vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("../services", () => ({ getRepository: () => services.repo, getSessionSecret: () => services.secret }));

const NOW = new Date("2026-11-06T15:00:00.000Z");
const EMAIL = "ada@example.com";
const TITLE = "You're in the Supper Club";
const ALREADY = "You already have a Supper Club box";

let product: ProductWithOptions;

beforeEach(() => {
  request.current = emptyRequest();
  services.repo = new InMemoryRepository();
  product = services.repo.addProduct({
    name: "Supper Club",
    cap: 50,
    firstPickupDate: "2027-01-03",
    cutoffWeekday: 1,
    cutoffTime: "24:00:00",
    optionTypes: [
      {
        name: "How many people?",
        position: 1,
        options: [
          { name: "3–4 people", priceCents: 8000, position: 1 },
          { name: "2 people", priceCents: 5000, position: 2 },
        ],
      },
      {
        name: "Which menu?",
        position: 2,
        options: [
          { name: "Standard", priceCents: 0, position: 1 },
          { name: "Vegan", priceCents: 0, position: 2 },
        ],
      },
    ],
  });
});

/** A member, signed in by cookie; `firstName` null is one who never went through Create Account. */
const signIn = async (firstName: string | null = "Ada"): Promise<Member> => {
  const member =
    firstName === null
      ? await services.repo.createMember({ email: EMAIL })
      : await services.repo.saveAccount({ email: EMAIL, firstName, lastName: "Lovelace", phone: "216-555-0100", language: "en" });
  await services.repo.confirmMemberEmail(member.id, NOW);
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  request.current.cookies = { ocf_session: signSession({ subjectId: member.id, expiresAt }, services.secret) };
  return member;
};

const save = (member: Member, amounts: { firstChargeCents: number; weeklyCents: number } = { firstChargeCents: 8000, weeklyCents: 8000 }) => {
  const [sizes, menus] = product.optionTypes;
  return services.repo.savePendingSignup({
    memberId: member.id,
    productId: product.id,
    choices: { [sizes?.id ?? ""]: sizes?.options[0]?.id ?? "", [menus?.id ?? ""]: menus?.options[1]?.id ?? "" },
    ...amounts,
    pickupDate: "2027-01-03",
    consentText: "I agree.",
    consentAt: NOW,
  });
};

const subscribe = async (member: Member, amounts?: { firstChargeCents: number; weeklyCents: number }) => {
  const { ledgerId, amountCents } = await save(member, amounts);
  await services.repo.confirmSignupRows(ledgerId, "PAYMENT_1", amountCents, NOW);
};

/** The words as a person reads them: tags gone, whitespace collapsed. */
const plain = (html: string) =>
  screenMarkup(html)
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .replace(/ ([.,])/g, "$1")
    .trim();

/** What a page shows from `from` on, so the left column's copy stays out of it. */
const from = (text: string, start: string) => text.slice(Math.max(text.indexOf(start), 0));

const inOrder = (text: string, wanted: string[]) => {
  let at = 0;
  const missing: string[] = [];
  for (const words of wanted) {
    const found = text.indexOf(words, at);
    if (found === -1) missing.push(words);
    else at = found + words.length;
  }
  return missing;
};

const linkTo = (html: string, text: string) => new RegExp(`<a\\b([^>]*)>\\s*${text}\\s*</a>`).exec(screenMarkup(html))?.[1] ?? "";

describe("the paths", () => {
  it("AC13: the confirmation is at /supper-club/done", () => {
    expect(SUPPER_CLUB_DONE_PATH).toBe("/supper-club/done");
  });

  it("AC5: the already-a-member page is at /supper-club/already", () => {
    expect(SUPPER_CLUB_ALREADY_PATH).toBe("/supper-club/already");
  });

  it("AC13: ACCOUNT_PATH is /, as the header's link is, until task 2.4", () => {
    expect(ACCOUNT_PATH).toBe("/");
  });
});

describe.each([
  ["/supper-club/done", SupperClubDone],
  ["/supper-club/already", SupperClubAlready],
] as const)("who reaches %s", (path, Page) => {
  it(`AC13: a signed-out visitor on ${path} goes to /supper-club`, async () => {
    expect(await redirectOf(Page())).toBe(SUPPER_CLUB_PATH);
  });

  it(`AC13: a member with no subscription on ${path} goes to /supper-club`, async () => {
    await signIn();
    expect(await redirectOf(Page())).toBe(SUPPER_CLUB_PATH);
  });

  it(`AC13: a member with only a pending row on ${path} goes to /supper-club`, async () => {
    await save(await signIn());
    expect(await redirectOf(Page())).toBe(SUPPER_CLUB_PATH);
  });

  it(`AC5, AC13: a member whose only box is for another product on ${path} goes to /supper-club`, async () => {
    const member = await signIn();
    const crate = services.repo.addProduct({ ...product, name: "Crate" });
    const { ledgerId, amountCents } = await services.repo.savePendingSignup({
      memberId: member.id,
      productId: crate.id,
      choices: Object.fromEntries(crate.optionTypes.map((type) => [type.id, type.options[0]?.id ?? ""])),
      firstChargeCents: 8000,
      weeklyCents: 8000,
      pickupDate: "2027-01-03",
      consentText: "I agree.",
      consentAt: NOW,
    });
    await services.repo.confirmSignupRows(ledgerId, "PAYMENT_1", amountCents, NOW);
    expect(await redirectOf(Page())).toBe(SUPPER_CLUB_PATH);
  });
});

describe("AC13 — the confirmation", () => {
  const render = async () => {
    const element = await SupperClubDone();
    return { element, html: renderToStaticMarkup(element) };
  };

  it("AC13: it reads as the frames do, in order", async () => {
    await subscribe(await signIn());
    const text = from(plain((await render()).html), TITLE);
    expect(
      inOrder(text, [
        TITLE,
        `Thank you, Ada. We emailed a confirmation to ${EMAIL}.`,
        "Your box",
        "3–4 people",
        "Vegan",
        "Paid today",
        "$80",
        "for your first week",
        "Then",
        "$80",
        "every week, at the cutoff",
        "First pickup: Sunday, January 3",
        "Sunday or Monday at the farm store, 2304 Bridge Ave. Give your name at the counter.",
        "What happens next",
        "Each week we email you the menu.",
        "Your card is charged $80 at the end of each Monday for the following week's pickup.",
        "To skip a week, change your box or cancel, sign in to your account before the end of Monday.",
        "Go to your account",
        "Back to ohiocityfarm.com",
      ]),
    ).toEqual([]);
  });

  it("AC13: Paid today is the first charge, and Then the weekly price", async () => {
    await subscribe(await signIn(), { firstChargeCents: 7000, weeklyCents: 8000 });
    const text = from(plain((await render()).html), TITLE);
    expect(inOrder(text, ["Paid today", "$70", "Then", "$80", "Your card is charged $80"])).toEqual([]);
  });

  it("AC13: Paid today and Then are capitals by class, as the option types' labels are", async () => {
    await subscribe(await signIn());
    const labels = [...screenMarkup((await render()).html).matchAll(/<dt\b[^>]*class="([^"]*)"[^>]*>([^<]*)<\/dt>/g)];
    const classOf = (words: string) => labels.find((label) => label[2] === words)?.[1];
    expect(utilitiesOf(classOf("Paid today"))).toContain("uppercase");
    expect(utilitiesOf(classOf("Then"))).toContain("uppercase");
  });

  it("AC13: the done mark opens it", async () => {
    await subscribe(await signIn());
    expect(screenMarkup((await render()).html)).toMatch(/<svg\b[^>]*aria-label="Done"[^>]*>[\s\S]*You're in the Supper Club/);
  });

  it('AC13: a member with no first name gets "Thank you. We emailed…"', async () => {
    await subscribe(await signIn(null));
    expect(plain((await render()).html)).toContain(`Thank you. We emailed a confirmation to ${EMAIL}.`);
  });

  it("AC13: the frames' placeholders are left out, not printed", async () => {
    await subscribe(await signIn());
    const text = from(plain((await render()).html), TITLE);
    expect(text).toContain("What happens next");
    expect(text).not.toContain("[");
    expect(text).not.toContain("Hours:");
  });

  it('AC13: "Go to your account" is primary and goes to ACCOUNT_PATH', async () => {
    await subscribe(await signIn());
    const { html } = await render();
    const link = attributesOf(html, "a").find((a) => a.class?.includes("btn-primary"));
    expect(link?.href).toBe("/");
    expect(linkTo(html, "Go to your account")).toContain("btn-primary");
  });

  it('AC13: "Back to ohiocityfarm.com" is quiet', async () => {
    await subscribe(await signIn());
    expect(utilitiesOf(/class="([^"]*)"/.exec(linkTo((await render()).html, "Back to ohiocityfarm.com"))?.[1])).toContain("btn-quiet");
  });

  it("AC13: one tree: each of \"Your box\" and \"What happens next\" is rendered once", async () => {
    await subscribe(await signIn());
    const text = plain((await render()).html);
    expect(text.split("Your box")).toHaveLength(2);
    expect(text.split("What happens next")).toHaveLength(2);
  });

  it("AC13: it stands on JoinPage's pane, the left column beside it", async () => {
    await subscribe(await signIn());
    const { element, html } = await render();
    expect(findAll(element, Shell).map((shell) => shell.props.width)).toEqual(["pane"]);
    expect(inOrder(plain(html), ["Weekly meals from the farm kitchen", TITLE])).toEqual([]);
  });
});

describe("AC5 — the already-a-member page", () => {
  const render = async () => {
    const element = await SupperClubAlready();
    return { element, html: renderToStaticMarkup(element) };
  };

  it("AC5: it says they already have a box, that nothing was charged, and links to their account, in that order", async () => {
    await subscribe(await signIn());
    const text = from(plain((await render()).html), ALREADY);
    expect(inOrder(text, [ALREADY, "Nothing was charged.", "Go to your account"])).toEqual([]);
  });

  it('AC5: "Go to your account" is primary and goes to ACCOUNT_PATH', async () => {
    await subscribe(await signIn());
    const link = linkTo((await render()).html, "Go to your account");
    expect(link).toContain('href="/"');
    expect(link).toContain("btn-primary");
  });

  it("AC5: it is a pane on JoinPage: the left column's card, then its own", async () => {
    await subscribe(await signIn());
    const { element, html } = await render();
    expect(findAll(element, Shell).map((shell) => shell.props.width)).toEqual(["pane"]);
    expect(findAll(element, Card).map((card) => card.props.width)).toEqual(["fill", "pane"]);
    expect(inOrder(plain(html), ["Weekly meals from the farm kitchen", ALREADY])).toEqual([]);
  });

  it("AC5: viewing it writes no event", async () => {
    await subscribe(await signIn());
    const { html } = await render();
    expect(plain(html)).toContain(ALREADY);
    expect(services.repo.events()).toEqual([]);
  });
});
