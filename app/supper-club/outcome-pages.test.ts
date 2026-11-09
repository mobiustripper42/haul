// Issue 56, AC5 and AC13: /supper-club/done and /supper-club/already, each `await Page()` rendered through
// react-dom/server with `next/headers` faked and the composition root handing out an InMemoryRepository.
// A width's effect is measured in e2e/supper-club.spec.ts; these hold what each page says and who reaches it.
// The words are read from the catalog; the member's own data (their choices, the amounts, the date) is typed.
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryRepository } from "@core/adapters/in-memory-repository.js";
import { createTranslator } from "@core/i18n.js";
import { en } from "@core/messages/en.js";
import type { Member } from "@core/members.js";
import type { ProductWithOptions } from "@core/products.js";
import { signSession } from "@core/sign-in/session.js";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { Shell } from "../../components/ui/shell";
import { emptyRequest } from "../next-headers-fake";
import { ACCOUNT_PATH } from "../paths";
import { findAll, inOrder, redirectOf, screenMarkup, textsOf } from "../screen-test-helpers";
import SupperClubAlready from "./already/page";
import SupperClubDone from "./done/page";
import { FARM_SITE_URL, SUPPER_CLUB_ALREADY_PATH, SUPPER_CLUB_DONE_PATH, SUPPER_CLUB_PATH } from "./paths";

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
const t = createTranslator("en");

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

/** The `Button` a page gives to `label`, found by its words. */
const buttonLabelled = (element: Parameters<typeof findAll>[0], label: string) =>
  findAll(element, Button).find((button) => button.props.children === label);

describe("the paths", () => {
  it("AC13: the confirmation is at /supper-club/done", () => {
    expect(SUPPER_CLUB_DONE_PATH).toBe("/supper-club/done");
  });

  it("AC5: the already-a-member page is at /supper-club/already", () => {
    expect(SUPPER_CLUB_ALREADY_PATH).toBe("/supper-club/already");
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

  it("AC13: it shows the title, thanks, subscription box, next steps and both buttons, in that order", async () => {
    await subscribe(await signIn());
    const wanted = [
      en["supperClub.done.title"],
      t("supperClub.done.thanks", { firstName: "Ada", email: EMAIL }),
      en["supperClub.box.title"],
      "3–4 people",
      "Vegan",
      en["supperClub.box.paidToday"],
      "$80",
      en["supperClub.box.firstWeek"],
      en["supperClub.box.then"],
      "$80",
      en["supperClub.box.everyWeek"],
      t("supperClub.box.firstPickup", { date: "Sunday, January 3" }),
      en["supperClub.box.pickupWhere"],
      en["supperClub.next.title"],
      en["supperClub.next.menu"],
      t("supperClub.next.charge", { price: "$80" }),
      en["supperClub.next.change"],
      en["supperClub.done.account"],
      en["supperClub.done.back"],
    ];
    expect(inOrder((await render()).html, wanted)).toEqual(wanted);
  });

  it("AC13: Paid today is the first charge, and Then the weekly price", async () => {
    await subscribe(await signIn(), { firstChargeCents: 7000, weeklyCents: 8000 });
    const wanted = [en["supperClub.box.paidToday"], "$70", en["supperClub.box.then"], "$80", t("supperClub.next.charge", { price: "$80" })];
    expect(inOrder((await render()).html, wanted)).toEqual(wanted);
  });

  it("AC13: the Done mark comes before the title", async () => {
    await subscribe(await signIn());
    const markup = screenMarkup((await render()).html);
    const mark = markup.indexOf(`aria-label="${en["supperClub.done.mark"]}"`);
    expect(mark).toBeGreaterThan(-1);
    expect(mark).toBeLessThan(markup.indexOf(en["supperClub.done.title"]));
  });

  it('AC13: a member with no first name gets "Thank you. We emailed…"', async () => {
    await subscribe(await signIn(null));
    expect(textsOf((await render()).html)).toContain(t("supperClub.done.thanksNoName", { email: EMAIL }));
  });

  it("AC13: the design's bracketed placeholders are left out, not printed", async () => {
    await subscribe(await signIn());
    // From the confirmation's title on, so the left column's own "[PICKUP HOURS]" stays out of it.
    const texts = textsOf((await render()).html);
    const text = texts.slice(texts.indexOf(en["supperClub.done.title"])).join(" ");
    expect(text).toContain(en["supperClub.next.title"]);
    expect(text).not.toContain("[");
  });

  it('AC13: "Go to your account" is primary and goes to ACCOUNT_PATH', async () => {
    await subscribe(await signIn());
    const { element } = await render();
    expect(buttonLabelled(element, en["supperClub.done.account"])?.props).toMatchObject({ kind: "primary", href: ACCOUNT_PATH });
  });

  it('AC13: "Back to ohiocityfarm.com" is quiet and goes to the farm site', async () => {
    await subscribe(await signIn());
    const { element } = await render();
    expect(buttonLabelled(element, en["supperClub.done.back"])?.props).toMatchObject({ kind: "quiet", href: FARM_SITE_URL });
  });

  it("AC13, AC17 (issue 57): the subscription box and next steps appear once each, not once per width", async () => {
    await subscribe(await signIn());
    const texts = textsOf((await render()).html);
    expect(texts.filter((text) => text === en["supperClub.box.title"])).toHaveLength(1);
    expect(texts.filter((text) => text === en["supperClub.next.title"])).toHaveLength(1);
  });

  it("AC13: it stands on JoinPage's pane shell", async () => {
    await subscribe(await signIn());
    const { element } = await render();
    expect(findAll(element, Shell).map((shell) => shell.props.width)).toEqual(["pane"]);
  });
});

describe("AC5 — the already-a-member page", () => {
  const render = async () => {
    const element = await SupperClubAlready();
    return { element, html: renderToStaticMarkup(element) };
  };

  // Issue 97, AC9: with / redirecting, "Go to your account" would only reload this page; it comes back
  // with the account pages in task 2.4. The confirmation keeps its button (above).
  it("AC9: its card says they already have a subscription, then that nothing was charged, and nothing more", async () => {
    await subscribe(await signIn());
    const texts = textsOf((await render()).html);
    expect(texts.slice(texts.indexOf(en["supperClub.already.title"]))).toEqual([
      en["supperClub.already.title"],
      en["supperClub.already.nothing"],
    ]);
  });

  it('AC9: it has no "Go to your account" link', async () => {
    await subscribe(await signIn());
    const { element, html } = await render();
    expect(buttonLabelled(element, en["supperClub.done.account"])).toBeUndefined();
    expect(textsOf(html)).not.toContain(en["supperClub.done.account"]);
  });

  it("AC5: it is a pane on JoinPage: its own card at the pane's width", async () => {
    await subscribe(await signIn());
    const { element } = await render();
    expect(findAll(element, Shell).map((shell) => shell.props.width)).toEqual(["pane"]);
    expect(findAll(element, Card).map((card) => card.props.width).at(-1)).toBe("pane");
  });

  it("AC5: viewing it writes no event", async () => {
    await subscribe(await signIn());
    await render();
    expect(services.repo.events()).toEqual([]);
  });
});

// Issue 101, AC7: the question mark is the pickers' (`supperClub.pickerLegend`), not the stored name's, so the
// confirmation's labels show the name as stored. The labels are drawn in capitals by their class.
describe("AC7 (issue 101) — the confirmation's labels are the stored names", () => {
  it('AC7: option types stored as "How many people" and "Which menu" label the box with those names, no question mark', async () => {
    services.repo = new InMemoryRepository();
    product = services.repo.addProduct({
      name: "Supper Club",
      cap: 50,
      firstPickupDate: "2027-01-03",
      cutoffWeekday: 1,
      cutoffTime: "24:00:00",
      optionTypes: [
        { name: "How many people", position: 1, options: [{ name: "3–4 people", priceCents: 8000, position: 1 }] },
        { name: "Which menu", position: 2, options: [{ name: "Standard", priceCents: 0, position: 1 }, { name: "Vegan", priceCents: 0, position: 2 }] },
      ],
    });
    await subscribe(await signIn());
    const html = renderToStaticMarkup(await SupperClubDone());
    const box = ["How many people", "3–4 people", "Which menu", "Vegan"];
    expect(inOrder(html, box)).toEqual(box);
    expect(inOrder(html, ["How many people?", "Which menu?"])).toEqual([]);
  });
});
