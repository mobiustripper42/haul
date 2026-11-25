// Issue 260: the Notice of a member with no active subscription, `noSupperClubNotice` called with the account requireAccount
// gives (./subscriber.test.ts), over an InMemoryRepository. Which Notice shows, or none, is a choice, so its lead and body are
// read by their catalog lines; the button by where it goes and its kind. The cancelled Notice's last pickup line is read
// through /account (./page.test.ts, issue 139). Where each page draws it is that page's.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryRepository } from "@core/adapters/in-memory-repository.js";
import { createTranslator } from "@core/i18n.js";
import type { Member } from "@core/members.js";
import type { ProductWithOptions } from "@core/products.js";
import { Button } from "../../components/ui/button";
import { Notice } from "../../components/ui/notice";
import { addSupperClub } from "../admin/subscribers-fixture";
import { findAll, textsOf } from "../screen-test-helpers";
import { noSupperClubNotice } from "./no-supper-club-notice";
import type { Account } from "./subscriber";

const services = vi.hoisted(() => ({ repo: undefined as unknown as import("@core/adapters/in-memory-repository.js").InMemoryRepository }));

vi.mock("next/headers", () => ({}));
vi.mock("next/navigation", async () => ({ redirect: (await import("../screen-test-helpers")).throwingRedirect }));
vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("../services", () => ({ getRepository: () => services.repo }));
vi.mock("../site-header", () => ({ SiteHeader: vi.fn(async () => createElement("header", null, "the header")) }));

const NOW = new Date("2027-02-03T17:00:00.000Z");
const t = createTranslator("en");

let product: ProductWithOptions;
let member: Member;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  services.repo = new InMemoryRepository();
  product = addSupperClub(services.repo);
  member = await services.repo.createMember({ email: "ada@example.com" });
});

afterEach(() => {
  vi.useRealTimers();
});

/** Ada's signup, paid for January 3; its subscription's id. */
const subscribe = async (): Promise<string> => {
  const rows = await services.repo.savePendingSignup({
    memberId: member.id,
    productId: product.id,
    choices: Object.fromEntries(product.optionTypes.map((type) => [type.id, type.options[0]?.id ?? "no such option"])),
    firstChargeCents: 4500,
    weeklyCents: 4500,
    pickupDate: "2027-01-03",
    consentText: "I agree to a weekly charge of $45.",
    consentAt: new Date("2026-12-01T17:00:00.000Z"),
  });
  await services.repo.confirmSignupRows(rows.ledgerId, `PAYMENT_${rows.ledgerId}`, rows.amountCents, new Date("2026-12-01T17:00:05.000Z"));
  return rows.subscriptionId;
};

const account = async (): Promise<Account> => ({ member, product, confirmation: await services.repo.findMemberSubscription(member.id, product.id) });

/** The Notice Ada gets: its icon and lead, its text runs, and its action's buttons by kind and destination. */
const noticeOf = async () => {
  const element = await noSupperClubNotice(await account(), t, "en", NOW);
  const [notice, ...more] = findAll(element, Notice);
  expect(more).toEqual([]);
  expect(notice, "there is no Notice").toBeDefined();
  return {
    icon: notice?.props.icon,
    lead: notice?.props.lead,
    texts: textsOf(renderToStaticMarkup(element)),
    buttons: findAll(notice?.props.action as Parameters<typeof findAll>[0], Button).map(({ props }) => ({ kind: props.kind, href: props.href })),
  };
};

describe("issue 260 — noSupperClubNotice", () => {
  it("AC4: for a member who never joined it is the info Notice with the never-joined lead and body, and a secondary button to /supper-club", async () => {
    const notice = await noticeOf();
    expect(notice).toMatchObject({ icon: "info", lead: t("account.noSupperClub"), buttons: [{ kind: "secondary", href: "/supper-club" }] });
    expect(notice.texts.slice(0, 2)).toEqual([t("account.noSupperClub"), t("account.noSupperClubJoin")]);
  });

  it("AC5: for a cancelled member it is the info Notice with the cancelled lead, and a secondary button to /supper-club", async () => {
    await services.repo.cancelSubscription(await subscribe(), NOW);
    expect(await noticeOf()).toMatchObject({ icon: "info", lead: t("account.cancelledNotice"), buttons: [{ kind: "secondary", href: "/supper-club" }] });
  });

  it("AC4, AC5: for a member with an active subscription there is none", async () => {
    await subscribe();
    expect(await noSupperClubNotice(await account(), t, "en", NOW)).toBeNull();
  });
});
