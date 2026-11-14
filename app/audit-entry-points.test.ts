// Issue 71, AC12 and AC13: every server action and route handler in this repo is declared in
// AUDIT_ENTRY_POINTS with the events it records, or a reason it records none. The checker's own
// rules are proved on fixtures in src/audit-entry-points-check.test.ts; this runs it on the repo.
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkAuditEntryPoints, sourcesUnder, type AuditEntryPoints, type Finding } from "@core/audit-entry-points-check.js";
import { AUDIT_EVENT_KINDS } from "@core/ports/repository.js";
import { AUDIT_ENTRY_POINTS } from "./audit-entry-points";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/** What a reader of a failing gate needs to do about each finding. */
const explain = ({ kind, name }: Finding): string => {
  switch (kind) {
    case "undeclared":
      return `${name} is a server action or route handler with no entry in AUDIT_ENTRY_POINTS (app/audit-entry-points.ts): add one naming the events it records, or none with a reason`;
    case "stale":
      return `${name} is in AUDIT_ENTRY_POINTS, but its file or export no longer exists: remove or rename the entry`;
    case "unclaimed-kind":
      return `${name} is in AUDIT_EVENT_KINDS, but no entry in AUDIT_ENTRY_POINTS records it`;
    case "untested-kind":
      return `${name}: the entry claims this kind, but its sibling *.test.ts does not call .events() and name the kind as a string`;
    case "inline-use-server":
      return `${name} has a "use server" directive inside a function: move the action into a "use server" file`;
  }
};

describe("AC12 — the check on the real repo", () => {
  it("AC12: every .ts and .tsx file under app/ and src/, run through checkAuditEntryPoints with AUDIT_ENTRY_POINTS and AUDIT_EVENT_KINDS, gives no findings", () => {
    const sources = { ...sourcesUnder(ROOT, "app"), ...sourcesUnder(ROOT, "src") };
    // The scan reached the entry files and their tests, so an empty result is not an empty scan.
    expect(Object.keys(sources)).toEqual(
      expect.arrayContaining(["app/sign-in/actions.ts", "app/sign-in/actions.test.ts", "app/language-actions.ts", "app/dev/outbox/route.ts"]),
    );

    const findings = checkAuditEntryPoints({ entries: AUDIT_ENTRY_POINTS, kinds: AUDIT_EVENT_KINDS, sources });
    expect(findings.map(explain)).toEqual([]);
  });
});

const ISSUE_56_ENTRIES = ["app/supper-club/actions.ts#joinSupperClub", "app/supper-club/actions.ts#retrySupperClubPayment"];

describe("AC13 — the list is exactly these thirty-two entries, and issue 56's two", () => {
  /** The entries with each `records` sorted, so the order a kind is listed in does not matter. */
  const normalized = (entries: AuditEntryPoints): AuditEntryPoints =>
    Object.fromEntries(
      Object.entries(entries).map(([key, entry]) => [key, "records" in entry ? { records: [...entry.records].sort() } : entry]),
    );

  it("AC13: AUDIT_ENTRY_POINTS holds exactly the three sign-in actions, the three Create Account actions and the five pane actions (issue 77) with their kinds, and signOut, setLanguage, the dev outbox's GET, the Supper Club continue route's GET and the members spreadsheet's GET (issue 59) with their reasons", () => {
    const entries = Object.fromEntries(Object.entries(AUDIT_ENTRY_POINTS).filter(([key]) => !ISSUE_56_ENTRIES.includes(key)));
    expect(normalized(entries)).toEqual(
      normalized({
        "app/sign-in/actions.ts#requestCode": { records: ["rate_limit_refusal"] },
        "app/sign-in/actions.ts#verifyCode": { records: ["sign_in_by_code", "lock"] },
        "app/sign-in/actions.ts#signInWithLink": { records: ["sign_in_by_link"] },
        "app/sign-in/actions.ts#signOut": { none: "ends the session; writes no data" },
        "app/language-actions.ts#setLanguage": { none: "sets a cookie only" },
        "app/dev/outbox/route.ts#GET": { none: "dev only; reads" },
        "app/create-account/actions.ts#requestAccountCode": { records: ["rate_limit_refusal"] },
        "app/create-account/actions.ts#verifyAccountCode": { records: ["sign_in_by_code", "lock"] },
        "app/create-account/actions.ts#resendAccountCode": { records: ["rate_limit_refusal"] },
        "app/supper-club/actions.ts#requestPaneCode": { records: ["rate_limit_refusal"] },
        "app/supper-club/actions.ts#verifyPaneCode": { records: ["sign_in_by_code", "lock"] },
        "app/supper-club/actions.ts#requestPaneAccountCode": { records: ["rate_limit_refusal"] },
        "app/supper-club/actions.ts#verifyPaneAccountCode": { records: ["sign_in_by_code", "lock"] },
        "app/supper-club/actions.ts#resendPaneAccountCode": { records: ["rate_limit_refusal"] },
        "app/supper-club/continue/route.ts#GET": { none: "sets a cookie only" },
        "app/admin/members.csv/route.ts#GET": { none: "reads" },
        // Issue 149: the weeks screen's actions write rows the audit trigger records, and record no event.
        "app/admin/weeks/actions.ts#closeWeek": { none: "writes pickup_weeks and week_credits; audited by trigger" },
        "app/admin/weeks/actions.ts#reopenWeek": { none: "writes pickup_weeks and week_credits; audited by trigger" },
        "app/admin/weeks/actions.ts#saveWeekNote": { none: "writes pickup_weeks and week_credits; audited by trigger" },
        "app/admin/weeks/actions.ts#moveWeek": { none: "writes pickup_weeks and week_credits; audited by trigger" },
        // Issue 137: a member's Skip and Unskip write a ledger row the audit trigger records, and record no event.
        "app/account/weeks/actions.ts#skipWeek": { none: "writes ledger; audited by trigger" },
        "app/account/weeks/actions.ts#unskipWeek": { none: "writes ledger; audited by trigger" },
        // Issue 138: a member's switch writes subscription_options and the weekly price, which the trigger records.
        "app/account/weeks/actions.ts#switchMeal": { none: "writes subscription_options and subscriptions; audited by trigger" },
        // Issue 139: the member's cancel and the admin's write the subscription's status, which the trigger records.
        "app/account/cancel/actions.ts#cancelSubscription": { none: "writes subscriptions; audited by trigger" },
        "app/admin/members/[subscription]/actions.ts#cancelForMember": { none: "writes subscriptions; audited by trigger" },
        // Issue 156: Your details. A save and a resend count in sign-in's request limit; a confirm records the change;
        // Keep the old email records nothing (its reason is the entry's own).
        "app/account/details/actions.ts#saveDetails": { records: ["rate_limit_refusal"] },
        "app/account/details/actions.ts#confirmEmailChange": { records: ["email_changed"] },
        "app/account/details/actions.ts#resendEmailChange": { records: ["rate_limit_refusal"] },
        "app/account/details/actions.ts#keepOldEmail": AUDIT_ENTRY_POINTS["app/account/details/actions.ts#keepOldEmail"] ?? { none: "an entry for keepOldEmail" },
        // Issue 140: the menu library's actions and a week's menu write rows the audit trigger records, and record no event.
        "app/admin/menus/actions.ts#createMenu": { none: "writes menus and menu_texts; audited by trigger" },
        "app/admin/menus/actions.ts#saveMenu": { none: "writes menus and menu_texts; audited by trigger" },
        "app/admin/weeks/actions.ts#assignMenu": { none: "writes week_menus; audited by trigger" },
        // Issue 135: the cron route fires the charge run, which records a decline and an outcome it cannot know.
        "app/api/charge-run/route.ts#GET": { records: ["card_declined", "charge_outcome_unknown"] },
      }),
    );
  });
});

describe("issue 56 — the pay actions are declared", () => {
  const records = (key: string) => {
    const entry = AUDIT_ENTRY_POINTS[key];
    return entry && "records" in entry ? [...entry.records].sort() : entry;
  };

  it("AC5, AC10 (issue 57): joinSupperClub records the six signup events", () => {
    expect(records("app/supper-club/actions.ts#joinSupperClub")).toEqual([
      "already_subscribed",
      "card_declined",
      "charge_outcome_unknown",
      "sold_out",
      "square_customer_duplicates",
      "square_customer_linked",
    ]);
  });

  it("AC10: retrySupperClubPayment declares at least the decline it can record", () => {
    expect(records("app/supper-club/actions.ts#retrySupperClubPayment")).toEqual(expect.arrayContaining(["card_declined"]));
  });

  it("AC10 (issue 57): sold_out is claimed by joinSupperClub alone: \"Try again\" never meets the cap", () => {
    const claiming = Object.entries(AUDIT_ENTRY_POINTS).filter(([key, entry]) => key !== "app/supper-club/actions.ts#joinSupperClub" && "records" in entry && (entry.records as string[]).includes("sold_out"));
    expect(claiming).toEqual([]);
  });
});

describe("issue 55 — the Create Account actions and the Supper Club route are declared", () => {
  const records = (key: string) => {
    const entry = AUDIT_ENTRY_POINTS[key];
    return entry && "records" in entry ? [...entry.records].sort() : entry;
  };

  it("AC4: requestAccountCode records rate_limit_refusal", () => {
    expect(records("app/create-account/actions.ts#requestAccountCode")).toEqual(["rate_limit_refusal"]);
  });

  it("AC8: verifyAccountCode records sign_in_by_code and lock", () => {
    expect(records("app/create-account/actions.ts#verifyAccountCode")).toEqual(["lock", "sign_in_by_code"]);
  });

  it("AC16: resendAccountCode records rate_limit_refusal", () => {
    expect(records("app/create-account/actions.ts#resendAccountCode")).toEqual(["rate_limit_refusal"]);
  });

  it('AC2: the continue route\'s GET is declared as { none: "sets a cookie only" }', () => {
    expect(AUDIT_ENTRY_POINTS["app/supper-club/continue/route.ts#GET"]).toEqual({ none: "sets a cookie only" });
  });
});
