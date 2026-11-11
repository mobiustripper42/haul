import type { AuditEntryPoints } from "@core/audit-entry-points-check.js";

/**
 * Every server action and route handler, keyed `path#export`, with the audit events it records or the
 * reason it records none (DEC-028). `npm run verify` fails on an undeclared entry, a stale one, a kind
 * no entry claims and a claimed kind its sibling test never names.
 */
export const AUDIT_ENTRY_POINTS: AuditEntryPoints = {
  "app/sign-in/actions.ts#requestCode": { records: ["rate_limit_refusal"] },
  "app/sign-in/actions.ts#verifyCode": { records: ["sign_in_by_code", "lock"] },
  "app/sign-in/actions.ts#signInWithLink": { records: ["sign_in_by_link"] },
  "app/sign-in/actions.ts#signOut": { none: "ends the session; writes no data" },
  "app/create-account/actions.ts#requestAccountCode": { records: ["rate_limit_refusal"] },
  "app/create-account/actions.ts#verifyAccountCode": { records: ["sign_in_by_code", "lock"] },
  "app/create-account/actions.ts#resendAccountCode": { records: ["rate_limit_refusal"] },
  "app/supper-club/actions.ts#requestPaneCode": { records: ["rate_limit_refusal"] },
  "app/supper-club/actions.ts#verifyPaneCode": { records: ["sign_in_by_code", "lock"] },
  "app/supper-club/actions.ts#requestPaneAccountCode": { records: ["rate_limit_refusal"] },
  "app/supper-club/actions.ts#verifyPaneAccountCode": { records: ["sign_in_by_code", "lock"] },
  "app/supper-club/actions.ts#resendPaneAccountCode": { records: ["rate_limit_refusal"] },
  "app/supper-club/actions.ts#joinSupperClub": {
    records: ["already_subscribed", "square_customer_linked", "square_customer_duplicates", "card_declined", "charge_outcome_unknown", "sold_out"],
  },
  "app/supper-club/actions.ts#retrySupperClubPayment": { records: ["already_subscribed", "card_declined", "charge_outcome_unknown"] },
  "app/language-actions.ts#setLanguage": { none: "sets a cookie only" },
  "app/supper-club/continue/route.ts#GET": { none: "sets a cookie only" },
  "app/dev/outbox/route.ts#GET": { none: "dev only; reads" },
  "app/admin/members.csv/route.ts#GET": { none: "reads" },
  "app/admin/weeks/actions.ts#closeWeek": { none: "writes pickup_weeks and week_credits; audited by trigger" },
  "app/admin/weeks/actions.ts#reopenWeek": { none: "writes pickup_weeks and week_credits; audited by trigger" },
  "app/admin/weeks/actions.ts#saveWeekNote": { none: "writes pickup_weeks and week_credits; audited by trigger" },
  "app/admin/weeks/actions.ts#moveWeek": { none: "writes pickup_weeks and week_credits; audited by trigger" },
};
