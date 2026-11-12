// The full pages' paths: the one home for them, imported by each flow's actions and pages. A plain file,
// so a page linking to the other flow doesn't pull in that flow's services.
import type { FlowPages } from "./sign-in/shared";

/** A member's account home. */
export const ACCOUNT_PATH = "/account";

export const SIGN_IN_PAGES: FlowPages = { start: "/sign-in", code: "/sign-in/code", done: ACCOUNT_PATH };

export const CREATE_ACCOUNT_PAGES: FlowPages = { start: "/create-account", code: "/create-account/code", done: ACCOUNT_PATH };

/** A member's Upcoming weeks. */
export const ACCOUNT_WEEKS_PATH = "/account/weeks";

/** The `error` a refused Skip or Unskip sends Upcoming weeks when the week's cutoff has passed (issue 137). */
export const ACCOUNT_WEEKS_CUTOFF_ERROR = "cutoff";
/** The value of Upcoming weeks' `switch` query that opens the meal card's pickers (issue 138). */
export const ACCOUNT_WEEKS_SWITCH_OPEN = "1";

/** A member's History. */
export const ACCOUNT_HISTORY_PATH = "/account/history";

/** A member's Your details. */
export const ACCOUNT_DETAILS_PATH = "/account/details";

/** The admin's page, the header's Admin button. */
export const ADMIN_PATH = "/admin";

/** The admin's weeks screen: close, reopen and move pickup weeks. */
export const ADMIN_WEEKS_PATH = "/admin/weeks";

/** The admin's menu library (issue 140). */
export const ADMIN_MENUS_PATH = "/admin/menus";
/** New menu. */
export const ADMIN_MENU_NEW_PATH = "/admin/menus/new";
/** Edit menu. */
export const adminMenuPath = (id: string): string => `${ADMIN_MENUS_PATH}/${encodeURIComponent(id)}`;
/** New menu, filled from the menu given (Duplicate). */
export const duplicateMenuPath = (id: string): string => `${ADMIN_MENU_NEW_PATH}?${new URLSearchParams({ from: id })}`;

/** A member's cancel confirm (issue 139). */
export const ACCOUNT_CANCEL_PATH = "/account/cancel";

/** The admin's page for one subscription (issue 139). */
export const adminMemberPath = (subscriptionId: string): string => `/admin/members/${encodeURIComponent(subscriptionId)}`;
/** The value of the admin member page's `cancel` query that opens the confirm card, as Switch opens its pickers. */
export const ADMIN_MEMBER_CANCEL_OPEN = "1";
