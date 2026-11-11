// The full pages' paths: the one home for them, imported by each flow's actions and pages. A plain file,
// so a page linking to the other flow doesn't pull in that flow's services.
import type { FlowPages } from "./sign-in/shared";

/** A member's account home. */
export const ACCOUNT_PATH = "/account";

export const SIGN_IN_PAGES: FlowPages = { start: "/sign-in", code: "/sign-in/code", done: ACCOUNT_PATH };

export const CREATE_ACCOUNT_PAGES: FlowPages = { start: "/create-account", code: "/create-account/code", done: ACCOUNT_PATH };

/** A member's Upcoming weeks. */
export const ACCOUNT_WEEKS_PATH = "/account/weeks";

/** A member's History. */
export const ACCOUNT_HISTORY_PATH = "/account/history";

/** The admin's page, the header's Admin button. */
export const ADMIN_PATH = "/admin";

/** The admin's weeks screen: close, reopen and move pickup weeks. */
export const ADMIN_WEEKS_PATH = "/admin/weeks";
