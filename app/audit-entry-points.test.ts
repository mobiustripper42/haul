// Issue 71, AC12 and AC13: every server action and route handler in this repo is declared in
// AUDIT_ENTRY_POINTS with the events it records, or a reason it records none. The checker's own
// rules are proved on fixtures in src/audit-entry-points-check.test.ts; this runs it on the repo.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkAuditEntryPoints, type AuditEntryPoints, type Finding } from "@core/audit-entry-points-check.js";
import { AUDIT_EVENT_KINDS } from "@core/ports/repository.js";
import { AUDIT_ENTRY_POINTS } from "./audit-entry-points";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/** Every .ts and .tsx file under `dir`, test files included, keyed by repo-relative path with forward slashes. */
function sourcesUnder(dir: string, into: Record<string, string> = {}): Record<string, string> {
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) sourcesUnder(path, into);
    else if (/\.tsx?$/.test(entry.name)) into[relative(ROOT, join(ROOT, path)).split(sep).join("/")] = readFileSync(join(ROOT, path), "utf8");
  }
  return into;
}

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
    const sources = { ...sourcesUnder("app"), ...sourcesUnder("src") };
    // The scan reached the entry files and their tests, so an empty result is not an empty scan.
    expect(Object.keys(sources)).toEqual(
      expect.arrayContaining(["app/sign-in/actions.ts", "app/sign-in/actions.test.ts", "app/language-actions.ts", "app/dev/outbox/route.ts"]),
    );

    const findings = checkAuditEntryPoints({ entries: AUDIT_ENTRY_POINTS, kinds: AUDIT_EVENT_KINDS, sources });
    expect(findings.map(explain)).toEqual([]);
  });
});

describe("AC13 — the list is exactly these fifteen entries", () => {
  /** The entries with each `records` sorted, so the order a kind is listed in does not matter. */
  const normalized = (entries: AuditEntryPoints): AuditEntryPoints =>
    Object.fromEntries(
      Object.entries(entries).map(([key, entry]) => [key, "records" in entry ? { records: [...entry.records].sort() } : entry]),
    );

  it("AC13: AUDIT_ENTRY_POINTS holds exactly the three sign-in actions, the three Create Account actions and the five pane actions (issue 77) with their kinds, and signOut, setLanguage, the dev outbox's GET and the Supper Club continue route's GET with their reasons", () => {
    expect(normalized(AUDIT_ENTRY_POINTS)).toEqual(
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
      }),
    );
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
