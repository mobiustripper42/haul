// The full pages' paths: the one home for them, imported by each flow's actions and pages. A plain file,
// so a page linking to the other flow doesn't pull in that flow's services.
import type { FlowPages } from "./sign-in/shared";

export const SIGN_IN_PAGES: FlowPages = { start: "/sign-in", code: "/sign-in/code", done: "/" };

export const CREATE_ACCOUNT_PAGES: FlowPages = { start: "/create-account", code: "/create-account/code", done: "/" };

/** A member's account: the home page, until the account pages arrive (task 2.4). */
export const ACCOUNT_PATH = "/";

/** The admin's page, the header's Admin button. */
export const ADMIN_PATH = "/admin";
