// The full pages' paths: the one home for them, imported by each flow's actions and pages. A plain file,
// so a page linking to the other flow doesn't pull in that flow's services.
import { ACCOUNT_CARD_PATH } from "@core/account-paths.js";
import { MENU_EMAILS_OFF_PATH, MENU_EMAILS_PATH } from "@core/menu-email-paths.js";
import { MENU_FROM_PARAM } from "./admin/menus/shared";
import type { FlowPages } from "./sign-in/shared";

/** A member's account home. */
export const ACCOUNT_PATH = "/account";

/** The admin's page, where an admin lands from the Sign in page and the header's Admin interface starts. */
export const ADMIN_PATH = "/admin";

/** The Sign in page's flow, the only one with a landing for an admin (issue 266). */
export const SIGN_IN_PAGES: FlowPages = { start: "/sign-in", code: "/sign-in/code", done: ACCOUNT_PATH, adminDone: ADMIN_PATH };

export const CREATE_ACCOUNT_PAGES: FlowPages = { start: "/create-account", code: "/create-account/code", done: ACCOUNT_PATH };

/** A member's Upcoming weeks. */
export const ACCOUNT_WEEKS_PATH = "/account/weeks";

/** The `error` a refused Skip or Unskip sends Upcoming weeks when the week's cutoff has passed (issue 137). */
export const ACCOUNT_WEEKS_CUTOFF_ERROR = "cutoff";
/** The value of the account page's `switch` query that opens the Supper Club card's pickers (issue 138, moved by issue 219). */
export const ACCOUNT_SWITCH_OPEN = "1";
/** The account page's query naming why a switch was refused (issue 219); its value is `ACCOUNT_WEEKS_CUTOFF_ERROR`. */
export const ACCOUNT_SWITCH_ERROR_PARAM = "switchError";

/** The `id` of the Upcoming weeks page's History column (issue 243), which the menu's History link goes to. */
export const ACCOUNT_HISTORY_ID = "history";
/** A member's History: the second list of Upcoming weeks (issue 243). The server never sees the part after `#`, so the menu never marks it. */
export const ACCOUNT_HISTORY_PATH = `${ACCOUNT_WEEKS_PATH}#${ACCOUNT_HISTORY_ID}`;

/** The admin's weeks screen: close, reopen and move pickup weeks. */
export const ADMIN_WEEKS_PATH = "/admin/weeks";

/** The admin's weekly lists (issue 142): a week's pick list, its two downloads and its printable pickup list. */
export const ADMIN_LISTS_PATH = "/admin/lists";
/** The query parameter naming the week the weekly lists show. */
export const WEEK_PARAM = "week";
const ADMIN_LISTS_PICK_LIST_CSV_PATH = "/admin/lists/pick-list.csv";
const ADMIN_LISTS_SKIPS_CSV_PATH = "/admin/lists/skips.csv";
const ADMIN_LISTS_PRINT_PATH = "/admin/lists/print";
const weekQuery = (week: string): string => `?${new URLSearchParams({ [WEEK_PARAM]: week })}`;
/** The weekly lists for a week. */
export const adminListsPath = (week: string): string => `${ADMIN_LISTS_PATH}${weekQuery(week)}`;
/** The pick list's download for a week. */
export const adminPickListCsvPath = (week: string): string => `${ADMIN_LISTS_PICK_LIST_CSV_PATH}${weekQuery(week)}`;
/** The skips' download for a week. */
export const adminSkipsCsvPath = (week: string): string => `${ADMIN_LISTS_SKIPS_CSV_PATH}${weekQuery(week)}`;
/** The printable pickup list for a week. */
export const adminPickupPrintPath = (week: string): string => `${ADMIN_LISTS_PRINT_PATH}${weekQuery(week)}`;

/** The admin's menu library (issue 140). */
export const ADMIN_MENUS_PATH = "/admin/menus";
/** New menu. */
export const ADMIN_MENU_NEW_PATH = "/admin/menus/new";
/** Edit menu. */
export const adminMenuPath = (id: string): string => `${ADMIN_MENUS_PATH}/${encodeURIComponent(id)}`;
/** New menu, filled from the menu given (Duplicate). */
export const duplicateMenuPath = (id: string): string => `${ADMIN_MENU_NEW_PATH}?${new URLSearchParams({ [MENU_FROM_PARAM]: id })}`;

/** A member's cancel confirm (issue 139). */
export const ACCOUNT_CANCEL_PATH = "/account/cancel";

/** Issue 145: a member's Update your card, with one home in core, which the decline email's link is built in. */
export { ACCOUNT_CARD_PATH };
/** Issue 145: the query parameter naming a card save's outcome. */
export const ACCOUNT_CARD_STATE_PARAM = "state";
/** Issue 145: the query parameter naming the one ledger row a paid save charged (`paid`, and issue 254's `paidNoCard`). */
export const ACCOUNT_CARD_ROW_PARAM = "row";
/** Issue 145: Update your card after a save, with its outcome and, for a paid one, the row it paid. */
export const accountCardPath = (state: "saved" | "paid" | "paidNoCard" | "declined" | "unknown" | "error", ledgerId?: string): string => {
  const query = new URLSearchParams({ [ACCOUNT_CARD_STATE_PARAM]: state });
  if (ledgerId !== undefined) query.set(ACCOUNT_CARD_ROW_PARAM, ledgerId);
  return `${ACCOUNT_CARD_PATH}?${query}`;
};

/** The public menu page (issue 141). */
export const MENU_PATH = "/menu";
/** The menu emails page and its off route have one home in core, which the email's link is built in. */
export { MENU_EMAILS_PATH, MENU_EMAILS_OFF_PATH };
/** The menu emails page for a member: the member and the token that proves the link is theirs. */
export const menuEmailsPath = (memberId: string, token: string): string => `${MENU_EMAILS_PATH}?${new URLSearchParams({ m: memberId, t: token })}`;
/** The off route for a member. */
export const menuEmailsOffPath = (memberId: string, token: string): string => `${MENU_EMAILS_OFF_PATH}?${new URLSearchParams({ m: memberId, t: token })}`;

/** The admin's page for one subscription (issue 139). */
export const adminMemberPath = (subscriptionId: string): string => `/admin/members/${encodeURIComponent(subscriptionId)}`;
/** The value of the admin member page's `cancel` query that opens the confirm card, as Switch opens its pickers. */
export const ADMIN_MEMBER_CANCEL_OPEN = "1";
